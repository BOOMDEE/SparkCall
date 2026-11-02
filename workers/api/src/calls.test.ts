import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuth = vi.fn();
const rateLimit = vi.fn();
const findByNumber = vi.fn();
const isBlocked = vi.fn();

vi.mock("./auth", () => ({ requireAuth, rateLimit }));
vi.mock("./database", () => ({
  body: async (request: Request) => JSON.parse(await request.text()) as Record<string, unknown>,
  error: (message: string, status = 400, code = "BAD_REQUEST") =>
    new Response(JSON.stringify({ error: { code, message } }), { status }),
  findByNumber,
  id: () => "call-12345678",
  isBlocked,
  json: (value: unknown, status = 200) => new Response(JSON.stringify(value), { status }),
  now: () => "2026-11-02T10:00:00.000Z",
  validDialNumber: () => true,
}));

const { handleRealtimeApi } = await import("./calls");

function namespace(fetchResponse = new Response(JSON.stringify({ ok: true }))) {
  const stub = { fetch: vi.fn().mockResolvedValue(fetchResponse) };
  return {
    idFromName: vi.fn(() => ({ toString: () => "id" })),
    get: vi.fn(() => stub),
    stub,
  };
}

function env(db: { prepare: ReturnType<typeof vi.fn> }, presence = namespace()) {
  return {
    DB: db,
    SIGNALING: namespace(),
    PRESENCE: presence,
    ASSETS: { fetch: vi.fn() },
    SPARKCALL_INTERNAL_TOKEN: "internal-token",
    ALLOWED_ORIGIN: "https://app.example",
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockReset().mockResolvedValue(true);
  requireAuth.mockResolvedValue({ id: "caller", number: "SC-CALLER", display_name: "Caller", session_id: "session" });
  findByNumber.mockResolvedValue({ id: "callee", number: "SC-CALLEE", display_name: "Callee" });
  isBlocked.mockResolvedValue(false);
});

describe("realtime call authorization and activity checks", () => {
  it.each(["account", "network"])("rejects %s call floods before looking up a recipient", async (kind) => {
    if (kind === "account") rateLimit.mockResolvedValue(false);
    else rateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await handleRealtimeApi(new Request("https://app.example/api/calls", {
      method: "POST",
      headers: { Origin: "https://app.example", "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.4" },
      body: JSON.stringify({ number: "SC-CALLEE" }),
    }), env({ prepare: vi.fn() }));
    expect(response?.status).toBe(429);
    expect(findByNumber).not.toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), "calls:user:caller", 10, 60);
    if (kind === "network") expect(rateLimit).toHaveBeenCalledWith(expect.anything(), "calls:ip:192.0.2.4", 60, 60);
  });

  it("rejects cross-site call creation before authenticating or notifying anyone", async () => {
    const request = new Request("https://app.example/api/calls", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ number: "SC-CALLEE" }),
    });
    const response = await handleRealtimeApi(request, env({ prepare: vi.fn() }));

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: { code: "CSRF", message: "Cross-site request rejected" } });
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("rejects call creation when the Origin header is absent", async () => {
    const request = new Request("https://app.example/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: "SC-CALLEE" }),
    });
    const response = await handleRealtimeApi(request, env({ prepare: vi.fn() }));

    expect(response?.status).toBe(403);
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("uses julianday for ISO started_at activity comparisons", async () => {
    const statements: string[] = [];
    const db = {
      prepare: vi.fn((query: string) => {
        statements.push(query);
        return {
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(query.includes("user_preferences") || query.includes("julianday") ? null : undefined),
            run: vi.fn().mockResolvedValue({ success: true }),
          })),
        };
      }),
    };
    const presence = namespace();
    const response = await handleRealtimeApi(new Request("https://app.example/api/calls", {
      method: "POST",
      headers: { Origin: "https://app.example", "Content-Type": "application/json" },
      body: JSON.stringify({ number: "SC-CALLEE" }),
    }), env(db, presence));

    expect(response?.status).toBe(201);
    const activityQuery = statements.find((query) => query.includes("FROM call_history") && query.includes("LIMIT 1"));
    expect(activityQuery).toContain("julianday(started_at)>julianday('now','-2 minutes')");
    expect(activityQuery).not.toContain("started_at>datetime('now','-2 minutes')");
  });
});
