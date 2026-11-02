import type { D1Database, Env } from "./env";
import { base64url, bytes, error, now } from "./database";

export const WEBHOOK_URL_MAX = 2048;
export const WEBHOOK_INTERVAL_SECONDS = 60;
const WEBHOOK_TIMEOUT_MS = 2500;
const DNS_TIMEOUT_MS = 1500;
const PRIVATE_HOSTS = new Set(["localhost", "localhost.localdomain", "local", "internal", "internal.local", "metadata", "metadata.google.internal"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error("invalid key");
  return Uint8Array.from(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), c => c.charCodeAt(0));
}

function parseIPv4(value: string): number[] | null {
  const octets = value.split(".").map(Number);
  return octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null;
}

function isSpecialIPv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return a! === 0 || a! === 10 || a! === 100 && b! >= 64 && b! <= 127 || a! === 127 ||
    a! === 169 && b! === 254 || a! === 172 && b! >= 16 && b! <= 31 ||
    a! === 192 && (b! === 0 || b! === 2 || b! === 168) || a! === 192 && b! === 31 && c! === 196 ||
    a! === 192 && b! === 52 && c! === 193 || a! === 192 && b! === 88 && c! === 99 ||
    a! === 198 && (b! === 18 || b! === 19 || b! === 51) || a! === 203 && b! === 0 || a! >= 224;
}

