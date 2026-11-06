import type { Env } from "./env";
import { base64url, bytes, error, hex, id, now } from "./database";

/** Cloudflare Workers Web Crypto rejects PBKDF2 counts above 100,000. */
const PBKDF2_ITERATIONS = 100_000;
const SESSION_COOKIE = "sc_session";
const SESSION_MAX = 60 * 60 * 24 * 30;

/** Parse both D1 ISO timestamps and SQLite datetime('now') values. */
export function databaseTimeMs(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const source = typeof value === "number" ? value : value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = typeof source === "number" ? source : Date.parse(source);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface SessionAuthRow {
  user_id?: unknown;
  session_id?: unknown;
  session_expires_at?: unknown;
  user_expires_at?: unknown;
  revoked_at?: unknown;
}

/** Fail-closed, database-format-independent session predicate. */
export function isSessionActive(row: SessionAuthRow | null | undefined, atMs = Date.now()): boolean {
  if (!row || typeof row.user_id !== "string" || !row.user_id || row.revoked_at != null) return false;
  const sessionExpiry = databaseTimeMs(row.session_expires_at);
  if (sessionExpiry == null || sessionExpiry <= atMs) return false;
  if (row.user_expires_at == null) return true;
  const userExpiry = databaseTimeMs(row.user_expires_at);
  return userExpiry != null && userExpiry > atMs;
}

const b64 = (a: Uint8Array) => base64url(a);
const fromB64 = (s: string) => {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), (c) => c.charCodeAt(0));
};
async function digest(input: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}
export async function hashToken(token: string) {
  return hex(await digest(token));
}

/**
 * Versioned Workers-compatible password hash. Cloudflare Workers' Web Crypto
 * currently exposes PBKDF2, not a native Argon2id derivation operation.
 * The version prefix permits an Argon2id migration without plaintext storage.
 */
export async function hashPassword(password: string) {
  const salt = bytes(16);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return `pbkdf2-sha256$v1$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2-sha256" || parts[1] !== "v1") return false;
  const iterations = Number(parts[2]);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > PBKDF2_ITERATIONS) return false;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromB64(parts[3]!), iterations, hash: "SHA-256" }, key, 256));
    const expected = fromB64(parts[4]!);
    if (expected.length !== bits.length) return false;
    let difference = 0;
    for (let i = 0; i < bits.length; i++) difference |= expected[i]! ^ bits[i]!;
    return difference === 0;
  } catch {
    return false;
  }
}

export function getCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie") ?? "";
  const found = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!found) return undefined;
  try { return decodeURIComponent(found.slice(name.length + 1)); } catch { return undefined; }
}

export function sessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
export const newToken = () => b64(bytes(32));

export async function createSession(env: Env, userId: string, temporary: boolean, ttlOverride?: number) {
  const token = newToken();
  const configured = Number(temporary ? env.TEMP_SESSION_TTL_SECONDS : env.SESSION_TTL_SECONDS);
  const ttl = Math.max(300, Math.min(SESSION_MAX, (ttlOverride ?? configured) || (temporary ? 86_400 : SESSION_MAX)));
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?1, ?2, ?3, datetime('now', ?4), ?5)")
    .bind(id(), userId, await hashToken(token), `+${ttl} seconds`, now()).run();
  return { token, ttl };
}

export async function authenticate(request: Request, env: Env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    return await env.DB.prepare(`
      SELECT u.*, s.id AS session_id
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=?1 AND s.revoked_at IS NULL
        AND julianday(s.expires_at) > julianday('now')
        AND (u.expires_at IS NULL OR julianday(u.expires_at) > julianday('now'))
    `).bind(await hashToken(token)).first<any>();
  } catch {
    return null;
  }
}

export async function revokeSession(request: Request, env: Env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return;
  const tokenHash = await hashToken(token);
  // D1 lookup and deletion are authoritative: never report logout success when either fails.
  const session = await env.DB.prepare("SELECT id, user_id FROM sessions WHERE token_hash=?1").bind(tokenHash).first<{ id: string; user_id: string }>();
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?1").bind(tokenHash).run();
  // Presence notification is only an optimization; the signaling path revalidates from D1.
  if (session?.id && session.user_id && env.INTERNAL_SIGNALING_TOKEN !== undefined && env.PRESENCE) {
    try {
      const stub = env.PRESENCE.get(env.PRESENCE.idFromName(session.user_id));
      await stub.fetch("https://presence/session-revoked", {
        method: "POST",
        headers: {
          "X-SparkCall-Internal-Token": env.INTERNAL_SIGNALING_TOKEN,
          "X-SparkCall-User-ID": session.user_id,
          "X-SparkCall-Session-ID": session.id,
        },
      });
    } catch { /* notification is best effort; D1 deletion already succeeded */ }
  }
}

export async function requireAuth(request: Request, env: Env) {
  const user = await authenticate(request, env);
  if (!user) throw error("Authentication required", 401, "UNAUTHENTICATED");
  return user;
}

/** Atomically count login attempts in D1 so absent/lagging KV cannot disable throttling. */
export async function rateLimit(env: Env, key: string, limit = 10, window = 900) {
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(`
      INSERT INTO login_attempts(key, window_started_at, attempts) VALUES(?1, ?2, 1)
      ON CONFLICT(key) DO UPDATE SET
        attempts=CASE WHEN ?2-window_started_at >= ?3 THEN 1 ELSE attempts+1 END,
        window_started_at=CASE WHEN ?2-window_started_at >= ?3 THEN ?2 ELSE window_started_at END
    `).bind(key.slice(0, 240), timestamp, window).run();
    const count = await env.DB.prepare("SELECT attempts FROM login_attempts WHERE key=?1").bind(key.slice(0, 240)).first<{ attempts: number }>();
    if (!count || count.attempts > limit) return false;
    if (env.RATE_LIMIT) {
      try { await env.RATE_LIMIT.put(`rl:v1:${key.slice(0, 180)}`, String(count.attempts), { expirationTtl: window }); } catch { /* D1 is authoritative */ }
    }
    return true;
  } catch {
    return false;
  }
}

export { SESSION_COOKIE };
