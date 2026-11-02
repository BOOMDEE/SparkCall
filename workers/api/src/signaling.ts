import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { json } from "./database";
import { databaseTimeMs, isSessionActive } from "./auth";

type Role = "caller" | "callee";
type CallStatus = "CALLING" | "RINGING" | "CONNECTING" | "CONNECTED" | "ENDED" | "REJECTED" | "BUSY" | "TIMEOUT" | "FAILED" | "CANCELLED";
type SignalType = "offer" | "answer" | "ice-candidate" | "accept" | "reject" | "busy" | "cancel" | "hangup" | "connected" | "ping";
interface SocketAttachment { userId: string; sessionId: string; role: Role; messageWindow: number; messageCount: number; authCheckedAt?: number; sessionExpiresAt?: number; }
interface CallRecord { id: string; callerId: string; calleeId: string; status: CallStatus; createdAt: number; connectedAt?: number; disconnectedAt?: Partial<Record<Role, number>>; }
interface QueuedSignal { target: Role; payload: string; createdAt: number; }
interface Invite { callId: string; callerNumber: string; callerName: string; createdAt: number; expiresAt: number; }
interface SignalingEnv extends Env { SPARKCALL_INTERNAL_TOKEN?: string; }
interface SessionRow { user_id: string; session_expires_at: string | null; user_expires_at: string | null; revoked_at: string | null; }

const TERMINAL = new Set<CallStatus>(["ENDED", "REJECTED", "BUSY", "TIMEOUT", "FAILED", "CANCELLED"]);
const allowedSignals = new Set<SignalType>(["offer", "answer", "ice-candidate", "accept", "reject", "busy", "cancel", "hangup", "connected", "ping"]);
const SESSION_CACHE_MS = 5_000;
const INVALID_SESSION_CODE = 1008;

function sessionExpiry(row: { session_expires_at?: unknown; user_expires_at?: unknown }) {
  const values = [databaseTimeMs(row.session_expires_at), databaseTimeMs(row.user_expires_at)].filter((value): value is number => value !== null);
  return values.length ? Math.min(...values) : undefined;
}

function sessionInvalidReason(row: SessionRow | null, atMs: number) {
  if (!row) return "SESSION_REVOKED" as const;
  const expiry = sessionExpiry(row);
  return expiry !== undefined && expiry <= atMs ? "SESSION_EXPIRED" as const : "SESSION_REVOKED" as const;
}

function upgraded(request: Request) { return request.headers.get("Upgrade")?.toLowerCase() === "websocket"; }
function internal(request: Request, env: SignalingEnv) {
  return !!env.SPARKCALL_INTERNAL_TOKEN && request.headers.get("X-SparkCall-Internal-Token") === env.SPARKCALL_INTERNAL_TOKEN;
}
function attachment(socket: WebSocket): SocketAttachment | null {
  try { return socket.deserializeAttachment() as SocketAttachment; } catch { return null; }
}
function reply(socket: WebSocket, value: unknown) {
  try { socket.send(JSON.stringify(value)); } catch { /* closed socket */ }
}
function parseMessage(message: string | ArrayBuffer): { type: SignalType; payload?: unknown } | null {
  if (typeof message !== "string" || new TextEncoder().encode(message).byteLength > 64_000) return null;
  try {
    const value = JSON.parse(message) as { type?: unknown; payload?: unknown };
    if (typeof value.type !== "string" || !allowedSignals.has(value.type as SignalType)) return null;
    return value as { type: SignalType; payload?: unknown };
  } catch { return null; }
}

