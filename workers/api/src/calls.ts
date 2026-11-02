import type { Env } from "./env";
import { rateLimit, requireAuth } from "./auth";
import { body, error, findByNumber, id, isBlocked, json, now, validDialNumber } from "./database";

const ACTIVE = "'calling','ringing','connecting','connected'";

function isSameOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return origin === (env.ALLOWED_ORIGIN || new URL(request.url).origin); } catch { return false; }
}

function internalHeaders(request: Request, env: Env, extra: Record<string, string>) {
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Authorization");
  headers.delete("X-SparkCall-Internal-Token");
  headers.delete("X-SparkCall-User-ID");
  headers.delete("X-SparkCall-Session-ID");
  headers.delete("X-SparkCall-Role");
  headers.set("X-SparkCall-Internal-Token", env.SPARKCALL_INTERNAL_TOKEN || "");
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

async function createCall(request: Request, env: Env): Promise<Response> {
  const caller = await requireAuth(request, env);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!await rateLimit(env, `calls:user:${caller.id}`, 10, 60)
    || !await rateLimit(env, `calls:ip:${ip}`, 60, 60)) {
    return error("Too many call attempts; try again shortly", 429, "RATE_LIMITED");
  }
  const input = await body(request);
  const number = String(input.number ?? input.targetNumber ?? "").trim();
  if (!validDialNumber(number)) return error("Enter a valid SparkCall number", 400, "INVALID_NUMBER");
  const callee = await findByNumber(env.DB, number);
  if (!callee) return error("SparkCall number not found", 404, "NUMBER_NOT_FOUND");
  if (callee.id === caller.id) return error("You cannot call yourself", 400, "SELF_CALL");
  if (await isBlocked(env.DB, caller.id, callee.id) || await isBlocked(env.DB, callee.id, caller.id)) return error("This call is not allowed", 403, "CALL_BLOCKED");
  const preferences = await env.DB.prepare("SELECT settings_json FROM user_preferences WHERE user_id=?1").bind(callee.id).first<{ settings_json: string }>();
  if (preferences && JSON.parse(preferences.settings_json)?.allowIncoming === false) return error("This user is not accepting calls", 403, "CALLS_DISABLED");

  const active = await env.DB.prepare(`
    SELECT 1 FROM call_history
    WHERE (caller_id=?1 OR recipient_id=?1 OR caller_id=?2 OR recipient_id=?2)
      AND (status='connected' OR (status IN (${ACTIVE}) AND julianday(started_at)>julianday('now','-2 minutes')))
    LIMIT 1
  `).bind(caller.id, callee.id).first();
  if (active) return error("One of the users is already on a call", 409, "USER_BUSY");
  if (!env.SPARKCALL_INTERNAL_TOKEN) return error("Calling service is not configured", 503, "SIGNALING_UNAVAILABLE");

  const callId = id();
  const createdAt = now();
  await env.DB.prepare(`
    INSERT INTO call_history(id,caller_id,recipient_id,caller_number,recipient_number,started_at,status,created_at)
    VALUES(?1,?2,?3,?4,?5,?6,'calling',?6)
  `).bind(callId, caller.id, callee.id, caller.number ?? null, callee.number, createdAt).run();

  try {
    const presence = env.PRESENCE.get(env.PRESENCE.idFromName(callee.id));
    const response = await presence.fetch("https://presence.internal/invite", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-SparkCall-Internal-Token": env.SPARKCALL_INTERNAL_TOKEN,
        "X-SparkCall-User-ID": callee.id,
      },
      body: JSON.stringify({
        callId,
        callerNumber: caller.number || "SparkCall member",
        callerName: caller.display_name || "SparkCall member",
        createdAt: Date.now(),
        expiresAt: Date.now() + 45_000,
      }),
    });
    if (!response.ok) throw new Error("Presence invite failed");
  } catch (cause) {
    console.error("call_invite_failed", cause instanceof Error ? cause.message : "unknown");
    await env.DB.prepare("UPDATE call_history SET status='failed',ended_at=datetime('now') WHERE id=?1").bind(callId).run();
    return error("Could not notify the recipient", 503, "PRESENCE_UNAVAILABLE");
  }
  return json({ callId, userId: callee.id, targetNumber: callee.number, status: "CALLING" }, 201);
}

