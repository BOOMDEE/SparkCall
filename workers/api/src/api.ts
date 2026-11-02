import type { Env } from "./env";
import { authenticate, clearSessionCookie, createSession, hashPassword, hashToken, newToken, requireAuth, revokeSession, sessionCookie, verifyPassword, rateLimit } from "./auth";
import { body, error, findByNumber, findUser, id, json, now, publicUser, text, validDialNumber, validNumber, validSlug, validUsername } from "./database";
import { getPlatformTurnUsage, getUserTurnUsage } from "./turn";
import { saveWebhook, validateResolvedHost, validateWebhookUrl, webhookConfigured } from "./webhook";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const RESERVED = new Set(["admin", "api", "call", "callrecords", "contact", "help", "root", "sparkcall", "support", "system"]);
const DEFAULT_PREFERENCES = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  audioInputDeviceId: "",
  audioOutputDeviceId: "",
  bitrateMode: "standard",
  bitrateKbps: 32,
  allowIncoming: true,
  forceTurn: false,
  showOnlineStatus: true,
  theme: "system",
};
const TURN_PROVIDER_TIMEOUT_MS = 5_000;
const TURN_PROVIDER_MAX_RESPONSE_BYTES = 64 * 1024;

function withSecurity(response: Response, request: Request, env: Env) {
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

function csrf(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return origin === (env.ALLOWED_ORIGIN || new URL(request.url).origin); } catch { return false; }
}

function isReserved(value: string) {
  return RESERVED.has(value.toLowerCase());
}

function parseArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= maxLength))].slice(0, maxItems);
}

function cleanMetadata(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  const forbidden = /(email|token|secret|password|credential|session|internal.?id|auth|cookie)/i;
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(key) || forbidden.test(key)) continue;
    if (typeof item === "string" && item.length <= 500) result[key] = item;
    else if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
    else if (typeof item === "boolean") result[key] = item;
  }
  return result;
}

function cleanParticipants(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((participant) => {
    if (!participant || typeof participant !== "object" || Array.isArray(participant)) return [];
    const entry = participant as Record<string, unknown>;
    if (entry.consent !== true || typeof entry.displayName !== "string") return [];
    const displayName = entry.displayName.trim().slice(0, 80);
    return displayName ? [{ displayName }] : [];
  });
}

function expiredAt(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || millis <= Date.now()) return undefined;
  return new Date(millis).toISOString();
}