export class SparkCallDurableObject extends DurableObject<SignalingEnv> {
  async fetch(request: Request): Promise<Response> {
    if (!internal(request, this.env)) return json({ error: "Unauthorized" }, 401);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/session-revoked") && request.method === "POST") {
      const sessionId = request.headers.get("X-SparkCall-Session-ID") || "";
      if (!sessionId) return json({ error: "Session identity required" }, 400);
      this.closeSession(sessionId, "SESSION_REVOKED");
      return json({ ok: true });
    }
    if (url.pathname.endsWith("/cancel") && request.method === "POST") {
      const callId = request.headers.get("X-SparkCall-Call-ID") || "";
      const callerId = request.headers.get("X-SparkCall-Caller-ID") || "";
      const record = await this.ctx.storage.get<CallRecord>("call");
      if (!record) return json({ ok: true });
      if (record.id !== callId || record.callerId !== callerId) return json({ error: "Call identity mismatch" }, 403);
      if (record.status === "CONNECTED") return json({ error: "Call already connected" }, 409);
      if (!TERMINAL.has(record.status)) await this.finish(record, "CANCELLED");
      return json({ ok: true });
    }
    if (!upgraded(request)) return json({ error: "WebSocket upgrade required" }, 426);
    const callId = request.headers.get("X-SparkCall-Call-ID") || "";
    const userId = request.headers.get("X-SparkCall-User-ID") || "";
    const sessionId = request.headers.get("X-SparkCall-Session-ID") || "";
    const callerId = request.headers.get("X-SparkCall-Caller-ID") || "";
    const calleeId = request.headers.get("X-SparkCall-Callee-ID") || "";
    const role = request.headers.get("X-SparkCall-Role") as Role | null;
    if (!callId || !userId || !sessionId || !callerId || !calleeId || (role !== "caller" && role !== "callee") || (role === "caller" ? callerId !== userId : calleeId !== userId)) {
      return json({ error: "Invalid signaling identity" }, 400);
    }
    const auth = await this.readSession(userId, sessionId);
    if (!auth || !isSessionActive(auth)) return json({ error: "Session invalid" }, 401);
    const row = await this.env.DB.prepare("SELECT status FROM call_history WHERE id=?1 AND caller_id=?2 AND recipient_id=?3")
      .bind(callId, callerId, calleeId).first<{ status: string }>();
    if (!row) return json({ error: "Call not found" }, 404);
    const current = await this.ctx.storage.get<CallRecord>("call");
    if (current && (current.id !== callId || current.callerId !== callerId || current.calleeId !== calleeId)) return json({ error: "Call identity mismatch" }, 409);
    const status = current?.status ?? row.status.toUpperCase() as CallStatus;
    if (TERMINAL.has(status)) return json({ error: "Call has ended" }, 410);
    const record: CallRecord = current ?? { id: callId, callerId, calleeId, status, createdAt: Date.now() };
    const wasDisconnected = !!record.disconnectedAt?.[role];
    if (record.disconnectedAt?.[role]) delete record.disconnectedAt[role];
    if (role === "callee" && record.status === "CALLING") record.status = "RINGING";
    await this.ctx.storage.put("call", record);
    await this.persistStatus(record);

    // Register before accepting the pair, so a failed presence registration cannot leak an accepted socket.
    if (!(await this.registerCall(userId, sessionId, callId))) return json({ error: "Session unavailable" }, 503);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const checkedAt = Date.now();
    server.serializeAttachment({ userId, sessionId, role, messageWindow: checkedAt, messageCount: 0, authCheckedAt: checkedAt, sessionExpiresAt: sessionExpiry(auth) } satisfies SocketAttachment);
    reply(server, { type: "call-state", status: record.status, callId });
    if (wasDisconnected) await this.broadcast({ type: "peer-reconnected", role, callId });
    await this.deliverQueued(role);
    await this.scheduleAlarm(record);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const peer = attachment(socket);
    if (!peer) { socket.close(INVALID_SESSION_CODE, "Missing attachment"); return; }
    if (!(await this.authorizeSocket(socket, peer))) return;
    const parsed = parseMessage(message);
    if (!parsed) { socket.close(1008, "Invalid signaling message"); return; }
    const nowMs = Date.now();
    if (nowMs - peer.messageWindow >= 10_000) { peer.messageWindow = nowMs; peer.messageCount = 0; }
    if (++peer.messageCount > 80) { socket.close(1008, "Rate limit"); return; }
    socket.serializeAttachment(peer);
    const record = await this.ctx.storage.get<CallRecord>("call");
    if (!record || TERMINAL.has(record.status)) return;
    if (parsed.type === "ping") { reply(socket, { type: "pong", at: nowMs }); return; }
    const target: Role = peer.role === "caller" ? "callee" : "caller";

