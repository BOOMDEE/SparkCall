// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  browserSettingsKey,
  clearSeenMissedCallIds,
  DEFAULT_BROWSER_SETTINGS,
  readBrowserSettings,
  readSeenMissedCallIds,
  writeBrowserSettings,
  writeSeenMissedCallIds,
} from "./browser-settings";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("browser-only call settings", () => {
  it("defaults safely and isolates settings by user", () => {
    expect(readBrowserSettings("user-a")).toEqual(DEFAULT_BROWSER_SETTINGS);
    writeBrowserSettings("user-a", { doNotDisturb: true, missedCallNotifications: false });
    expect(readBrowserSettings("user-a")).toEqual({ doNotDisturb: true, missedCallNotifications: false });
    expect(readBrowserSettings("user-b")).toEqual(DEFAULT_BROWSER_SETTINGS);
  });

  it("ignores malformed or oversized settings instead of enabling a feature", () => {
    localStorage.setItem(browserSettingsKey("bad-json"), "not-json");
    localStorage.setItem(browserSettingsKey("oversized"), "x".repeat(513));
    expect(readBrowserSettings("bad-json")).toEqual(DEFAULT_BROWSER_SETTINGS);
    expect(readBrowserSettings("oversized")).toEqual(DEFAULT_BROWSER_SETTINGS);
  });

  it("bounds and deduplicates the local missed-call notification ledger", () => {
    expect(readSeenMissedCallIds("user-a")).toBeNull();
    writeSeenMissedCallIds("user-a", ["call-1", "call-1", "call-2"]);
    expect(readSeenMissedCallIds("user-a")).toEqual(["call-1", "call-2"]);
    writeSeenMissedCallIds("user-a", Array.from({ length: 120 }, (_, index) => `call-${index}`));
    expect(readSeenMissedCallIds("user-a")).toHaveLength(100);
    clearSeenMissedCallIds("user-a");
    expect(readSeenMissedCallIds("user-a")).toBeNull();
  });
});
