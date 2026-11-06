import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatformTurnUsage, getUserTurnUsage, snapshotActiveUserUsage } from "./turn";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function analyticsResponse(egressBytes: number) {
  return new Response(JSON.stringify({
    data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes } }] }] } },
  }));
}

describe("TURN usage and user limits", () => {
  it("returns an unavailable platform estimate instead of throwing when analytics fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("analytics unavailable", { status: 503 })));
    const usage = await getPlatformTurnUsage({
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      TURN_ANALYTICS_API_TOKEN: "analytics-token",
    } as never);
    expect(usage).toMatchObject({ available: false, usedBytes: null, source: "unavailable", authoritative: false });
  });

  it("applies an individual monthly limit to sampled usage estimates", async () => {
    const queries: string[] = [];
    const bindings: unknown[][] = [];
    const db = {
      prepare: vi.fn((query: string) => {
        queries.push(query);
        return { bind: vi.fn((...values: unknown[]) => {
          bindings.push(values);
          return {
            first: vi.fn(async () => query.includes("turn_monthly_quota_bytes") ? { turn_monthly_quota_bytes: 100 } : null),
            run: vi.fn(async () => ({ success: true })),
          };
        }) };
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(analyticsResponse(125));
    vi.stubGlobal("fetch", fetchMock);

    const usage = await getUserTurnUsage({
      DB: db,
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      TURN_ANALYTICS_API_TOKEN: "analytics-token",
    } as never, "temporary-user-id");

    expect(usage).toMatchObject({ available: true, usedBytes: 125, quotaBytes: 100, remainingBytes: 0, percentageUsed: 100, limitEnforced: true });
    expect(JSON.stringify(fetchMock.mock.calls[0])).toContain("temporary-user-id");
    expect(queries.some((query) => query.includes("INSERT INTO usage_snapshots"))).toBe(true);
    expect(bindings.some((values) => values.includes(100))).toBe(true);
  });

  it("keeps temporary users in the active-account snapshot rotation", async () => {
    const queries: string[] = [];
    const snapshotBindings: unknown[][] = [];
    const db = {
      prepare: vi.fn((query: string) => {
        queries.push(query);
        return { first: vi.fn(async () => query.includes("turn_snapshot_cursor") ? { last_user_id: null } : null), bind: vi.fn((...values: unknown[]) => {
          snapshotBindings.push(values);
          return {
            first: vi.fn(async () => query.includes("turn_snapshot_cursor") ? { last_user_id: null } : null),
            all: vi.fn(async () => ({ results: [{ id: "temporary-user-id", turn_monthly_quota_bytes: 250 }] })),
            run: vi.fn(async () => ({ success: true })),
          };
        }) };
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(analyticsResponse(40));
    vi.stubGlobal("fetch", fetchMock);

    await snapshotActiveUserUsage({
      DB: db,
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      TURN_ANALYTICS_API_TOKEN: "analytics-token",
    } as never);

    const selection = queries.find((query) => query.includes("SELECT DISTINCT u.id"));
    expect(selection).toContain("u.turn_monthly_quota_bytes");
    expect(selection).not.toContain("is_temporary=0");
    expect(JSON.stringify(fetchMock.mock.calls[0])).toContain("temporary-user-id");
    expect(snapshotBindings.some((values) => values.includes("temporary-user-id") && values.includes(250))).toBe(true);
  });
});