    if (parsed.type === "accept") {
      if (peer.role !== "callee" || record.status !== "RINGING") return;
      record.status = "CONNECTING";
      await this.saveState(record, { type: "call-state", status: record.status, callId: record.id });
      return;
    }
    if (parsed.type === "reject") {
      if (peer.role !== "callee") return;
      await this.finish(record, "REJECTED");
      return;
    }
    if (parsed.type === "busy") {
      if (peer.role !== "callee") return;
      await this.finish(record, "BUSY");
      return;
    }
    if (parsed.type === "cancel") {
      if (peer.role !== "caller") return;
      await this.finish(record, "CANCELLED");
      return;
    }
    if (parsed.type === "hangup") {
      await this.finish(record, "ENDED");
      return;
    }
    if (parsed.type === "connected") {
      if (record.status === "CONNECTING") {
        record.status = "CONNECTED";
        record.connectedAt = record.connectedAt ?? nowMs;
        record.disconnectedAt = {};
        await this.saveState(record, { type: "call-state", status: "CONNECTED", callId: record.id });
      }
      return;
    }
    if (parsed.type === "offer" && peer.role !== "caller") return;
    if (parsed.type === "answer" && peer.role !== "callee") return;
    if (parsed.payload === undefined) return;
    const envelope = JSON.stringify({ type: parsed.type, payload: parsed.payload, from: peer.role });
    const targets = await this.authorizedSockets(target);
    if (targets.length) {
      for (const candidate of targets) reply(candidate, JSON.parse(envelope));
    } else {
      const key = `queue:${target}`;
      const queue = await this.ctx.storage.get<QueuedSignal[]>(key) ?? [];
      const next = [...queue.filter((item) => nowMs - item.createdAt < 45_000), { target, payload: envelope, createdAt: nowMs }].slice(-100);
      await this.ctx.storage.put(key, next);
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean) {
    const peer = attachment(socket);
    try { socket.close(code, reason); } catch { /* already closed */ }
    if (!peer) return;
    const remainingSessionSockets = this.ctx.getWebSockets().some((candidate) => candidate !== socket && attachment(candidate)?.sessionId === peer.sessionId);
    if (!remainingSessionSockets) await this.unregisterCall(peer.userId, peer.sessionId);
    const record = await this.ctx.storage.get<CallRecord>("call");
    if (!record || TERMINAL.has(record.status)) return;
    const remaining = this.ctx.getWebSockets().filter((candidate) => attachment(candidate)?.role === peer.role);
    if (remaining.length) return;
    record.disconnectedAt ??= {};
    record.disconnectedAt[peer.role] = Date.now();
    await this.ctx.storage.put("call", record);
    await this.broadcast({ type: "peer-disconnected", role: peer.role, callId: record.id, reconnecting: true });
    await this.scheduleAlarm(record);
    void code; void reason; void wasClean;
  }

  async webSocketError(socket: WebSocket) {
    try { socket.close(1011, "WebSocket error"); } catch { /* already closed */ }
  }

  async alarm() {
    for (const socket of this.ctx.getWebSockets()) {
      const peer = attachment(socket);
      if (peer) await this.authorizeSocket(socket, peer);
    }
    const record = await this.ctx.storage.get<CallRecord>("call");
    if (!record || TERMINAL.has(record.status)) return;
    const nowMs = Date.now();
    if (!record.connectedAt && nowMs - record.createdAt >= 45_000) {
      await this.finish(record, "TIMEOUT");
      return;
    }
    const expiredRole = (Object.entries(record.disconnectedAt ?? {}) as Array<[Role, number]>).find(([, value]) => nowMs - value >= 20_000)?.[0];
    if (expiredRole && !this.ctx.getWebSockets().some((socket) => attachment(socket)?.role === expiredRole)) {
      await this.finish(record, "FAILED");
      return;
    }
    await this.scheduleAlarm(record);
  }

