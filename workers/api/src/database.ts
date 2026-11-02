import type { D1Database } from "./env";

export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const bytes = (length: number) => {
  const result = new Uint8Array(length);
  crypto.getRandomValues(result);
  return result;
};
export const hex = (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
export const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const validUsername = (value: string) => /^[A-Za-z0-9_][A-Za-z0-9_.-]{2,31}$/.test(value);
export const validNumber = (value: string) => /^[A-Za-z0-9]{1,32}$/.test(value);
export const validDialNumber = (value: string) => validNumber(value) || /^SC-TMP-[A-F0-9]{10}$/.test(value);
export const validSlug = (value: string) => value.length >= 1 && value.length <= 96 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(value);
export const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
export const error = (message: string, status = 400, code = "BAD_REQUEST") => json({ error: { code, message } }, status);

export async function body(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 100_000) throw error("Request body is too large", 413, "BODY_TOO_LARGE");
  try {
    const source = await request.text();
    if (source.length > 100_000) throw error("Request body is too large", 413, "BODY_TOO_LARGE");
    const value: unknown = JSON.parse(source);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    throw error("A valid JSON request body is required", 400, "INVALID_JSON");
  }
}

export const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value : undefined;
export const publicUser = (user: any) => ({
  id: user.id,
  username: user.username ?? null,
  displayName: user.display_name,
  number: user.number ?? null,
  temporary: !!user.is_temporary,
  expiresAt: user.expires_at ?? null,
});

export async function findUser(db: D1Database, userId: string) {
  return db.prepare("SELECT id, username, display_name, number, is_temporary, expires_at, created_at FROM users WHERE id=?1")
    .bind(userId).first<any>();
}

export async function findByNumber(db: D1Database, number: string) {
  return db.prepare("SELECT id, username, display_name, number, is_temporary, expires_at FROM users WHERE number=?1 COLLATE BINARY")
    .bind(number).first<any>();
}

export async function isBlocked(db: D1Database, blockerId: string, blockedId: string) {
  return !!(await db.prepare("SELECT 1 FROM blocked_users WHERE user_id=?1 AND blocked_user_id=?2")
    .bind(blockerId, blockedId).first());
}
