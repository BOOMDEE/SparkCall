import type { Env } from "./env";
import { handleApi } from "./api";
import { handleRealtimeApi } from "./calls";
import { snapshotActiveUserUsage } from "./turn";

export { SparkCallDurableObject, SparkCallPresenceObject } from "./signaling";

function secureRealtimeResponse(response: Response, request: Request, env: Env) {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  const expectedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  if (origin && origin === expectedOrigin) {
    headers.set("access-control-allow-origin", expectedOrigin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "Origin");
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function scheduledWork(env: Env) {
  await Promise.all([
    env.DB.prepare("DELETE FROM sessions WHERE julianday(expires_at)<=julianday('now') OR revoked_at IS NOT NULL").run(),
    env.DB.prepare("DELETE FROM records WHERE expires_at IS NOT NULL AND julianday(expires_at)<=julianday('now')").run(),
    env.DB.prepare("UPDATE call_history SET status='timeout',ended_at=datetime('now'),duration_seconds=0 WHERE status IN ('calling','ringing','connecting') AND julianday(started_at)<=julianday('now','-2 minutes')").run(),
    env.DB.prepare("DELETE FROM login_attempts WHERE window_started_at<unixepoch()-86400").run(),
    env.DB.prepare("DELETE FROM usage_snapshots WHERE month<strftime('%Y-%m','now','-12 months')").run(),
    env.DB.prepare("DELETE FROM users WHERE is_temporary=1 AND expires_at IS NOT NULL AND julianday(expires_at)<=julianday('now')").run(),
  ]);
  await snapshotActiveUserUsage(env);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) {
      const realtime = await handleRealtimeApi(request, env);
      if (realtime) return secureRealtimeResponse(realtime, request, env);
      return handleApi(request, env);
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-frame-options", "DENY");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },

  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledWork(env).catch((cause) => {
      console.error("scheduled_work_failed", cause instanceof Error ? cause.message : "unknown");
    }));
  },
};
