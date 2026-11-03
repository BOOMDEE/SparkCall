import type { Env } from "./env";
import { now } from "./database";
import { getSiteConfiguration, getUserTurnPolicy } from "./configuration";

interface TurnAnalyticsResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        callsTurnUsageAdaptiveGroups?: Array<{
          dimensions?: { customIdentifier?: string | null; datetimeFiveMinutes?: string | null };
          sum?: { egressBytes?: number | null };
        }>;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
}

export interface TurnUsage {
  available: boolean;
  month: string;
  usedBytes: number | null;
  quotaBytes: number | null;
  remainingBytes: number | null;
  percentageUsed: number | null;
  lastUpdated: string | null;
  source: "cloudflare-realtime-analytics" | "cached-snapshot" | "unavailable";
  authoritative: false;
  note: string;
}

function currentMonthRange() {
  const end = new Date();
  return {
    month: end.toISOString().slice(0, 7),
    start: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)).toISOString(),
    end: end.toISOString(),
  };
}

function configuredQuota(env: Env): number | null {
  const value = Number(env.TURN_MONTHLY_QUOTA_BYTES);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function makeUsage(month: string, usedBytes: number | null, quotaBytes: number | null, lastUpdated: string | null, source: TurnUsage["source"]): TurnUsage {
  return {
    available: usedBytes !== null,
    month,
    usedBytes,
    quotaBytes,
    remainingBytes: usedBytes === null || quotaBytes === null ? null : Math.max(0, quotaBytes - usedBytes),
    percentageUsed: usedBytes === null || !quotaBytes ? null : Math.min(100, (usedBytes / quotaBytes) * 100),
    lastUpdated,
    source,
    authoritative: false,
    note: "Cloudflare Realtime Analytics is sampled and time-windowed and measures TURN relay egress only; successful P2P direct traffic is not counted. Limits may be exceeded before samples arrive and only prevent new TURN credential allocations; active calls are not interrupted.",
  };
}

async function queryEgress(env: Env, customIdentifier?: string): Promise<number> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.TURN_ANALYTICS_API_TOKEN) throw new Error("TURN analytics is not configured");
  const { start, end } = currentMonthRange();
  const account = JSON.stringify(env.CLOUDFLARE_ACCOUNT_ID);
  const startArg = JSON.stringify(start);
  const endArg = JSON.stringify(end);
  const identityFilter = customIdentifier ? `, customIdentifier: ${JSON.stringify(customIdentifier)}` : "";
  const grouping = customIdentifier
    ? `limit: 1\n          filter: { date_geq: ${startArg}, date_leq: ${endArg}${identityFilter} }\n          orderBy: [customIdentifier_ASC]`
    : `limit: 10000\n          filter: { date_geq: ${startArg}, date_leq: ${endArg} }\n          orderBy: [datetimeFiveMinutes_ASC]`;
  const dimensions = customIdentifier ? "dimensions { customIdentifier }" : "dimensions { datetimeFiveMinutes }";
  const query = `query SparkCallTurnUsage {
    viewer {
      accounts(filter: { accountTag: ${account} }) {
        callsTurnUsageAdaptiveGroups(${grouping}) {
          ${dimensions}
          sum { egressBytes }
        }
      }
    }
  }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${env.TURN_ANALYTICS_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Cloudflare TURN analytics returned ${response.status}`);
  const payload = await response.json() as TurnAnalyticsResponse;
  if (payload.errors?.length) throw new Error("Cloudflare TURN analytics query failed");
  const rows = payload.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups ?? [];
  return rows.reduce((total, row) => total + (Number.isFinite(row.sum?.egressBytes) ? Math.max(0, Number(row.sum?.egressBytes)) : 0), 0);
}

