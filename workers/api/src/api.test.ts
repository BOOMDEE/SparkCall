import { describe, expect, it, vi } from "vitest";
import { handleApi } from "./api";

const user = { id: "user-1", display_name: "Caller", is_temporary: 0, expires_at: null, session_id: "session-1" };
const cookie = "sc_session=test-session";

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://example.test${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      Origin: "https://example.test",
      ...(init.headers || {}),
    },
  });
}

function preferenceEnv() {
  let settings = "{}";
  let version = 0;
  const prepare = vi.fn((query: string) => {
    const statement = {
      bind: vi.fn((...values: unknown[]) => {
        const bound = {
          first: vi.fn(async () => {
            if (query.includes("FROM sessions")) return user;
            if (query.includes("INSERT INTO user_preferences")) {
              const patch = JSON.parse(String(values[1])) as Record<string, unknown>;
              settings = JSON.stringify({ ...JSON.parse(settings), ...patch });
              version += 1;
              return { settings_json: settings, version };
            }
            if (query.includes("FROM user_preferences") && query.includes("SELECT")) return { settings_json: settings, version };
            return null;
          }),
          run: vi.fn(async () => ({ success: true })),
        };
        return Object.assign(statement, bound);
      }),
    };
    return statement;
  });
  return { DB: { prepare }, ALLOWED_ORIGIN: "https://example.test" } as any;
}

async function jsonResponse(response: Response) {
  return { status: response.status, body: await response.json() as Record<string, any> };
}

