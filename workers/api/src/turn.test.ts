import { describe, expect, it, vi } from "vitest";
import { getPublicTurnUsage } from "./turn";

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