async function readSnapshot(env: Env, userId: string, month: string, quotaOverride?: number | null): Promise<TurnUsage | null> {
  const row = await env.DB.prepare("SELECT bytes_used, quota_bytes, captured_at FROM usage_snapshots WHERE user_id=?1 AND month=?2")
    .bind(userId, month).first<{ bytes_used: number; quota_bytes: number | null; captured_at: string }>();
  if (!row) return null;
  const quota = quotaOverride === undefined ? row.quota_bytes === null ? null : Number(row.quota_bytes) : quotaOverride;
  return makeUsage(month, Number(row.bytes_used), quota, row.captured_at, "cached-snapshot");
}

export async function getUserTurnUsage(env: Env, userId: string, quotaOverride?: number | null): Promise<TurnUsage> {
  const { month } = currentMonthRange();
  const quota = quotaOverride === undefined ? configuredQuota(env) : quotaOverride;
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.TURN_ANALYTICS_API_TOKEN) {
    return await readSnapshot(env, userId, month, quota) ?? makeUsage(month, null, quota, null, "unavailable");
  }
  try {
    const used = await queryEgress(env, userId);
    const capturedAt = now();
    await env.DB.prepare(`
      INSERT INTO usage_snapshots(id,user_id,month,bytes_used,quota_bytes,authoritative,captured_at)
      VALUES(lower(hex(randomblob(16))),?1,?2,?3,?4,0,?5)
      ON CONFLICT(user_id,month) DO UPDATE SET bytes_used=excluded.bytes_used,
        quota_bytes=excluded.quota_bytes,authoritative=0,captured_at=excluded.captured_at
    `).bind(userId, month, used, quota, capturedAt).run();
    return makeUsage(month, used, quota, capturedAt, "cloudflare-realtime-analytics");
  } catch (cause) {
    console.error("turn_analytics_user_query_failed", cause instanceof Error ? cause.message : "unknown");
    return await readSnapshot(env, userId, month, quota) ?? makeUsage(month, null, quota, null, "unavailable");
  }
}

/** Admin-only Cloudflare-account total retained for the existing administrator view. */
export async function getPlatformTurnUsage(env: Env) {
  const { month } = currentMonthRange();
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.TURN_ANALYTICS_API_TOKEN) return { available: false, month, usedBytes: null, lastUpdated: null, source: "unavailable", authoritative: false };
  const usedBytes = await queryEgress(env);
  return { available: true, month, usedBytes, lastUpdated: now(), source: "cloudflare-realtime-analytics", authoritative: false };
}

const AGGREGATE_NOTE = "SparkCall-only aggregate of sampled TURN relay egress snapshots; successful P2P direct traffic is not counted. No account-wide or per-user data is exposed. Estimates may be incomplete and are not real-time billing data.";

/** Public output contains only an app-wide total after the minimum contributor threshold is met. */
export async function getPublicTurnUsage(env: Env, minimumUsers: number) {
  const { month } = currentMonthRange();
  const row = await env.DB.prepare(`
    SELECT COUNT(DISTINCT s.user_id) AS contributors,COALESCE(SUM(s.bytes_used),0) AS used_bytes,MAX(s.captured_at) AS captured_at
    FROM usage_snapshots s JOIN users u ON u.id=s.user_id
    WHERE s.month=?1 AND s.authoritative=0 AND julianday(s.captured_at)<=julianday('now')
      AND (u.expires_at IS NULL OR julianday(u.expires_at)>julianday('now'))
  `).bind(month).first<{ contributors: number; used_bytes: number; captured_at: string | null }>();
  if (!row || Number(row.contributors) < minimumUsers) {
    return { available: false, month, usedBytes: null, lastUpdated: null, source: "cached-snapshot", authoritative: false, minimumUsersRequired: minimumUsers, note: AGGREGATE_NOTE };
  }
  return { available: true, month, usedBytes: Math.max(0, Number(row.used_bytes)), lastUpdated: row.captured_at, source: "cached-snapshot", authoritative: false, minimumUsersRequired: minimumUsers, note: AGGREGATE_NOTE };
}

