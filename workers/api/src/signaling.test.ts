import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));
vi.mock("./auth", () => ({
  databaseTimeMs: vi.fn(() => null),
  isSessionActive: vi.fn(() => true),
}));
vi.mock("./database", () => ({
  json: (value: unknown, status = 200) => new Response(JSON.stringify(value), { status }),
}));

const { SparkCallDurableObject, SparkCallPresenceObject } = await import("./signaling");

describe("Durable Object terminal call cleanup", () => {
  it("closes sockets, unregisters presence and deletes call and queued signaling state", async () => {
    const state = new Map<string, unknown>([
      ["call", { id: "call-123", callerId: "user-a", calleeId: "user-b", status: "CONNECTED", createdAt: 1 }],
      ["queue:caller", [{ target: "caller", payload: "{}", createdAt: 2 }]],
      ["queue:callee", [{ target: "callee", payload: "{}", createdAt: 2 }]],
    ]);
    const storage = {
      get: vi.fn(async (key: string) => state.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { state.set(key, value); }),
      delete: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) state.delete(key);
        return true;
      }),
      deleteAlarm: vi.fn(async () => undefined),
    };
    const peer = { userId: "user-a", sessionId: "session-a", role: "caller", messageWindow: 1, messageCount: 0 };
    const sent: string[] = [];
    const closed: Array<[number, string]> = [];
    const socket = {
      deserializeAttachment: () => peer,
      serializeAttachment: vi.fn(),
      send: (message: string) => sent.push(message),
      close: (code: number, reason: string) => closed.push([code, reason]),
    } as unknown as WebSocket;
    const presenceFetch = vi.fn(async () => new Response("{}"));
    const presence = { idFromName: vi.fn(() => "user-a"), get: vi.fn(() => ({ fetch: presenceFetch })) };
    const run = vi.fn(async () => undefined);
    const db = { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })) };
    const ctx = { storage, getWebSockets: () => [socket] };
    const instance = Object.assign(Object.create(SparkCallDurableObject.prototype), {
      ctx,
      env: { DB: db, PRESENCE: presence, INTERNAL_SIGNALING_TOKEN: "test-internal" },
      authorizeSocket: vi.fn(async () => true),
    }) as unknown as { finish(record: { id: string; callerId: string; calleeId: string; status: string; createdAt: number }, status: "ENDED"): Promise<void> };

    await instance.finish({ id: "call-123", callerId: "user-a", calleeId: "user-b", status: "CONNECTED", createdAt: 1 }, "ENDED");

    expect(sent.some((message) => JSON.parse(message).type === "call-state" && JSON.parse(message).status === "ENDED")).toBe(true);
    expect(closed).toEqual([[1000, "ENDED"]]);
    expect(presenceFetch).toHaveBeenCalledWith("https://presence/unregister-call", expect.objectContaining({
      headers: expect.objectContaining({ "X-SparkCall-Call-ID": "call-123", "X-SparkCall-Session-ID": "session-a" }),
    }));
    expect(storage.delete).toHaveBeenCalledWith(["call", "queue:caller", "queue:callee"]);
    expect(state.size).toBe(0);
  });
});

describe("Presence invite expiration", () => {
  it("records an unanswered call as missed as soon as its invite expires", async () => {
    const invite = { callId: "call-123", calleeId: "user-b", callerNumber: "SC-A", callerName: "Caller", createdAt: 1, expiresAt: Date.now() - 1 };
    const entries = new Map<string, unknown>([[`invite:${invite.callId}`, invite]]);
    const storage = {
      list: vi.fn(async () => new Map(entries)),
      delete: vi.fn(async (key: string) => entries.delete(key)),
      setAlarm: vi.fn(async () => undefined),
    };
    const run = vi.fn(async () => ({ success: true }));
    const bind = vi.fn(() => ({ run }));
    let preparedSql = "";
    const prepare = vi.fn((sql: string) => { preparedSql = sql; return { bind }; });
    const ctx = { storage, getWebSockets: () => [] };
    const instance = Object.assign(Object.create(SparkCallPresenceObject.prototype), {
      ctx,
      env: { DB: { prepare } },
      authorizedSockets: vi.fn(async () => []),
    }) as unknown as { alarm(): Promise<void> };

    await instance.alarm();

    expect(preparedSql).toContain("status='timeout'");
    expect(preparedSql).toContain("recipient_id=?2 AND status='calling'");
    expect(bind).toHaveBeenCalledWith(invite.callId, invite.calleeId);
    expect(run).toHaveBeenCalledOnce();
    expect(entries.has(`invite:${invite.callId}`)).toBe(false);
  });
});