async function cancelCall(request: Request, env: Env, callId: string): Promise<Response> {
  const caller = await requireAuth(request, env);
  const call = await env.DB.prepare("SELECT id,caller_id,recipient_id,status FROM call_history WHERE id=?1")
    .bind(callId).first<{ id: string; caller_id: string; recipient_id: string; status: string }>();
  if (!call) return error("Call not found", 404, "NOT_FOUND");
  if (call.caller_id !== caller.id) return error("Only the caller can cancel this request", 403, "FORBIDDEN");
  if (call.status === "connected") return error("Use hang up after the call connects", 409, "CALL_CONNECTED");
  if (["ended", "rejected", "busy", "timeout", "failed", "cancelled"].includes(call.status)) return json({ ok: true });
  if (!env.SPARKCALL_INTERNAL_TOKEN) return error("Calling service is not configured", 503, "SIGNALING_UNAVAILABLE");
  const signaling = env.SIGNALING.get(env.SIGNALING.idFromName(callId));
  const signalResponse = await signaling.fetch("https://signaling.internal/cancel", {
    method: "POST",
    headers: { "X-SparkCall-Internal-Token": env.SPARKCALL_INTERNAL_TOKEN, "X-SparkCall-Call-ID": callId, "X-SparkCall-Caller-ID": caller.id },
  });
  if (signalResponse.status === 409) return error("The call connected; use hang up instead", 409, "CALL_CONNECTED");
  await env.DB.prepare("UPDATE call_history SET status='cancelled',ended_at=datetime('now'),duration_seconds=0 WHERE id=?1 AND caller_id=?2 AND status IN ('calling','ringing','connecting')")
    .bind(callId, caller.id).run();
  try {
    const presence = env.PRESENCE.get(env.PRESENCE.idFromName(call.recipient_id));
    await presence.fetch("https://presence.internal/invite-ended", {
      method: "POST",
      headers: { "content-type": "application/json", "X-SparkCall-Internal-Token": env.SPARKCALL_INTERNAL_TOKEN || "", "X-SparkCall-User-ID": call.recipient_id },
      body: JSON.stringify({ callId }),
    });
  } catch { /* The invitation will also expire automatically. */ }
  return json({ ok: true });
}

export async function handleRealtimeApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/api/calls" && request.method === "POST") {
      if (!isSameOrigin(request, env)) return error("Cross-site request rejected", 403, "CSRF");
      return await createCall(request, env);
    }
    const cancelMatch = path.match(/^\/api\/calls\/([^/]+)\/cancel$/);
    if (cancelMatch && request.method === "POST") {
      if (!isSameOrigin(request, env)) return error("Cross-site request rejected", 403, "CSRF");
      return await cancelCall(request, env, decodeURIComponent(cancelMatch[1]!));
    }
    if (path === "/api/presence") {
      if (request.method !== "GET") return error("Method not allowed", 405, "METHOD_NOT_ALLOWED");
      if (!isSameOrigin(request, env)) return error("Cross-site request rejected", 403, "CSRF");
      if (!env.SPARKCALL_INTERNAL_TOKEN) return error("Presence service is not configured", 503, "SIGNALING_UNAVAILABLE");
      const user = await requireAuth(request, env);
      const headers = internalHeaders(request, env, {
        "X-SparkCall-User-ID": user.id,
        "X-SparkCall-Session-ID": user.session_id,
      });
      const presence = env.PRESENCE.get(env.PRESENCE.idFromName(user.id));
      return presence.fetch(new Request(request, { headers }));
    }
    const signalMatch = path.match(/^\/api\/calls\/([^/]+)\/signaling$/);
    if (signalMatch) {
      if (request.method !== "GET") return error("Method not allowed", 405, "METHOD_NOT_ALLOWED");
      if (!isSameOrigin(request, env)) return error("Cross-site request rejected", 403, "CSRF");
      if (!env.SPARKCALL_INTERNAL_TOKEN) return error("Signaling service is not configured", 503, "SIGNALING_UNAVAILABLE");
      const user = await requireAuth(request, env);
      const callId = decodeURIComponent(signalMatch[1]!);
      const call = await env.DB.prepare(`
        SELECT id,caller_id,recipient_id,status FROM call_history WHERE id=?1
      `).bind(callId).first<{ id: string; caller_id: string; recipient_id: string; status: string }>();
      if (!call) return error("Call not found", 404, "NOT_FOUND");
      const role = call.caller_id === user.id ? "caller" : call.recipient_id === user.id ? "callee" : null;
      if (!role) return error("Not a call participant", 403, "FORBIDDEN");
      if (["ended", "rejected", "busy", "timeout", "failed", "cancelled"].includes(call.status)) return error("Call has ended", 410, "CALL_ENDED");
      const headers = internalHeaders(request, env, {
        "X-SparkCall-Call-ID": call.id,
        "X-SparkCall-User-ID": user.id,
        "X-SparkCall-Session-ID": user.session_id,
        "X-SparkCall-Caller-ID": call.caller_id,
        "X-SparkCall-Callee-ID": call.recipient_id,
        "X-SparkCall-Role": role,
      });
      const stub = env.SIGNALING.get(env.SIGNALING.idFromName(call.id));
      return stub.fetch(new Request(request, { headers }));
    }
    return null;
  } catch (cause) {
    if (cause instanceof Response) return cause;
    console.error("realtime_api_error", cause instanceof Error ? cause.message : "unknown");
    return error("Internal server error", 500, "INTERNAL_ERROR");
  }
}