function parseIPv6(value: string): number[] | null {
  let normalized = value.toLowerCase();
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    if (separator < 0) return null;
    const mapped = parseIPv4(normalized.slice(separator + 1));
    if (!mapped) return null;
    const [a, b, c, d] = mapped;
    normalized = `${normalized.slice(0, separator)}:${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const pieces = normalized.split("::");
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
  if ([...left, ...right].some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if (pieces.length === 1 && left.length !== 8 || pieces.length === 2 && left.length + right.length >= 8) return null;
  const words = [...left.map(part => Number.parseInt(part, 16)), ...(pieces.length === 2 ? Array(8 - left.length - right.length).fill(0) : []), ...right.map(part => Number.parseInt(part, 16))];
  return words.length === 8 ? words : null;
}

function isIpLiteral(value: string): boolean {
  return Boolean(parseIPv4(value) || parseIPv6(value));
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const raw = env.SPARKCALL_WEBHOOK_ENCRYPTION_KEY;
  if (!raw) throw new Error("webhook encryption unavailable");
  const keyBytes = fromBase64(raw);
  if (keyBytes.length !== 32) throw new Error("webhook encryption unavailable");
  return crypto.subtle.importKey("raw", keyBytes as unknown as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Reject special-purpose destinations. DNS is checked before each send, but Workers cannot pin the resolved IP to the socket: resolution-to-connect is a TOCTOU limitation, and the app must not gain private/VPC egress. */
export function isPrivateIpLiteral(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, "").toLowerCase();
  const ipv4 = parseIPv4(value);
  if (ipv4) return isSpecialIPv4(ipv4);
  const words = parseIPv6(value);
  if (!words) return false;
  const [first, second, third, fourth, fifth] = words;
  const mapped = first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 && words[5] === 0xffff;
  if (mapped) return true;
  return first === 0 ||
    (first! & 0xfe00) === 0xfc00 ||
    (first! & 0xffc0) === 0xfe80 ||
    (first! & 0xff00) === 0xff00 ||
    first === 0x0064 && second === 0xff9b && (third === 0 || third === 1) ||
    first === 0x0100 && second === 0 && third === 0 && fourth === 0 ||
    first === 0x2001 && (second === 0 || second === 0x0db8 || second === 2 && third === 0 || (second! & 0xfff0) === 0x0010 || (second! & 0xfff0) === 0x0020) ||
    first === 0x2002;
}

export function validateWebhookUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > WEBHOOK_URL_MAX) throw error("Invalid webhook URL", 400, "INVALID_WEBHOOK_URL");
  let url: URL;
  try { url = new URL(value); } catch { throw error("Invalid webhook URL", 400, "INVALID_WEBHOOK_URL"); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.hash || !host || PRIVATE_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal") || isPrivateIpLiteral(host)) throw error("Invalid webhook URL", 400, "INVALID_WEBHOOK_URL");
  return url;
}

export async function validateResolvedHost(url: URL, fetcher: typeof fetch = fetch): Promise<void> {
  if (isPrivateIpLiteral(url.hostname)) return;
  const endpoint = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(url.hostname)}&type=A`;
  const v6Endpoint = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(url.hostname)}&type=AAAA`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
  try {
    const responses = await Promise.all([endpoint, v6Endpoint].map(target => fetcher(target, { headers: { accept: "application/dns-json" }, redirect: "error", cache: "no-store", signal: controller.signal })));
    let publicAnswer = false;
    for (const response of responses) {
      if (!response.ok) throw new Error("DNS lookup failed");
      const data = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
      for (const answer of data.Answer ?? []) {
        if (!answer.data || !isIpLiteral(answer.data) || isPrivateIpLiteral(answer.data)) throw new Error("invalid DNS address");
        publicAnswer = true;
      }
    }
    if (!publicAnswer) throw new Error("no public DNS address");
  } catch { throw error("Webhook host could not be verified", 400, "INVALID_WEBHOOK_URL"); }
  finally { clearTimeout(timeout); }
}

export async function encryptWebhookUrl(env: Env, url: URL): Promise<{ ciphertext: string; iv: string }> {
  const iv = bytes(12);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), encoder.encode(url.toString()));
  return { ciphertext: base64url(new Uint8Array(encrypted)), iv: base64url(iv) };
}

export async function decryptWebhookUrl(env: Env, ciphertext: string, ivValue: string): Promise<URL> {
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivValue) as unknown as BufferSource }, await encryptionKey(env), fromBase64(ciphertext) as unknown as BufferSource);
    return validateWebhookUrl(decoder.decode(plaintext));
  } catch { throw new Error("webhook decryption failed"); }
}

export async function saveWebhook(env: Env, userId: string, url: URL): Promise<void> {
  const encrypted = await encryptWebhookUrl(env, url);
  const timestamp = now();
  await env.DB.prepare(`INSERT INTO incoming_call_webhooks(user_id,ciphertext,iv,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)
    ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,updated_at=excluded.updated_at`)
    .bind(userId, encrypted.ciphertext, encrypted.iv, timestamp).run();
}

export async function triggerIncomingCallWebhook(env: Env, userId: string, callId: string, timestamp: string): Promise<void> {
  const row = await env.DB.prepare("SELECT ciphertext,iv FROM incoming_call_webhooks WHERE user_id=?1").bind(userId).first<{ ciphertext: string; iv: string }>();
  if (!row) return;
  const claimed = await env.DB.prepare(`UPDATE incoming_call_webhooks SET last_sent_at=?1,updated_at=?1 WHERE user_id=?2 AND (last_sent_at IS NULL OR julianday(last_sent_at)<=julianday(?1,'-${WEBHOOK_INTERVAL_SECONDS} seconds'))`)
    .bind(timestamp, userId).run();
  if (!claimed.meta?.changes) return;
  let url: URL;
  try { url = await decryptWebhookUrl(env, row.ciphertext, row.iv); } catch { return; }
  try { await validateResolvedHost(url); } catch { return; }
  const target = new URL(url);
  target.searchParams.set("event", "incoming_call");
  target.searchParams.set("call_id", callId);
  target.searchParams.set("timestamp", timestamp);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(target.toString(), { method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal, headers: { accept: "application/json" } });
    if (response.body) await response.body.cancel();
  } catch { /* best effort; never log endpoint or response */ }
  finally { clearTimeout(timeout); }
}

export function webhookConfigured(db: D1Database, userId: string) {
  return db.prepare("SELECT 1 FROM incoming_call_webhooks WHERE user_id=?1 LIMIT 1").bind(userId).first().then(Boolean);
}