async function newTempNumber(env: Env) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const number = `SC-TMP-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    if (!await findByNumber(env.DB, number)) return number;
  }
  throw error("Could not allocate a temporary number", 503, "NUMBER_UNAVAILABLE");
}

async function register(env: Env, username: string, password: string, displayName?: string) {
  const accountName = username.trim();
  if (!validUsername(accountName) || password.length < 12 || password.length > 200) {
    throw error("Username must be 3–32 characters and password at least 12 characters", 400, "INVALID_CREDENTIALS");
  }
  const userId = id();
  const created = now();
  try {
    await env.DB.prepare(`
      INSERT INTO users(id,username,password_hash,display_name,is_temporary,created_at,updated_at)
      VALUES(?1,?2,?3,?4,0,?5,?5)
    `).bind(userId, accountName, await hashPassword(password), text(displayName, 80)?.trim() || accountName, created).run();
  } catch (cause) {
    if (cause instanceof Error && /unique|constraint/i.test(cause.message)) throw error("Username is already in use", 409, "USERNAME_TAKEN");
    throw cause;
  }
  const session = await createSession(env, userId, false);
  return json({ user: publicUser(await findUser(env.DB, userId)) }, 201, { "set-cookie": sessionCookie(session.token, session.ttl) });
}

function recordObject(row: any, includeOwner: boolean) {
  const result: Record<string, unknown> = {
    slug: row.slug,
    title: row.title,
    description: row.description,
    notes: row.notes,
    tags: JSON.parse(row.tags_json || "[]"),
    participants: JSON.parse(row.participants_json || "[]"),
    metadata: cleanMetadata(JSON.parse(row.metadata_json || "{}")),
    isPublic: !!row.is_public,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeOwner) result.id = row.id;
  if (row.call_started_at) result.startedAt = row.call_started_at;
  if (row.call_ended_at) result.endedAt = row.call_ended_at;
  if (row.call_duration_seconds !== null && row.call_duration_seconds !== undefined) result.durationSeconds = row.call_duration_seconds;
  return result;
}

async function findRecord(env: Env, key: string) {
  return env.DB.prepare(`
    SELECT r.*, COALESCE(c.started_at,r.record_started_at) AS call_started_at,
      COALESCE(c.ended_at,r.record_ended_at) AS call_ended_at,
      COALESCE(c.duration_seconds,r.record_duration_seconds) AS call_duration_seconds
    FROM records r LEFT JOIN call_history c ON c.id=r.call_id
    WHERE r.id=?1 OR r.slug=?1 COLLATE NOCASE LIMIT 1
  `).bind(key).first<any>();
}

async function ownedRecord(request: Request, env: Env, key: string) {
  const row = await findRecord(env, key);
  if (!row) throw error("Record not found", 404, "NOT_FOUND");
  const user = await authenticate(request, env);
  if (user?.id === row.owner_id) return { row, user };
  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const cookieName = `sparkcall_record_${row.id}`;
  const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  const cookieCapability = cookie?.slice(cookieName.length + 1) || "";
  const capability = bearer || cookieCapability;
  if (capability && row.owner_capability_hash && await hashToken(capability) === row.owner_capability_hash) return { row, user: null };
  throw error("Record not found", 404, "NOT_FOUND");
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  if (!METHODS.has(method)) return error("Method not allowed", 405, "METHOD_NOT_ALLOWED");
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type,authorization", "access-control-max-age": "86400" } });
  }
  if (!path.startsWith("/api/")) return error("Not found", 404, "NOT_FOUND");
  if (method !== "GET" && !csrf(request, env)) return error("Cross-site request rejected", 403, "CSRF");

  if (path === "/api/session" && method === "GET") {
    const user = await authenticate(request, env);
    return json({ authenticated: !!user, user: user ? publicUser(user) : null });
  }
  if (path === "/api/auth/register" && method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!await rateLimit(env, `register:${ip}`, 5, 3600)) return error("Too many registration attempts", 429, "RATE_LIMITED");
    const input = await body(request);
    return register(env, String(input.username ?? ""), String(input.password ?? ""), text(input.displayName, 80));
  }
  if (path === "/api/auth/login" && method === "POST") {
    const input = await body(request);
    const username = String(input.username ?? "");
    const password = String(input.password ?? "");
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const allowed = await rateLimit(env, `login-ip:${ip}`, 40, 900)
      && await rateLimit(env, `login:${ip}:${username.toLowerCase()}`, 10, 900);
    if (!validUsername(username) || password.length < 1 || password.length > 200 || !allowed) {
      return error("Invalid username or password", allowed ? 401 : 429, allowed ? "INVALID_CREDENTIALS" : "RATE_LIMITED");
    }
    const user = await env.DB.prepare("SELECT * FROM users WHERE username=?1 COLLATE NOCASE AND is_temporary=0")
      .bind(username).first<any>();
    if (!user || !(await verifyPassword(password, user.password_hash))) return error("Invalid username or password", 401, "INVALID_CREDENTIALS");
    const session = await createSession(env, user.id, false);
    return json({ user: publicUser(user) }, 200, { "set-cookie": sessionCookie(session.token, session.ttl) });
  }
  if (path === "/api/auth/guest" && method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!await rateLimit(env, `guest:${ip}`, 8, 3600)) return error("Too many temporary accounts from this network", 429, "RATE_LIMITED");
    const userId = id();
    const number = await newTempNumber(env);
    const timestamp = now();
    await env.DB.prepare(`
      INSERT INTO users(id,display_name,number,is_temporary,expires_at,created_at,updated_at)
      VALUES(?1,?2,?3,1,datetime('now','+24 hours'),?4,?4)
    `).bind(userId, `Guest ${number.slice(-6)}`, number, timestamp).run();
    const session = await createSession(env, userId, true);
    return json({ user: publicUser(await findUser(env.DB, userId)) }, 201, { "set-cookie": sessionCookie(session.token, session.ttl) });
  }
  if (path === "/api/auth/logout" && method === "POST") {
    await revokeSession(request, env);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }
  if (path === "/api/auth/upgrade" && method === "POST") {
    const user = await requireAuth(request, env);
    if (!user.is_temporary) return error("Account is already permanent", 409, "NOT_TEMPORARY");
    const input = await body(request);
    const username = String(input.username ?? "").trim();
    const password = String(input.password ?? "");
    if (!validUsername(username) || password.length < 12 || password.length > 200) return error("Invalid account details", 400, "INVALID_CREDENTIALS");
    try {
      await env.DB.prepare("UPDATE users SET username=?1,password_hash=?2,is_temporary=0,expires_at=NULL,updated_at=?3 WHERE id=?4 AND is_temporary=1")
        .bind(username, await hashPassword(password), now(), user.id).run();
    } catch (cause) {
      if (cause instanceof Error && /unique|constraint/i.test(cause.message)) return error("Username is already in use", 409, "USERNAME_TAKEN");
      throw cause;
    }
    return json({ user: publicUser(await findUser(env.DB, user.id)) });
  }

  if (path === "/api/me" && method === "GET") return json({ user: publicUser(await requireAuth(request, env)) });
  if (path === "/api/me" && method === "PATCH") {
    const user = await requireAuth(request, env);
    const input = await body(request);
    const displayName = text(input.displayName, 80)?.trim();
    if (!displayName) return error("A display name of at most 80 characters is required");
    await env.DB.prepare("UPDATE users SET display_name=?1,updated_at=?2 WHERE id=?3").bind(displayName, now(), user.id).run();
    return json({ user: publicUser(await findUser(env.DB, user.id)) });
  }

  if (path === "/api/settings/preferences" && method === "GET") {
    const user = await requireAuth(request, env);
    const row = await env.DB.prepare("SELECT settings_json, version FROM user_preferences WHERE user_id=?1").bind(user.id).first<{ settings_json: string; version: number }>();
    return json({ preferences: { ...DEFAULT_PREFERENCES, ...(row ? JSON.parse(row.settings_json) : {}) }, version: row?.version ?? 0 });
  }
  if (path === "/api/settings/preferences" && method === "PATCH") {
    const user = await requireAuth(request, env);
    const input = await body(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["echoCancellation", "noiseSuppression", "autoGainControl", "allowIncoming", "showOnlineStatus", "forceTurn"] as const) {
      if (typeof input[key] === "boolean") patch[key] = input[key];
    }
    for (const key of ["audioInputDeviceId", "audioOutputDeviceId"] as const) {
      if (typeof input[key] === "string" && input[key].length <= 256) patch[key] = input[key];
    }
    if (input.bitrateMode === "low" || input.bitrateMode === "standard" || input.bitrateMode === "high" || input.bitrateMode === "custom") patch.bitrateMode = input.bitrateMode;
    if (Number.isInteger(input.bitrateKbps) && Number(input.bitrateKbps) >= 6 && Number(input.bitrateKbps) <= 128) patch.bitrateKbps = Number(input.bitrateKbps);
    if (input.theme === "light" || input.theme === "dark" || input.theme === "system") patch.theme = input.theme;
    const timestamp = now();
    const row = await env.DB.prepare(`
      INSERT INTO user_preferences(user_id,settings_json,updated_at,version) VALUES(?1,?2,?3,1)
      ON CONFLICT(user_id) DO UPDATE SET
        settings_json=json_patch(COALESCE(user_preferences.settings_json,'{}'), excluded.settings_json),
        updated_at=excluded.updated_at,
        version=user_preferences.version + 1
      RETURNING settings_json, version
    `).bind(user.id, JSON.stringify(patch), timestamp).first<{ settings_json: string; version: number }>();
    const preferences: Record<string, unknown> = { ...DEFAULT_PREFERENCES, ...(row ? JSON.parse(row.settings_json) : {}) };
    return json({ preferences, version: row?.version ?? 1 });
  }

  if (path === "/api/settings/webhook") {
    if (method !== "GET" && !csrf(request, env)) return error("Cross-site request rejected", 403, "CSRF");
    const user = await requireAuth(request, env);
    if (method === "GET") return json({ configured: await webhookConfigured(env.DB, user.id) });
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM incoming_call_webhooks WHERE user_id=?1").bind(user.id).run();
      return json({ configured: false });
    }
    if (method === "PUT") {
      if (!env.SPARKCALL_WEBHOOK_ENCRYPTION_KEY) return error("Webhook is not configured", 503, "WEBHOOK_UNAVAILABLE");
      const input = await body(request);
      const url = validateWebhookUrl(input.url);
      await validateResolvedHost(url);
      await saveWebhook(env, user.id, url);
      return json({ configured: true });
    }
    return error("Method not allowed", 405, "METHOD_NOT_ALLOWED");
  }

  if (path === "/api/contacts") {
    const user = await requireAuth(request, env);
    if (method === "GET") {
      const query = (url.searchParams.get("q") || "").slice(0, 80);
      const result = await env.DB.prepare(`
        SELECT c.id,c.number,c.name,c.notes,c.favorite,c.created_at,c.updated_at,u.display_name
        FROM contacts c LEFT JOIN users u ON u.id=c.contact_user_id
        WHERE c.user_id=?1 AND (c.number LIKE ?2 OR c.name LIKE ?2)
        ORDER BY c.favorite DESC,c.name COLLATE NOCASE LIMIT 500
      `).bind(user.id, `%${query}%`).all();
      return json({ contacts: result.results });
    }
    if (method === "POST") {
      const input = await body(request);
      const number = text(input.number, 32)?.trim();
      const name = text(input.name, 80)?.trim();
      if (!number || !validDialNumber(number) || !name) return error("A valid SparkCall number and contact name are required");
      const target = await findByNumber(env.DB, number);
      if (target?.id === user.id) return error("You cannot add yourself", 400, "SELF_CONTACT");
      try {
        await env.DB.prepare(`
          INSERT INTO contacts(id,user_id,contact_user_id,number,name,notes,favorite,created_at,updated_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)
        `).bind(id(), user.id, target?.id ?? null, number, name, text(input.notes, 1000) || "", input.favorite === true ? 1 : 0, now()).run();
      } catch (cause) {
        if (cause instanceof Error && /unique|constraint/i.test(cause.message)) return error("Contact already exists", 409, "DUPLICATE");
        throw cause;
      }
      return json({ ok: true }, 201);
    }
    if (method === "DELETE") {
      const contactId = url.searchParams.get("id");
      if (!contactId) return error("Contact id is required");
      await env.DB.prepare("DELETE FROM contacts WHERE id=?1 AND user_id=?2").bind(contactId, user.id).run();
      return json({ ok: true });
    }
  }
  const contactMatch = path.match(/^\/api\/contacts\/([^/]+)$/);
  if (contactMatch && method === "GET") {
    const user = await requireAuth(request, env);
    const contact = await env.DB.prepare("SELECT id,number,name,notes,favorite,created_at,updated_at FROM contacts WHERE id=?1 AND user_id=?2")
      .bind(decodeURIComponent(contactMatch[1]!), user.id).first();
    return contact ? json({ contact }) : error("Contact not found", 404, "NOT_FOUND");
  }
  if (contactMatch && method === "PATCH") {
    const user = await requireAuth(request, env);
    const input = await body(request);
    const columns: string[] = [];
    const values: unknown[] = [];
    if (typeof input.name === "string" && input.name.trim().length > 0 && input.name.length <= 80) { columns.push("name=?"); values.push(input.name.trim()); }
    if (typeof input.notes === "string" && input.notes.length <= 1000) { columns.push("notes=?"); values.push(input.notes); }
    if (typeof input.favorite === "boolean") { columns.push("favorite=?"); values.push(input.favorite ? 1 : 0); }
    if (!columns.length) return error("No valid contact changes were provided");
    values.push(decodeURIComponent(contactMatch[1]!), user.id);
    await env.DB.prepare(`UPDATE contacts SET ${columns.join(",")},updated_at=datetime('now') WHERE id=? AND user_id=?`).bind(...values).run();
    return json({ ok: true });
  }

  if (path === "/api/blocked") {
    const user = await requireAuth(request, env);
    if (method === "GET") {
      const result = await env.DB.prepare(`
        SELECT b.blocked_user_id AS id,u.number,u.display_name,b.created_at
        FROM blocked_users b JOIN users u ON u.id=b.blocked_user_id WHERE b.user_id=?1 ORDER BY b.created_at DESC
      `).bind(user.id).all();
      return json({ blocked: result.results });
    }
    const input = await body(request);
    const number = String(input.number ?? "");
    const target = await findByNumber(env.DB, number);
    if (!target || target.id === user.id) return error("SparkCall user not found", 404, "NOT_FOUND");
    if (method === "POST") {
      await env.DB.prepare("INSERT OR IGNORE INTO blocked_users(user_id,blocked_user_id,created_at) VALUES(?1,?2,?3)").bind(user.id, target.id, now()).run();
      await env.DB.prepare("DELETE FROM contacts WHERE user_id=?1 AND contact_user_id=?2").bind(user.id, target.id).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM blocked_users WHERE user_id=?1 AND blocked_user_id=?2").bind(user.id, target.id).run();
      return json({ ok: true });
    }
  }

  if (path === "/api/history" && method === "GET") {
    const user = await requireAuth(request, env);
    const type = url.searchParams.get("type");
    const search = (url.searchParams.get("q") || "").slice(0, 64);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 200));
    const direction = type === "incoming" ? "recipient_id=?1" : type === "outgoing" ? "caller_id=?1" : "(caller_id=?1 OR recipient_id=?1)";
    const missed = type === "missed" ? " AND status IN ('ringing','timeout') AND recipient_id=?1" : "";
    const result = await env.DB.prepare(`
      SELECT id,caller_id,recipient_id,caller_number,recipient_number,started_at,ended_at,duration_seconds,status
      FROM call_history WHERE ${direction}${missed} AND (caller_number LIKE ?2 OR recipient_number LIKE ?2)
      ORDER BY started_at DESC LIMIT ?3
    `).bind(user.id, `%${search}%`, limit).all();
    const history = result.results.map((row: any) => ({
      id: row.id,
      caller: row.caller_number,
      recipient: row.recipient_number,
      direction: row.caller_id === user.id ? "outgoing" : "incoming",
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      status: row.status,
    }));
    return json({ history });
  }
  const historyMatch = path.match(/^\/api\/history\/([^/]+)$/);
  if (historyMatch && method === "GET") {
    const user = await requireAuth(request, env);
    const row = await env.DB.prepare(`
      SELECT id,caller_id,recipient_id,caller_number,recipient_number,started_at,ended_at,duration_seconds,status
      FROM call_history WHERE id=?1 AND (caller_id=?2 OR recipient_id=?2)
    `).bind(decodeURIComponent(historyMatch[1]!), user.id).first<any>();
    if (!row) return error("Call not found", 404, "NOT_FOUND");
    return json({ call: { id: row.id, caller: row.caller_number, recipient: row.recipient_number, direction: row.caller_id === user.id ? "outgoing" : "incoming", startedAt: row.started_at, endedAt: row.ended_at, durationSeconds: row.duration_seconds, status: row.status } });
  }

  if (path === "/api/records" && method === "GET") {
    const user = await requireAuth(request, env);
    const result = await env.DB.prepare("SELECT * FROM records WHERE owner_id=?1 ORDER BY updated_at DESC LIMIT 200").bind(user.id).all<any>();
    return json({ records: result.results.map((row) => recordObject(row, true)) });
  }
  if (path === "/api/records" && method === "POST") {
    const user = await requireAuth(request, env);
    const input = await body(request);
    const slug = text(input.slug, 96)?.trim();
    const title = text(input.title, 160)?.trim();
    const expiration = expiredAt(input.expiresAt);
    if (!slug || !validSlug(slug) || isReserved(slug) || !title || expiration === undefined) return error("A valid title, unique slug, and future expiration are required");
    let callId: string | null = null;
    let callSnapshot: { started_at: string; ended_at: string | null; duration_seconds: number | null } | null = null;
    if (typeof input.callId === "string" && input.callId) {
      const call = await env.DB.prepare("SELECT id,started_at,ended_at,duration_seconds FROM call_history WHERE id=?1 AND (caller_id=?2 OR recipient_id=?2)")
        .bind(input.callId, user.id).first<{ id: string; started_at: string; ended_at: string | null; duration_seconds: number | null }>();
      if (!call) return error("Call not found", 404, "NOT_FOUND");
      callId = call.id;
      callSnapshot = call;
    }
    const tags = parseArray(input.tags, 30, 64);
    const participants = cleanParticipants(input.participants);
    const metadata = cleanMetadata(input.metadata);
    const recordId = id();
    const manageToken = user.is_temporary ? newToken() : null;
    try {
      await env.DB.prepare(`
        INSERT INTO records(id,owner_id,call_id,slug,title,description,notes,tags_json,metadata_json,is_public,expires_at,created_at,updated_at,owner_capability_hash,participants_json,record_started_at,record_ended_at,record_duration_seconds)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?11,?12,?13,?14,?15,?16)
      `).bind(recordId, user.id, callId, slug, title, text(input.description, 5000) || "", text(input.notes, 5000) || "", JSON.stringify(tags), JSON.stringify(metadata), expiration, now(), manageToken ? await hashToken(manageToken) : null, JSON.stringify(participants), callSnapshot?.started_at ?? null, callSnapshot?.ended_at ?? null, callSnapshot?.duration_seconds ?? null).run();
    } catch (cause) {
      if (cause instanceof Error && /unique|constraint/i.test(cause.message)) return error("Record slug is already in use", 409, "SLUG_TAKEN");
      throw cause;
    }
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    const capabilityCookie = manageToken
      ? `sparkcall_record_${recordId}=${manageToken}; Max-Age=31536000; Path=/api/records; HttpOnly; SameSite=Strict${secure}`
      : undefined;
    return json({ ok: true, id: recordId, slug, recoveryCapability: !!manageToken }, 201, capabilityCookie ? { "set-cookie": capabilityCookie } : {});
  }
  const recordMatch = path.match(/^\/api\/records\/([^/]+)$/);
  if (recordMatch && method === "GET") {
    const key = decodeURIComponent(recordMatch[1]!);
    const publicRow = await env.DB.prepare(`
      SELECT r.*,COALESCE(c.started_at,r.record_started_at) AS call_started_at,
        COALESCE(c.ended_at,r.record_ended_at) AS call_ended_at,
        COALESCE(c.duration_seconds,r.record_duration_seconds) AS call_duration_seconds
      FROM records r LEFT JOIN call_history c ON c.id=r.call_id
      WHERE r.slug=?1 COLLATE NOCASE AND r.is_public=1 AND (r.expires_at IS NULL OR julianday(r.expires_at)>julianday('now'))
    `).bind(key).first<any>();
    try {
      const { row } = await ownedRecord(request, env, key);
      return json({ record: recordObject(row, true) }, 200, { "x-robots-tag": "noindex, nofollow" });
    } catch (cause) {
      if (!(cause instanceof Response) || cause.status !== 404) throw cause;
    }
    if (publicRow) return json({ record: { publicIdentifier: publicRow.slug, title: publicRow.title, description: publicRow.description, notes: publicRow.notes, tags: JSON.parse(publicRow.tags_json || "[]"), participants: JSON.parse(publicRow.participants_json || "[]"), metadata: cleanMetadata(JSON.parse(publicRow.metadata_json || "{}")), startedAt: publicRow.call_started_at ?? null, endedAt: publicRow.call_ended_at ?? null, durationSeconds: publicRow.call_duration_seconds ?? null } }, 200, { "x-robots-tag": "noindex, nofollow" });
    const { row } = await ownedRecord(request, env, key);
    return json({ record: recordObject(row, true) }, 200, { "x-robots-tag": "noindex, nofollow" });
  }
  if (recordMatch && method === "PATCH") {
    const key = decodeURIComponent(recordMatch[1]!);
    const { row } = await ownedRecord(request, env, key);
    const input = await body(request);
    const columns: string[] = [];
    const values: unknown[] = [];
    for (const [field, column, max] of [["title", "title", 160], ["description", "description", 5000], ["notes", "notes", 5000]] as const) {
      if (typeof input[field] === "string" && input[field].length <= max && (field !== "title" || input[field].trim())) { columns.push(`${column}=?`); values.push(field === "title" ? input[field].trim() : input[field]); }
    }
    if (typeof input.isPublic === "boolean") { columns.push("is_public=?"); values.push(input.isPublic ? 1 : 0); }
    if (typeof input.slug === "string") {
      const slug = input.slug.trim();
      if (!validSlug(slug) || isReserved(slug)) return error("Invalid or reserved record slug");
      columns.push("slug=?"); values.push(slug);
    }
    if (Array.isArray(input.tags)) { columns.push("tags_json=?"); values.push(JSON.stringify(parseArray(input.tags, 30, 64))); }
    if (input.metadata && typeof input.metadata === "object") { columns.push("metadata_json=?"); values.push(JSON.stringify(cleanMetadata(input.metadata))); }
    if (Array.isArray(input.participants)) { columns.push("participants_json=?"); values.push(JSON.stringify(cleanParticipants(input.participants))); }
    if (Object.hasOwn(input, "expiresAt")) {
      const expiration = expiredAt(input.expiresAt);
      if (expiration === undefined) return error("Expiration must be a valid future date or empty");
      columns.push("expires_at=?"); values.push(expiration);
    }
    if (!columns.length) return error("No valid record changes were provided");
    values.push(row.id);
    try {
      await env.DB.prepare(`UPDATE records SET ${columns.join(",")},updated_at=datetime('now') WHERE id=?`).bind(...values).run();
    } catch (cause) {
      if (cause instanceof Error && /unique|constraint/i.test(cause.message)) return error("Record slug is already in use", 409, "SLUG_TAKEN");
      throw cause;
    }
    return json({ ok: true });
  }
  if (recordMatch && method === "DELETE") {
    const key = decodeURIComponent(recordMatch[1]!);
    const { row } = await ownedRecord(request, env, key);
    await env.DB.prepare("DELETE FROM records WHERE id=?").bind(row.id).run();
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return json({ ok: true }, 200, { "set-cookie": `sparkcall_record_${row.id}=; Max-Age=0; Path=/api/records; HttpOnly; SameSite=Strict${secure}` });
  }

  if (path === "/api/blocked" && method === "DELETE") return error("Use the blocked-list endpoint with a number", 400);
  if (path === "/api/usage" && method === "GET") {
    const user = await requireAuth(request, env);
    return json(await getUserTurnUsage(env, user.id));
  }
  if (path === "/api/admin/usage" && method === "GET") {
    const user = await requireAuth(request, env);
    const admins = new Set((env.ADMIN_USER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
    if (!admins.has(user.id)) return error("Not found", 404, "NOT_FOUND");
    return json(await getPlatformTurnUsage(env));
  }
  if (path === "/api/turn/credentials" && method === "GET") {
    const user = await requireAuth(request, env);
    if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return error("TURN is not configured", 503, "TURN_UNAVAILABLE");
    const ttl = Math.max(60, Math.min(86_400, Number(env.TURN_CREDENTIAL_TTL_SECONDS) || 3600));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TURN_PROVIDER_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.TURN_API_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl, customIdentifier: user.id }),
        signal: controller.signal,
      });
    } catch {
      return error("TURN credential service unavailable", 503, "TURN_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return error("TURN credential service unavailable", 503, "TURN_UNAVAILABLE");
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > TURN_PROVIDER_MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      return error("TURN credential response was invalid", 502, "TURN_INVALID_RESPONSE");
    }
    let data: { iceServers?: RTCIceServer[] };
    try {
      const responseBody = await response.text();
      if (new TextEncoder().encode(responseBody).byteLength > TURN_PROVIDER_MAX_RESPONSE_BYTES) return error("TURN credential response was invalid", 502, "TURN_INVALID_RESPONSE");
      data = JSON.parse(responseBody) as { iceServers?: RTCIceServer[] };
    } catch {
      return error("TURN credential response was invalid", 502, "TURN_INVALID_RESPONSE");
    }
    if (!Array.isArray(data.iceServers)) return error("TURN credential response was invalid", 502, "TURN_INVALID_RESPONSE");
    return json({ iceServers: data.iceServers, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() });
  }

  if (path === "/api/numbers/availability" && method === "GET") {
    const number = url.searchParams.get("number") || "";
    if (!validNumber(number) || isReserved(number)) return json({ number, available: false });
    const existing = await env.DB.prepare(`
      SELECT 1 FROM users WHERE number=?1 COLLATE BINARY
      UNION ALL SELECT 1 FROM numbers WHERE number=?1 COLLATE BINARY
      UNION ALL SELECT 1 FROM reserved_numbers WHERE number=?1 COLLATE NOCASE LIMIT 1
    `).bind(number).first();
    return json({ number, available: !existing });
  }
  if (path === "/api/numbers" && method === "POST") {
    const user = await requireAuth(request, env);
    if (user.is_temporary) return error("Temporary users cannot claim custom numbers", 403, "TEMPORARY_ACCOUNT");
    const input = await body(request);
    const number = text(input.number, 32)?.trim();
    if (!number || !validNumber(number) || isReserved(number)) return error("Number is invalid or reserved");
    const reserved = await env.DB.prepare("SELECT 1 FROM reserved_numbers WHERE number=?1 COLLATE NOCASE LIMIT 1").bind(number).first();
    if (reserved) return error("Number is invalid or reserved", 400, "NUMBER_RESERVED");
    if (user.number === number) return json({ number });
    const previousChange = user.number_changed_at ? Date.parse(user.number_changed_at) : 0;
    if (previousChange && Date.now() - previousChange < 30 * 24 * 60 * 60 * 1000) return error("A number can be changed once every 30 days", 429, "NUMBER_CHANGE_COOLDOWN");
    const timestamp = now();
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET number=?1,number_changed_at=?2,updated_at=?2 WHERE id=?3 AND is_temporary=0").bind(number, timestamp, user.id),
        env.DB.prepare(`INSERT INTO numbers(number,user_id,created_at) VALUES(?1,?2,?3)
          ON CONFLICT(user_id) DO UPDATE SET number=excluded.number,created_at=excluded.created_at`).bind(number, user.id, timestamp),
      ]);
    } catch (cause) {
      if (cause instanceof Error && /unique|constraint/i.test(cause.message)) return error("Number is already in use", 409, "NUMBER_TAKEN");
      throw cause;
    }
    return json({ number });
  }

  return error("Not found", 404, "NOT_FOUND");
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  try {
    return withSecurity(await route(request, env), request, env);
  } catch (cause) {
    if (cause instanceof Response) return withSecurity(cause, request, env);
    console.error("api_error", cause instanceof Error ? cause.message : "unknown");
    return withSecurity(error("Internal server error", 500, "INTERNAL_ERROR"), request, env);
  }
}

export default handleApi;
