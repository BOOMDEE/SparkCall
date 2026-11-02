import { describe, expect, it, vi } from "vitest";
import {
  authenticate,
  clearSessionCookie,
  createSession,
  getCookie,
  hashPassword,
  hashToken,
  newToken,
  rateLimit,
  requireAuth,
  revokeSession,
  sessionCookie,
  verifyPassword,
} from "./auth";

function statement(first: unknown = null) {
  return {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(first),
    all: vi.fn(),
    run: vi.fn().mockResolvedValue({ success: true }),
  };
}

function envWithDb(first: unknown = null) {
  const prepared = statement(first);
  return {
    DB: { prepare: vi.fn().mockReturnValue(prepared) },
    prepared,
  } as const;
}

describe("password and token primitives", () => {
  it("hashes passwords with a versioned, salted PBKDF2 record", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).toMatch(/^pbkdf2-sha256\$v1\$310000\$[^$]+\$[^$]+$/);
    expect(second).not.toBe(first);
    await expect(verifyPassword("correct horse battery staple", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
    await expect(verifyPassword("correct horse battery staple", first.replace("$v1$", "$v2$"))).resolves.toBe(false);
  });

  it("rejects malformed or unsafe password records without throwing", async () => {
    for (const value of ["", "pbkdf2-sha256$v1$not-a-number$salt$digest", "pbkdf2-sha256$v1$99999$AA$AA", "pbkdf2-sha256$v1$100000$%%%$%%%"]) {
      await expect(verifyPassword("password", value)).resolves.toBe(false);
    }
  });

  it("produces URL-safe random tokens and deterministic SHA-256 token hashes", async () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await hashToken("same-token")).toBe(await hashToken("same-token"));
    expect(await hashToken("same-token")).not.toBe(await hashToken("other-token"));
  });
});

describe("session cookies and authentication", () => {
  it("sets restrictive session attributes and clears with Max-Age zero", () => {
    expect(sessionCookie("a token", 300)).toBe("sc_session=a%20token; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(clearSessionCookie()).toBe("sc_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
  });

  it("parses only the requested cookie and tolerates malformed encoding", () => {
    expect(getCookie(new Request("https://example.test", { headers: { Cookie: "other=x; sc_session=a%20b; sc_session=second" } }), "sc_session")).toBe("a b");
    expect(getCookie(new Request("https://example.test", { headers: { Cookie: "sc_session=%E0%A4%A" } }), "sc_session")).toBeUndefined();
    expect(getCookie(new Request("https://example.test", { headers: { Cookie: "not_sc_session=wrong" } }), "sc_session")).toBeUndefined();
  });

  it("stores a bounded session TTL and uses julianday for both expiry formats", async () => {
    const { DB, prepared } = envWithDb();
    const result = await createSession({ DB, SESSION_TTL_SECONDS: "9999999" } as any, "user-1", false);
    expect(result.ttl).toBe(60 * 60 * 24 * 30);
    expect(prepared.bind).toHaveBeenCalledWith(expect.any(String), "user-1", expect.stringMatching(/^[0-9a-f]{64}$/), "+2592000 seconds", expect.any(String));

    const user = { id: "user-1", expires_at: "2099-01-01T00:00:00.000Z" };
    const auth = envWithDb(user);
    await expect(authenticate(new Request("https://example.test", { headers: { Cookie: "sc_session=token" } }), auth as any)).resolves.toBe(user);
    const query = auth.DB.prepare.mock.calls[0]?.[0] as string;
    expect(query).toContain("julianday(s.expires_at) > julianday('now')");
    expect(query).toContain("julianday(u.expires_at) > julianday('now')");
  });

  it("requires authentication, and revokes only the hashed cookie token", async () => {
    const auth = envWithDb(null);
    const request = new Request("https://example.test");
    await expect(requireAuth(request, auth.DB as any)).rejects.toMatchObject({ status: 401 });

    const revocation = envWithDb();
    await revokeSession(new Request("https://example.test", { headers: { Cookie: "sc_session=token" } }), revocation as any);
    expect(revocation.prepared.bind).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });
});

describe("login rate limiting", () => {
  it("uses bounded keys, rejects missing counts, and tolerates KV failure", async () => {
    const prepared = statement({ attempts: 2 });
    const DB = { prepare: vi.fn().mockReturnValue(prepared) };
    const put = vi.fn().mockRejectedValue(new Error("KV unavailable"));
    await expect(rateLimit({ DB, RATE_LIMIT: { put } } as any, "x".repeat(500), 2, 900)).resolves.toBe(true);
    expect(prepared.bind.mock.calls[0]?.[0]).toHaveLength(240);
    expect(put).toHaveBeenCalledWith(expect.stringMatching(/^rl:v1:x{180}$/), "2", { expirationTtl: 900 });

    const missing = envWithDb(null);
    await expect(rateLimit(missing.DB as any, "key")).resolves.toBe(false);
  });
});