describe("API preference and TURN regressions", () => {
  it("preserves disjoint concurrent preference patches with an atomic JSON merge", async () => {
    const env = preferenceEnv();
    const first = request("/api/settings/preferences", { method: "PATCH", body: JSON.stringify({ theme: "dark" }) });
    const second = request("/api/settings/preferences", { method: "PATCH", body: JSON.stringify({ bitrateKbps: 64 }) });

    const [firstRaw, secondRaw] = await Promise.all([handleApi(first, env), handleApi(second, env)]);
    const [firstResponse, secondResponse] = await Promise.all([jsonResponse(firstRaw), jsonResponse(secondRaw)]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(String(env.DB.prepare.mock.calls.find((call: unknown[]) => String(call[0]).includes("INSERT INTO user_preferences"))?.[0])).toContain("json_patch");
    expect([firstResponse.body.version, secondResponse.body.version].sort()).toEqual([1, 2]);

    const finalResponse = await handleApi(request("/api/settings/preferences", { method: "GET" }), env);
    const final = await jsonResponse(finalResponse);
    expect(final.body.version).toBe(2);
    expect(final.body.preferences).toMatchObject({ theme: "dark", bitrateKbps: 64 });
  });

  it("pauses new relay credentials when the sampled estimate reaches the user's limit", async () => {
    const queries: string[] = [];
    const authenticatedUser = { id: "user-1", display_name: "Caller", is_temporary: 0, expires_at: null, session_id: "session-1" };
    const db = {
      prepare: vi.fn((query: string) => {
        queries.push(query);
        return { bind: vi.fn(() => ({
          first: vi.fn(async () => {
            if (query.includes("FROM sessions s JOIN users u")) return authenticatedUser;
            if (query.includes("turn_monthly_quota_bytes")) return { turn_monthly_quota_bytes: 100 };
            return null;
          }),
          run: vi.fn(async () => ({ success: true })),
        })) };
      }),
    };
    const env = { ...preferenceEnv(), DB: db, TURN_KEY_ID: "turn-key", TURN_API_TOKEN: "turn-token", CLOUDFLARE_ACCOUNT_ID: "account-id", TURN_ANALYTICS_API_TOKEN: "analytics-token" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 100 } }] }] } },
    })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await jsonResponse(await handleApi(request("/api/turn/credentials"), env as any));

    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({ error: { code: "TURN_QUOTA_EXCEEDED" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queries.some((query) => query.includes("INSERT INTO usage_snapshots"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("fails open and issues relay credentials when sampled usage is unavailable", async () => {
    const authenticatedUser = { id: "user-1", display_name: "Caller", is_temporary: 1, expires_at: null, session_id: "session-1" };
    const db = {
      prepare: vi.fn((query: string) => ({ bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (query.includes("FROM sessions s JOIN users u")) return authenticatedUser;
          if (query.includes("turn_monthly_quota_bytes")) return { turn_monthly_quota_bytes: 100 };
          return null;
        }),
        run: vi.fn(async () => ({ success: true })),
      })) })),
    };
    const env = { ...preferenceEnv(), DB: db, TURN_KEY_ID: "turn-key", TURN_API_TOKEN: "turn-token", CLOUDFLARE_ACCOUNT_ID: "account-id", TURN_ANALYTICS_API_TOKEN: "analytics-token" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("analytics unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ iceServers: [] })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await jsonResponse(await handleApi(request("/api/turn/credentials"), env as any));

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("rtc.live.cloudflare.com");
  });

  it("does not query analytics for relay credentials when no per-user limit is set", async () => {
    const authenticatedUser = { id: "user-1", display_name: "Caller", is_temporary: 0, expires_at: null, session_id: "session-1" };
    const db = { prepare: vi.fn((query: string) => ({ bind: vi.fn(() => ({
      first: vi.fn(async () => query.includes("FROM sessions s JOIN users u") ? authenticatedUser : query.includes("turn_monthly_quota_bytes") ? { turn_monthly_quota_bytes: null } : null),
      run: vi.fn(async () => ({ success: true })),
    })) })) };
    const env = { ...preferenceEnv(), DB: db, TURN_KEY_ID: "turn-key", TURN_API_TOKEN: "turn-token", CLOUDFLARE_ACCOUNT_ID: "account-id", TURN_ANALYTICS_API_TOKEN: "analytics-token" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ iceServers: [] })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await jsonResponse(await handleApi(request("/api/turn/credentials"), env as any));

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("rtc.live.cloudflare.com");
    vi.unstubAllGlobals();
  });

  it("lets configured admins bulk-set monthly limits in decimal GB", async () => {
    const updates: Array<{ query: string; values: unknown[] }> = [];
    const authenticatedUser = { id: "user-1", display_name: "Admin", is_temporary: 0, expires_at: null, session_id: "session-1" };
    const db = {
      prepare: vi.fn((query: string) => ({ bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn(async () => query.includes("FROM sessions s JOIN users u") ? authenticatedUser : null),
        run: vi.fn(async () => { updates.push({ query, values }); return { success: true, meta: { changes: 3 } }; }),
      })) })),
    };
    const env = { ...preferenceEnv(), DB: db, ADMIN_USER_IDS: "user-1" };
    const result = await jsonResponse(await handleApi(request("/api/admin/quotas", { method: "PATCH", body: JSON.stringify({ applyToAll: true, quotaGb: 1.5 }) }), env as any));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, updated: 3 });
    expect(updates[0]?.query).toContain("turn_monthly_quota_bytes");
    expect(updates[0]?.values[0]).toBe(1_500_000_000);
  });

  it("maps a bounded provider abort to the existing TURN unavailable response", async () => {
    const fetchMock = vi.fn((_input: unknown, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = { ...preferenceEnv(), TURN_KEY_ID: "key-id", TURN_API_TOKEN: "provider-secret" };
    const pending = handleApi(request("/api/turn/credentials"), env);
    const result = await jsonResponse(await pending);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: "TURN_UNAVAILABLE" } });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    vi.unstubAllGlobals();
  });

  it("maps malformed and oversized provider bodies to invalid response without logging secrets", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "content-length": String(64 * 1024 + 1) } }));
    vi.stubGlobal("fetch", fetchMock);
    const env = { ...preferenceEnv(), TURN_KEY_ID: "key-id", TURN_API_TOKEN: "provider-secret" };

    const malformed = await jsonResponse(await handleApi(request("/api/turn/credentials"), env));
    const oversized = await jsonResponse(await handleApi(request("/api/turn/credentials"), env));
    expect(malformed).toMatchObject({ status: 502, body: { error: { code: "TURN_INVALID_RESPONSE" } } });
    expect(oversized).toMatchObject({ status: 502, body: { error: { code: "TURN_INVALID_RESPONSE" } } });
    expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({ body: expect.stringContaining("provider-secret") });
    vi.unstubAllGlobals();
  });
});