  private async deliverQueued(role: Role) {
    const key = `queue:${role}`;
    const queue = (await this.ctx.storage.get<QueuedSignal[]>(key) ?? []).filter((item) => Date.now() - item.createdAt < 45_000);
    const sockets = await this.authorizedSockets(role);
    if (!queue.length || !sockets.length) return;
    for (const item of queue) {
      const message = JSON.parse(item.payload);
      for (const socket of sockets) reply(socket, message);
    }
    await this.ctx.storage.delete(key);
  }

  private async authorizedSockets(role?: Role) {
    const sockets: WebSocket[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      const peer = attachment(socket);
      if (peer && (role === undefined || peer.role === role) && await this.authorizeSocket(socket, peer)) sockets.push(socket);
    }
    return sockets;
  }

  private async broadcast(message: unknown) {
    for (const socket of await this.authorizedSockets()) reply(socket, message);
  }

  private async readSession(userId: string, sessionId: string): Promise<SessionRow | null> {
    try {
      return await this.env.DB.prepare("SELECT s.user_id, s.expires_at AS session_expires_at, s.revoked_at, u.expires_at AS user_expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?1 AND s.user_id=?2")
        .bind(sessionId, userId).first<SessionRow>();
    } catch { return null; }
  }

  private async authorizeSocket(socket: WebSocket, peer: SocketAttachment): Promise<boolean> {
    const nowMs = Date.now();
    if (peer.authCheckedAt && nowMs - peer.authCheckedAt < SESSION_CACHE_MS && (!peer.sessionExpiresAt || peer.sessionExpiresAt > nowMs)) return true;
    const row = await this.readSession(peer.userId, peer.sessionId);
    if (!row || !isSessionActive(row, nowMs)) {
      try { reply(socket, { type: "session-invalid", reason: sessionInvalidReason(row, nowMs) }); socket.close(INVALID_SESSION_CODE, "Session invalid"); } catch { /* closed */ }
      return false;
    }
    peer.authCheckedAt = nowMs;
    peer.sessionExpiresAt = sessionExpiry(row);
    socket.serializeAttachment(peer);
    return true;
  }

  private closeSession(sessionId: string, reason: "SESSION_REVOKED" | "SESSION_EXPIRED") {
    for (const socket of this.ctx.getWebSockets()) {
      if (attachment(socket)?.sessionId !== sessionId) continue;
      reply(socket, { type: "session-invalid", reason });
      try { socket.close(INVALID_SESSION_CODE, reason); } catch { /* closed */ }
    }
  }

  private async registerCall(userId: string, sessionId: string, callId: string) {
    try {
      const stub = this.env.PRESENCE.get(this.env.PRESENCE.idFromName(userId));
      const response = await stub.fetch("https://presence/register-call", { method: "POST", headers: { "X-SparkCall-Internal-Token": this.env.SPARKCALL_INTERNAL_TOKEN || "", "X-SparkCall-User-ID": userId, "X-SparkCall-Session-ID": sessionId, "X-SparkCall-Call-ID": callId } });
      return response.ok;
    } catch { return false; }
  }

  private async unregisterCall(userId: string, sessionId: string, callId?: string) {
    try {
      const resolvedCallId = callId ?? (await this.ctx.storage.get<CallRecord>("call"))?.id ?? "";
      const stub = this.env.PRESENCE.get(this.env.PRESENCE.idFromName(userId));
      await stub.fetch("https://presence/unregister-call", { method: "POST", headers: { "X-SparkCall-Internal-Token": this.env.SPARKCALL_INTERNAL_TOKEN || "", "X-SparkCall-User-ID": userId, "X-SparkCall-Session-ID": sessionId, "X-SparkCall-Call-ID": resolvedCallId } });
    } catch { /* cleanup is best effort */ }
  }

