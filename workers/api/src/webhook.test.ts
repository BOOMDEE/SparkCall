import { describe, expect, it, vi } from "vitest";
import { decryptWebhookUrl, encryptWebhookUrl, isPrivateIpLiteral, triggerIncomingCallWebhook, validateResolvedHost, validateWebhookUrl } from "./webhook";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const env = (prepare: ReturnType<typeof vi.fn>) => ({ DB: { prepare }, SPARKCALL_WEBHOOK_ENCRYPTION_KEY: key } as any);

describe("incoming-call webhook security", () => {
  it("rejects IANA special-purpose IPv4, IPv6, mapped, NAT64, and private literals while allowing ordinary public ranges", () => {
    for (const value of [
      "https://0.0.0.1/hook", "https://10.0.0.1/hook", "https://100.64.0.1/hook", "https://127.0.0.1/hook",
      "https://169.254.1.1/hook", "https://192.0.0.1/hook", "https://192.0.2.1/hook", "https://192.31.196.1/hook",
      "https://192.52.193.1/hook", "https://192.88.99.1/hook", "https://192.168.1.1/hook", "https://198.18.0.1/hook",
      "https://198.51.100.1/hook", "https://203.0.113.1/hook", "https://224.0.0.1/hook", "https://240.0.0.1/hook",
      "https://[::1]/hook", "https://[::ffff:93.184.216.34]/hook", "https://[64:ff9b::c000:201]/hook", "https://[64:ff9b:1::1]/hook",
      "https://[fc00::1]/hook", "https://[fe80::1]/hook", "https://[ff02::1]/hook", "https://[2001:db8::1]/hook", "https://[2001:2::1]/hook", "https://[2001:10::1]/hook", "https://[2001:20::1]/hook",
      "https://localhost/hook", "http://public.example/hook", "https://user:pass@public.example/hook", "https://public.example/#fragment",
    ]) {
      expect(() => validateWebhookUrl(value), value).toThrow();
    }
    expect(isPrivateIpLiteral("::ffff:93.184.216.34")).toBe(true);
    expect(isPrivateIpLiteral("64:ff9b::c000:201")).toBe(true);
    expect(isPrivateIpLiteral("2001:db8:0:0:0:0:0:1")).toBe(true);
    expect(isPrivateIpLiteral("2001:2:1::1")).toBe(false);
    expect(() => validateWebhookUrl("https://93.184.216.34/hook")).not.toThrow();
    expect(() => validateWebhookUrl("https://example.com/hook")).not.toThrow();
  });

  it("encrypts URL at rest and decrypts it without exposing plaintext", async () => {
    const url = new URL("https://example.com/hook");
    const encrypted = await encryptWebhookUrl(env(vi.fn()), url);
    expect(encrypted.ciphertext).not.toContain("example.com");
    expect(encrypted.iv).toHaveLength(16);
    await expect(decryptWebhookUrl(env(vi.fn()), encrypted.ciphertext, encrypted.iv)).resolves.toEqual(url);
  });

  it("fails closed for no-answer, private AAAA, and DoH failures, and uses no-store", async () => {
    const calls: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ Answer: [] }), { status: 200 });
    });
    await expect(validateResolvedHost(new URL("https://example.com/hook"), fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(calls.every(init => init.cache === "no-store" && init.redirect === "error")).toBe(true);

    const privateV6 = vi.fn(async (input: RequestInfo | URL) => String(input).includes("type=AAAA")
      ? new Response(JSON.stringify({ Answer: [{ type: 28, data: "fd00::1" }] }))
      : new Response(JSON.stringify({ Answer: [{ type: 1, data: "93.184.216.34" }] })));
    await expect(validateResolvedHost(new URL("https://example.com/hook"), privateV6)).rejects.toThrow();

    const dohFailure = vi.fn(async () => new Response("failure", { status: 503 }));
    await expect(validateResolvedHost(new URL("https://example.com/hook"), dohFailure)).rejects.toThrow();
  });

  it("uses GET without following redirects, cancels the response body, applies no-store, and atomically rate-limits", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const first = { ciphertext: "", iv: "" };
    const prepared = vi.fn((query: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(query.startsWith("SELECT") ? first : null),
      run: vi.fn().mockResolvedValue({ meta: { changes: query.startsWith("UPDATE") ? 1 : 0 } }),
    }));
    const encrypted = await encryptWebhookUrl(env(prepared), new URL("https://example.com/hook"));
    first.ciphertext = encrypted.ciphertext; first.iv = encrypted.iv;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).startsWith("https://cloudflare-dns.com")) {
        expect(init?.cache).toBe("no-store");
        return new Response(JSON.stringify({ Answer: [{ type: 1, data: "93.184.216.34" }] }), { headers: { "content-type": "application/dns-json" } });
      }
      expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store" });
      return { status: 302, ok: false, body: { cancel } } as unknown as Response;
    });
    await triggerIncomingCallWebhook(env(prepared), "u1", "call-1", "2026-11-02T10:00:00.000Z");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("https://example.com/hook"))).toBe(true);
    expect(cancel).toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("does not send when the atomic rate-limit claim is denied", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    const first = { ciphertext: "", iv: "" };
    const prepared = vi.fn((query: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(query.startsWith("SELECT") ? first : null),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    }));
    const encrypted = await encryptWebhookUrl(env(prepared), new URL("https://example.com/hook"));
    first.ciphertext = encrypted.ciphertext; first.iv = encrypted.iv;
    await triggerIncomingCallWebhook(env(prepared), "u1", "call-2", "2026-11-02T10:00:01.000Z");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
