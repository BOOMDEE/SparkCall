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
      query,
    };
    return statement;
  });
  const batch = vi.fn(async (statements: Array<{ query: string }>) => statements.map(() => ({ success: true, meta: { changes: 1 } })));
  return { DB: { prepare, batch }, ALLOWED_ORIGIN: "https://example.test" } as any;
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

  it("keeps admin settings allowlisted and never projects the analytics token to the public API", async () => {
    const tokenSentinel = "test-only-analytics-token-sentinel";
    const env = { ...preferenceEnv(), TURN_ANALYTICS_API_TOKEN: tokenSentinel };
    const denied = await jsonResponse(await handleApi(request("/api/admin/config"), env));
    expect(denied.status).toBe(404);

    const publicResponse = await jsonResponse(await handleApi(request("/api/config"), env));
    expect(publicResponse.status).toBe(200);
    expect(JSON.stringify(publicResponse.body)).not.toContain(tokenSentinel);
    expect(publicResponse.body).not.toHaveProperty("platformUsage");

    env.ADMIN_USER_IDS = user.id;
    const allowed = await jsonResponse(await handleApi(request("/api/admin/config"), env));
    expect(allowed.status).toBe(200);
    expect(JSON.stringify(allowed.body)).not.toContain(tokenSentinel);
  });

  it("commits administrator configuration and its audit row in the same D1 batch", async () => {
    const env = preferenceEnv();
    env.ADMIN_USER_IDS = user.id;
    const update = await jsonResponse(await handleApi(request("/api/admin/config", {
      method: "PATCH",
      body: JSON.stringify({ configuration: { branding: { productName: "Preview SparkCall" } } }),
    }), env));
    expect(update.status).toBe(200);
    expect(env.DB.batch).toHaveBeenCalledTimes(1);
    const updateStatements = env.DB.batch.mock.calls[0]?.[0] ?? [];
    expect(updateStatements).toHaveLength(2);
    expect(updateStatements[0]?.query).toContain("INSERT INTO app_settings");
    expect(updateStatements[1]?.query).toContain("INSERT INTO admin_audit");

    const reset = await jsonResponse(await handleApi(request("/api/admin/config", { method: "DELETE" }), env));
    expect(reset.status).toBe(200);
    expect(env.DB.batch).toHaveBeenCalledTimes(2);
    const resetStatements = env.DB.batch.mock.calls[1]?.[0] ?? [];
    expect(resetStatements).toHaveLength(2);
    expect(resetStatements[0]?.query).toContain("DELETE FROM app_settings");
    expect(resetStatements[1]?.query).toContain("INSERT INTO admin_audit");
  });
});