  private async persistStatus(record: CallRecord) {
    const status = record.status.toLowerCase();
    await this.env.DB.prepare(`
      UPDATE call_history SET status=?1,
        ended_at=CASE WHEN ?1 IN ('ended','rejected','busy','timeout','failed','cancelled') THEN datetime('now') ELSE ended_at END,
        duration_seconds=CASE WHEN ?1 IN ('ended','rejected','busy','timeout','failed','cancelled')
          THEN CASE WHEN status='connected' THEN max(0,CAST((julianday('now')-julianday(started_at))*86400 AS INTEGER)) ELSE 0 END
          ELSE duration_seconds END
      WHERE id=?2
    `).bind(status, record.id).run();
  }

  private async saveState(record: CallRecord, event: unknown) {
    await this.ctx.storage.put("call", record);
    await this.persistStatus(record);
    await this.broadcast(event);
    await this.scheduleAlarm(record);
  }

  private async finish(record: CallRecord, status: CallStatus) {
    const sockets = this.ctx.getWebSockets();
    const sessions = new Map<string, { userId: string; sessionId: string }>();
    for (const socket of sockets) {
      const peer = attachment(socket);
      if (peer) sessions.set(peer.sessionId, { userId: peer.userId, sessionId: peer.sessionId });
    }
    record.status = status;
    await this.ctx.storage.put("call", record);
    await this.persistStatus(record);
    await this.ctx.storage.deleteAlarm();
    await this.broadcast({ type: "call-state", status, callId: record.id });
    for (const peer of sessions.values()) await this.unregisterCall(peer.userId, peer.sessionId, record.id);
    for (const socket of sockets) {
      try { socket.close(1000, status); } catch { /* already closed */ }
    }
    // D1 retains the call history; transient signaling state has no reason to outlive the call.
    await this.ctx.storage.delete(["call", "queue:caller", "queue:callee"]);
  }

  private async scheduleAlarm(record: CallRecord) {
    if (TERMINAL.has(record.status)) { await this.ctx.storage.deleteAlarm(); return; }
    const deadlines: number[] = [];
    if (!record.connectedAt) deadlines.push(record.createdAt + 45_000);
    for (const timestamp of Object.values(record.disconnectedAt ?? {})) deadlines.push(timestamp + 20_000);
    for (const socket of this.ctx.getWebSockets()) {
      const expiresAt = attachment(socket)?.sessionExpiresAt;
      if (expiresAt) deadlines.push(expiresAt);
    }
    // If notification delivery failed, revalidate active sockets within 30s; never wake an idle object.
    if (this.ctx.getWebSockets().length) deadlines.push(Date.now() + 30_000);
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }
}

