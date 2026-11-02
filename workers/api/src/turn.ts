import type { Env } from "./env";
import { now } from "./database";

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
    note: "Cloudflare Realtime Analytics is sampled and time-windowed; this dashboard is an estimate, not exact real-time billing data. TURN billing measures egress bytes.",
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

async function readSnapshot(env: Env, userId: string, month: string): Promise<TurnUsage | null> {
  const row = await env.DB.prepare("SELECT bytes_used, quota_bytes, captured_at FROM usage_snapshots WHERE user_id=?1 AND month=?2")
    .bind(userId, month).first<{ bytes_used: number; quota_bytes: number | null; captured_at: string }>();
  if (!row) return null;
  return makeUsage(month, Number(row.bytes_used), row.quota_bytes === null ? null : Number(row.quota_bytes), row.captured_at, "cached-snapshot");
}

export async function getUserTurnUsage(env: Env, userId: string): Promise<TurnUsage> {
  const { month } = currentMonthRange();
  const quota = configuredQuota(env);
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.TURN_ANALYTICS_API_TOKEN) {
    return await readSnapshot(env, userId, month) ?? makeUsage(month, null, quota, null, "unavailable");
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
    return await readSnapshot(env, userId, month) ?? makeUsage(month, null, quota, null, "unavailable");
  }
}

export async function getPlatformTurnUsage(env: Env) {
  const { month } = currentMonthRange();
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.TURN_ANALYTICS_API_TOKEN) return { available: false, month, usedBytes: null, lastUpdated: null, source: "unavailable", authoritative: false };
  const usedBytes = await queryEgress(env);
  return { available: true, month, usedBytes, lastUpdated: now(), source: "cloudflare-realtime-analytics", authoritative: false };
}

/** Hourly best-effort snapshots, rotating through at most 25 active users per run. */
export async function snapshotActiveUserUsage(env: Env): Promise<void> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.TURN_ANALYTICS_API_TOKEN) return;
  const cursor = await env.DB.prepare("SELECT last_user_id FROM turn_snapshot_cursor WHERE id=1").first<{ last_user_id: string | null }>();
  let rows = await env.DB.prepare(`
    SELECT DISTINCT u.id FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE julianday(s.expires_at)>julianday('now') AND (u.expires_at IS NULL OR julianday(u.expires_at)>julianday('now'))
      AND (?1 IS NULL OR u.id>?1) ORDER BY u.id LIMIT 25
  `).bind(cursor?.last_user_id ?? null).all<{ id: string }>();
  if (rows.results.length === 0 && cursor?.last_user_id) {
    await env.DB.prepare("UPDATE turn_snapshot_cursor SET last_user_id=NULL WHERE id=1").run();
    rows = await env.DB.prepare(`
      SELECT DISTINCT u.id FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE julianday(s.expires_at)>julianday('now') AND (u.expires_at IS NULL OR julianday(u.expires_at)>julianday('now'))
      ORDER BY u.id LIMIT 25
    `).all<{ id: string }>();
  }
  if (rows.results.length === 0) return;
  const { month } = currentMonthRange();
  const quota = configuredQuota(env);
  for (const user of rows.results) {
    try {
      const used = await queryEgress(env, user.id);
      const capturedAt = now();
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
