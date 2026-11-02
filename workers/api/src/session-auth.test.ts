import { describe, expect, it } from "vitest";
import { databaseTimeMs, isSessionActive } from "./auth";

describe("Durable Object session authorization primitives", () => {
  it("parses ISO and SQLite datetime values consistently", () => {
    expect(databaseTimeMs("2026-11-02T10:00:00.000Z")).toBe(Date.parse("2026-11-02T10:00:00.000Z"));
    expect(databaseTimeMs("2026-11-02 10:00:00")).toBe(Date.parse("2026-11-02T10:00:00.000Z"));
    expect(databaseTimeMs("not-a-date")).toBeNull();
  });

  it("fails closed for missing, revoked, malformed, expired, or user-expired rows", () => {
    const now = Date.parse("2026-11-02T10:00:00.000Z");
    const valid = { user_id: "u1", session_expires_at: "2026-11-02 10:01:00", user_expires_at: null, revoked_at: null };
    expect(isSessionActive(valid, now)).toBe(true);
    expect(isSessionActive({ ...valid, revoked_at: "2026-11-02 09:59:00" }, now)).toBe(false);
    expect(isSessionActive({ ...valid, session_expires_at: "2026-11-02 09:59:00" }, now)).toBe(false);
    expect(isSessionActive({ ...valid, user_expires_at: "bad" }, now)).toBe(false);
    expect(isSessionActive({ ...valid, user_expires_at: "2026-11-02 09:59:00" }, now)).toBe(false);
    expect(isSessionActive({ ...valid, user_expires_at: "2026-11-02 10:01:00" }, now)).toBe(true);
    expect(isSessionActive(null, now)).toBe(false);
  });
});
