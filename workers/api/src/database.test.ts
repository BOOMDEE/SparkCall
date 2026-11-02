import { describe, expect, it, vi } from "vitest";
import {
  base64url,
  body,
  bytes,
  error,
  findByNumber,
  findUser,
  hex,
  id,
  json,
  isBlocked,
  now,
  publicUser,
  text,
  validDialNumber,
  validNumber,
  validSlug,
  validUsername,
} from "./database";

describe("database pure helpers", () => {
  it("generates correctly sized encodings and timestamps", () => {
    const value = Uint8Array.from([0, 1, 15, 16, 254, 255]);
    expect(hex(value)).toBe("00010f10feff");
    expect(base64url(value)).toBe("AAEPEP7_");
    expect(base64url(value)).not.toContain("=");
    expect(bytes(24)).toHaveLength(24);
    expect(id()).toMatch(/^[0-9a-f-]{36}$/);
    expect(now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("enforces username, number, dial-number, and slug boundaries", () => {
    expect(validUsername("abc")).toBe(true);
    expect(validUsername("_ab-12.example")).toBe(true);
    expect(validUsername("ab")).toBe(false);
    expect(validUsername("a".repeat(33))).toBe(false);
    expect(validUsername("a b")).toBe(false);

    expect(validNumber("A1_".replace("_", "0"))).toBe(true);
    expect(validNumber("" )).toBe(false);
    expect(validNumber("a".repeat(33))).toBe(false);
    expect(validNumber("+123")).toBe(false);
    expect(validDialNumber("SC-TMP-0123456789")).toBe(true);
    expect(validDialNumber("SC-TMP-012345678Z")).toBe(false);

    expect(validSlug("a")).toBe(true);
    expect(validSlug("a-record-9")).toBe(true);
    expect(validSlug("-a")).toBe(false);
    expect(validSlug("a-")).toBe(false);
    expect(validSlug("a".repeat(97))).toBe(false);
  });

  it("limits text and omits non-string or oversized values", () => {
    expect(text("hello", 5)).toBe("hello");
    expect(text("hello!", 5)).toBeUndefined();
    expect(text(5, 5)).toBeUndefined();
    expect(publicUser({ id: "u1", username: undefined, display_name: "Name", is_temporary: 1 })).toEqual({
      id: "u1", username: null, displayName: "Name", number: null, temporary: true, expiresAt: null,
    });
  });
});

describe("request and response boundaries", () => {
  it("parses object JSON but rejects arrays, malformed JSON, and oversized bodies", async () => {
    await expect(body(new Request("https://example.test", { method: "POST", body: JSON.stringify({ ok: true }) }))).resolves.toEqual({ ok: true });
    await expect(body(new Request("https://example.test", { method: "POST", body: "[1,2]" }))).resolves.toEqual({});

    const invalid = body(new Request("https://example.test", { method: "POST", body: "{" }));
    await expect(invalid).rejects.toMatchObject({ status: 400 });
    await expect(invalid).rejects.toMatchObject({ status: 400, headers: expect.any(Headers) });

    const tooLargeByHeader = body(new Request("https://example.test", { method: "POST", headers: { "content-length": "100001" }, body: "{}" }));
    await expect(tooLargeByHeader).rejects.toMatchObject({ status: 413 });
    const tooLarge = body(new Request("https://example.test", { method: "POST", body: JSON.stringify({ value: "x".repeat(100_001) }) }));
    await expect(tooLarge).rejects.toMatchObject({ status: 413 });
  });

  it("returns JSON with no-store defaults while allowing explicit status and headers", async () => {
    const response = json({ ok: true }, 201, { "x-test": "yes" });
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-test")).toBe("yes");
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(error("bad", 422, "BAD").status).toBe(422);
  });
});

describe("database query boundaries", () => {
  function db(firstValue: unknown) {
    const prepared = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(firstValue) };
    return { DB: { prepare: vi.fn().mockReturnValue(prepared) }, prepared };
  }

  it("uses exact/case-sensitive number lookup and parameterized IDs", async () => {
    const byNumber = db({ id: "u1" });
    await expect(findByNumber(byNumber.DB as any, "Ab12")).resolves.toEqual({ id: "u1" });
    expect(byNumber.DB.prepare.mock.calls[0]?.[0]).toContain("COLLATE BINARY");
    expect(byNumber.prepared.bind).toHaveBeenCalledWith("Ab12");

    const user = db({ id: "u1" });
    await findUser(user.DB as any, "u1' OR 1=1 --");
    expect(user.prepared.bind).toHaveBeenCalledWith("u1' OR 1=1 --");
  });

  it("returns a boolean for the block relationship query", async () => {
    const blocked = db({ 1: 1 });
    await expect(isBlocked(blocked.DB as any, "a", "b")).resolves.toBe(true);
    const clear = db(null);
    await expect(isBlocked(clear.DB as any, "a", "b")).resolves.toBe(false);
  });
});