export class SparkCallPresenceObject extends DurableObject<SignalingEnv> {
  async fetch(request: Request): Promise<Response> {
    if (!internal(request, this.env)) return json({ error: "Unauthorized" }, 401);
    const userId = request.headers.get("X-SparkCall-User-ID") || "";
    if (!userId) return json({ error: "User identity required" }, 400);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/session-revoked") && request.method === "POST") {
      const sessionId = request.headers.get("X-SparkCall-Session-ID") || "";
      if (!sessionId) return json({ error: "Session identity required" }, 400);
      await this.revokeSession(sessionId);
      return json({ ok: true });
    }
    if (url.pathname.endsWith("/register-call") && request.method === "POST") return this.registerCall(request, userId);
    if (url.pathname.endsWith("/unregister-call") && request.method === "POST") return this.unregisterCall(request, userId);
    if (url.pathname.endsWith("/invite") && request.method === "POST") return this.invite(request, userId);
    if (url.pathname.endsWith("/invite-ended") && request.method === "POST") return this.endInvite(request);
    if (url.pathname.endsWith("/presence") && request.method === "GET") return this.openPresence(request, userId);
    return json({ error: "Not found" }, 404);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const peer = attachment(socket);
    if (!peer || !(await this.authorizeSocket(socket, peer))) return;
    if (typeof message !== "string") return;
    try {
      const value = JSON.parse(message) as { type?: string };
      if (value.type === "ping") reply(socket, { type: "pong", at: Date.now() });
    } catch { /* ignore malformed presence heartbeat */ }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean) {
    try { socket.close(code, reason); } catch { /* already closed */ }
    void wasClean;
  }

  async webSocketError(socket: WebSocket) {
    try { socket.close(1011, "WebSocket error"); } catch { /* already closed */ }
  }

  async alarm() {
    for (const socket of this.ctx.getWebSockets()) {
      const peer = attachment(socket);
      if (peer) await this.authorizeSocket(socket, peer);
    }
    const nowMs = Date.now();
    const invites = await this.ctx.storage.list<Invite>({ prefix: "invite:" });
    let nextExpiry = Number.MAX_SAFE_INTEGER;
    for (const socket of this.ctx.getWebSockets()) {
      const expiresAt = attachment(socket)?.sessionExpiresAt;
      if (expiresAt && expiresAt > nowMs) nextExpiry = Math.min(nextExpiry, expiresAt);
    }
    for (const [key, invite] of invites) {
      if (invite.expiresAt <= nowMs) await this.ctx.storage.delete(key);
      else nextExpiry = Math.min(nextExpiry, invite.expiresAt);
    }
    if (nextExpiry !== Number.MAX_SAFE_INTEGER) {
      const backstop = this.ctx.getWebSockets().length ? Date.now() + 30_000 : nextExpiry;
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, Math.min(nextExpiry, backstop)));
    }
  }

  private async readSession(userId: string, sessionId: string): Promise<SessionRow | null> {
    try { return await this.env.DB.prepare("SELECT s.user_id, s.expires_at AS session_expires_at, s.revoked_at, u.expires_at AS user_expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?1 AND s.user_id=?2").bind(sessionId, userId).first<SessionRow>(); }
    catch { return null; }
  }

  private async authorizedSockets() {
    const sockets: WebSocket[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      const peer = attachment(socket);
      if (peer && await this.authorizeSocket(socket, peer)) sockets.push(socket);
    }
    return sockets;
  }

  private async authorizeSocket(socket: WebSocket, peer: SocketAttachment): Promise<boolean> {
    const nowMs = Date.now();
    if (peer.authCheckedAt && nowMs - peer.authCheckedAt < SESSION_CACHE_MS && (!peer.sessionExpiresAt || peer.sessionExpiresAt > nowMs)) return true;
    const row = await this.readSession(peer.userId, peer.sessionId);
    if (!row || !isSessionActive(row, nowMs)) { try { reply(socket, { type: "session-invalid", reason: sessionInvalidReason(row, nowMs) }); socket.close(INVALID_SESSION_CODE, "Session invalid"); } catch { /* closed */ } return false; }
    peer.authCheckedAt = nowMs; peer.sessionExpiresAt = sessionExpiry(row); socket.serializeAttachment(peer); return true;
  }

  private async registerCall(request: Request, userId: string) {
    const sessionId = request.headers.get("X-SparkCall-Session-ID") || ""; const callId = request.headers.get("X-SparkCall-Call-ID") || "";
    if (!sessionId || !callId) return json({ error: "Session invalid" }, 401);
    const auth = await this.readSession(userId, sessionId);
    if (!auth || !isSessionActive(auth)) return json({ error: "Session invalid" }, 401);
    await this.ctx.storage.put(`call:${callId}:${sessionId}`, { callId, sessionId }); return json({ ok: true });
  }

  private async unregisterCall(request: Request, userId: string) {
    const sessionId = request.headers.get("X-SparkCall-Session-ID") || ""; const callId = request.headers.get("X-SparkCall-Call-ID") || "";
    if (sessionId && callId) await this.ctx.storage.delete(`call:${callId}:${sessionId}`); void userId; return json({ ok: true });
  }

  private async revokeSession(sessionId: string) {
    const entries = await this.ctx.storage.list<{ callId: string; sessionId: string }>({ prefix: "call:" });
    for (const [key, item] of entries) if (item.sessionId === sessionId) {
      const stub = this.env.SIGNALING.get(this.env.SIGNALING.idFromName(item.callId));
      try { await stub.fetch("https://signaling/session-revoked", { method: "POST", headers: { "X-SparkCall-Internal-Token": this.env.SPARKCALL_INTERNAL_TOKEN || "", "X-SparkCall-Session-ID": sessionId } }); } catch { /* signaling will fail closed on next alarm/message */ }
      await this.ctx.storage.delete(key);
    }
    for (const socket of this.ctx.getWebSockets()) if (attachment(socket)?.sessionId === sessionId) { reply(socket, { type: "session-invalid", reason: "SESSION_REVOKED" }); try { socket.close(INVALID_SESSION_CODE, "SESSION_REVOKED"); } catch { /* closed */ } }
  }

  private async invite(request: Request, userId: string) {
    let invite: Invite;
    try {
      const value = await request.json() as Partial<Invite>;
      if (!value.callId || !value.callerNumber || !value.callerName || !value.expiresAt) return json({ error: "Invalid invite" }, 400);
      invite = { callId: value.callId, callerNumber: value.callerNumber, callerName: value.callerName, createdAt: value.createdAt || Date.now(), expiresAt: value.expiresAt };
    } catch { return json({ error: "Invalid invite" }, 400); }
    if (invite.expiresAt <= Date.now() || invite.expiresAt > Date.now() + 60_000) return json({ error: "Invite expired" }, 400);
    const pending = await this.ctx.storage.list<Invite>({ prefix: "invite:" });
    for (const [key, item] of pending) if (item.expiresAt <= Date.now()) await this.ctx.storage.delete(key);
    await this.ctx.storage.put(`invite:${invite.callId}`, invite);
    for (const socket of this.ctx.getWebSockets()) { const peer = attachment(socket); if (peer && await this.authorizeSocket(socket, peer)) reply(socket, { type: "incoming-call", ...invite, calleeId: userId }); }
    await this.ctx.storage.setAlarm(invite.expiresAt);
    return json({ ok: true });
  }

  private async endInvite(request: Request) {
    let callId: string;
    try {
      const value = await request.json() as { callId?: unknown };
      if (typeof value.callId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(value.callId)) return json({ error: "Invalid call ID" }, 400);
      callId = value.callId;
    } catch { return json({ error: "Invalid request body" }, 400); }
    const key = `invite:${callId}`;
    if (await this.ctx.storage.get<Invite>(key)) {
      await this.ctx.storage.delete(key);
      for (const socket of await this.authorizedSockets()) reply(socket, { type: "incoming-call-ended", callId });
    }
    return json({ ok: true });
  }

  private async openPresence(request: Request, userId: string) {
    if (!upgraded(request)) return json({ error: "WebSocket upgrade required" }, 426);
    const sessionId = request.headers.get("X-SparkCall-Session-ID") || "";
    const auth = await this.readSession(userId, sessionId);
    if (!auth || !isSessionActive(auth)) return json({ error: "Session invalid" }, 401);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const checkedAt = Date.now();
    server.serializeAttachment({ userId, sessionId, role: "callee", messageWindow: checkedAt, messageCount: 0, authCheckedAt: checkedAt, sessionExpiresAt: sessionExpiry(auth) } satisfies SocketAttachment);
    if (sessionExpiry(auth)) await this.ctx.storage.setAlarm(sessionExpiry(auth)!);
    const pending = await this.ctx.storage.list<Invite>({ prefix: "invite:" });
    for (const [key, invite] of pending) {
      if (invite.expiresAt <= Date.now()) { await this.ctx.storage.delete(key); continue; }
      reply(server, { type: "incoming-call", ...invite, calleeId: userId });
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}
