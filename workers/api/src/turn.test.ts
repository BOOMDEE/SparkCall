import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatformTurnLimitStatus, getPlatformTurnUsage, getPublicTurnUsage, getUserTurnUsage } from "./turn";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function analyticsResponse(egressBytes: number) {
  return new Response(JSON.stringify({
    data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ dimensions: { datetimeFiveMinutes: "2026-11-06T10:00:00Z" }, sum: { egressBytes } }] }] } },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function publicUsageEnv(row: { contributors: number; used_bytes: number; captured_at: string | null } | null) {
  const first = vi.fn(async () => row);
  const bind = vi.fn(() => ({ first }));
  let lastQuery = "";
  const prepare = vi.fn((query: string) => { lastQuery = query; return { bind }; });
  return { DB: { prepare } as any, getQuery: () => lastQuery };
}

describe("public TURN usage privacy boundary", () => {
  it("does not publish a cohort below the configured active-user threshold", async () => {
    const env = publicUsageEnv({ contributors: 4, used_bytes: 10_000, captured_at: "2026-11-03T10:00:00.000Z" });
    const usage = await getPublicTurnUsage(env as any, 5);

    expect(usage.available).toBe(false);
    expect(usage.usedBytes).toBeNull();
    expect(usage.minimumUsersRequired).toBe(5);
    expect(usage).not.toHaveProperty("userId");
  });

  it("counts only active users and returns an app aggregate with no user identifiers", async () => {
    const env = publicUsageEnv({ contributors: 5, used_bytes: 15, captured_at: "2026-11-03T10:00:00.000Z" });
    const usage = await getPublicTurnUsage(env as any, 5);

    expect(env.getQuery()).toContain("u.expires_at IS NULL OR julianday(u.expires_at)>julianday('now')");
    expect(usage).toMatchObject({ available: true, usedBytes: 15, minimumUsersRequired: 5, authoritative: false });
    expect(usage).not.toHaveProperty("userId");
    expect(JSON.stringify(usage)).not.toContain("public-active");
  });
});

describe("SparkCall deployment TURN cap scope", () => {
  it.each([
    ["2026-11-30T23:59:59.999Z", "2026-11-01", "2026-11-30"],
    ["2026-12-01T00:00:00.001Z", "2026-12-01", "2026-12-01"],
  ])("uses GraphQL Date calendar bounds at %s", async (instant, start, end) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    const fetchMock = vi.fn().mockResolvedValue(analyticsResponse(0));
    vi.stubGlobal("fetch", fetchMock);
    const usage = await getPlatformTurnUsage({
      CLOUDFLARE_ACCOUNT_ID: `date-format-${end}`,
      TURN_KEY_ID: "date-format-key",
      TURN_ANALYTICS_API_TOKEN: "test-only-token",
      TURN_PLATFORM_MONTHLY_LIMIT_BYTES: "800000000000",
    } as any);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { query: string };
    expect(body.query).toContain(`date_geq: "${start}"`);
    expect(body.query).toContain(`date_leq: "${end}"`);
    expect(body.query).not.toMatch(/date_(?:geq|leq): "[^"]*T/);
    expect(usage).toMatchObject({ available: true, month: start.slice(0, 7), usedBytes: 0 });
  });

  it.each([0, 799_999_999_999, 800_000_000_000])("compares a monthly sample of %s bytes to the 800 GB threshold", async (usedBytes) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(analyticsResponse(usedBytes)));
    const status = await getPlatformTurnLimitStatus({
      CLOUDFLARE_ACCOUNT_ID: `threshold-account-${usedBytes}`,
      TURN_KEY_ID: "threshold-key",
      TURN_ANALYTICS_API_TOKEN: "test-only-token",
      TURN_PLATFORM_MONTHLY_LIMIT_BYTES: "800000000000",
    } as any);
    expect(status).toMatchObject({ available: true, usedBytes, reached: usedBytes >= 800_000_000_000 });
  });

  it("marks a missing Analytics dataset unavailable rather than zero usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { viewer: { accounts: [] } } }), { status: 200 })));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const status = await getPlatformTurnLimitStatus({
      CLOUDFLARE_ACCOUNT_ID: "malformed-account",
      TURN_KEY_ID: "malformed-key",
      TURN_ANALYTICS_API_TOKEN: "test-only-token",
      TURN_PLATFORM_MONTHLY_LIMIT_BYTES: "800000000000",
    } as any);
    expect(status).toMatchObject({ available: false, usedBytes: null, reached: false });
  });

  it("reports the configured platform cap using only the configured TURN key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(analyticsResponse(810_000_000_000));
    vi.stubGlobal("fetch", fetchMock);
    const usage = await getPlatformTurnUsage({
      CLOUDFLARE_ACCOUNT_ID: "display-account",
      TURN_KEY_ID: "sparkcall-turn-key",
      TURN_ANALYTICS_API_TOKEN: "test-only-token",
      TURN_PLATFORM_MONTHLY_LIMIT_BYTES: "800000000000",
    } as any);

    expect(usage).toMatchObject({
      available: true,
      usedBytes: 810_000_000_000,
      quotaBytes: 800_000_000_000,
      remainingBytes: 0,
      limitConfigured: true,
      enforcementAvailable: true,
      authoritative: false,
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { query: string };
    expect(requestBody.query).toContain('keyId: "sparkcall-turn-key"');
    expect(requestBody.query).not.toContain("test-only-token");
  });

  it("filters per-user usage by both project TURN key and custom identifier", async () => {
    const fetchMock = vi.fn().mockResolvedValue(analyticsResponse(128));
    vi.stubGlobal("fetch", fetchMock);
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      CLOUDFLARE_ACCOUNT_ID: "user-scope-account",
      TURN_KEY_ID: "sparkcall-user-key",
      TURN_ANALYTICS_API_TOKEN: "test-only-token",
      DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })) },
    };

    const usage = await getUserTurnUsage(env as any, "user-one", 1_000);
    expect(usage.usedBytes).toBe(128);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { query: string };
    expect(requestBody.query).toContain('keyId: "sparkcall-user-key"');
    expect(requestBody.query).toContain('customIdentifier: "user-one"');
  });

  it("fails open and keeps the configured cap visible when Analytics is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const status = await getPlatformTurnLimitStatus({
      CLOUDFLARE_ACCOUNT_ID: "missing-token-account",
      TURN_KEY_ID: "sparkcall-key",
      TURN_PLATFORM_MONTHLY_LIMIT_BYTES: "800000000000",
    } as any);

    expect(status).toMatchObject({ available: false, usedBytes: null, limitBytes: 800_000_000_000, limitConfigured: true, reached: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails open on an Analytics error instead of blocking new calls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const status = await getPlatformTurnLimitStatus({
      CLOUDFLARE_ACCOUNT_ID: "offline-account",
      TURN_KEY_ID: "sparkcall-key",
      TURN_ANALYTICS_API_TOKEN: "test-only-token",
      TURN_PLATFORM_MONTHLY_LIMIT_BYTES: "800000000000",
    } as any);

    expect(status).toMatchObject({ available: false, usedBytes: null, limitConfigured: true, reached: false });
  });
});