/** Administrator-only temporary-account totals; rows are aggregated and never include user identifiers. */
export async function getTemporaryTurnUsage(env: Env, monthlyBudgetBytes: number | null) {
  const { month } = currentMonthRange();
  const row = await env.DB.prepare(`
    SELECT COUNT(DISTINCT u.id) AS active_users,COUNT(DISTINCT s.user_id) AS sampled_users,
      COALESCE(SUM(s.bytes_used),0) AS used_bytes,MAX(s.captured_at) AS captured_at
    FROM users u LEFT JOIN usage_snapshots s ON s.user_id=u.id AND s.month=?1 AND s.authoritative=0
    WHERE u.is_temporary=1 AND (u.expires_at IS NULL OR julianday(u.expires_at)>julianday('now'))
  `).bind(month).first<{ active_users: number; sampled_users: number; used_bytes: number; captured_at: string | null }>();
  const usedBytes = row && Number(row.sampled_users) > 0 ? Math.max(0, Number(row.used_bytes)) : null;
  return {
    available: usedBytes !== null,
    month,
    activeUsers: Number(row?.active_users ?? 0),
    sampledUsers: Number(row?.sampled_users ?? 0),
    usedBytes,
    monthlyBudgetBytes,
    remainingBudgetBytes: usedBytes === null || monthlyBudgetBytes === null ? null : Math.max(0, monthlyBudgetBytes - usedBytes),
    lastUpdated: row?.captured_at ?? null,
    authoritative: false,
    note: "Temporary-user totals use sampled TURN relay egress snapshots; P2P direct traffic is excluded. The group budget is display-only. Individual TURN limits may prevent new relay credentials after a delayed sample reaches the limit, but never interrupt an active call.",
  };
}

/** Hourly best-effort snapshots, rotating through at most 25 active users per run. */
export async function snapshotActiveUserUsage(env: Env): Promise<void> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.TURN_ANALYTICS_API_TOKEN) return;
  const configuration = await getSiteConfiguration(env);
  const cursor = await env.DB.prepare("SELECT last_user_id FROM turn_snapshot_cursor WHERE id=1").first<{ last_user_id: string | null }>();
  let rows = await env.DB.prepare(`
    SELECT DISTINCT u.id,u.is_temporary FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE julianday(s.expires_at)>julianday('now') AND (u.expires_at IS NULL OR julianday(u.expires_at)>julianday('now'))
      AND (?1 IS NULL OR u.id>?1) ORDER BY u.id LIMIT 25
  `).bind(cursor?.last_user_id ?? null).all<{ id: string; is_temporary: number }>();
  if (rows.results.length === 0 && cursor?.last_user_id) {
    await env.DB.prepare("UPDATE turn_snapshot_cursor SET last_user_id=NULL WHERE id=1").run();
    rows = await env.DB.prepare(`
      SELECT DISTINCT u.id,u.is_temporary FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE julianday(s.expires_at)>julianday('now') AND (u.expires_at IS NULL OR julianday(u.expires_at)>julianday('now'))
      ORDER BY u.id LIMIT 25
    `).all<{ id: string; is_temporary: number }>();
  }
  if (rows.results.length === 0) return;
  const { month } = currentMonthRange();
  for (const user of rows.results) {
    try {
      const used = await queryEgress(env, user.id);
      const capturedAt = now();
      const policy = await getUserTurnPolicy(env, configuration, user.id, !!user.is_temporary);
      const quota = policy.displayQuotaBytes;
      await env.DB.prepare(`
        INSERT INTO usage_snapshots(id,user_id,month,bytes_used,quota_bytes,authoritative,captured_at)
        VALUES(lower(hex(randomblob(16))),?1,?2,?3,?4,0,?5)
        ON CONFLICT(user_id,month) DO UPDATE SET bytes_used=excluded.bytes_used,
          quota_bytes=excluded.quota_bytes,authoritative=0,captured_at=excluded.captured_at
      `).bind(user.id, month, used, quota, capturedAt).run();
    } catch (cause) {
      console.error("turn_analytics_snapshot_failed", cause instanceof Error ? cause.message : "unknown");
    }
  }
  await env.DB.prepare("UPDATE turn_snapshot_cursor SET last_user_id=?1 WHERE id=1").bind(rows.results[rows.results.length - 1]?.id ?? null).run();
}
