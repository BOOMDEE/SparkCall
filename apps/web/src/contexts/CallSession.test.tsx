// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPreferences } from "../lib/api";
import { browserSettingsKey } from "../lib/browser-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocked = vi.hoisted(() => {
  const controllers: any[] = [];
  const api = vi.fn();
  class MockController {
    options: Record<string, ((...args: any[]) => void) | undefined>;
    state: any = { id: null, state: "IDLE", role: null, durationMs: 0, muted: false, connectionState: "new" };
    accepted: string[] = [];
    rejected: string[] = [];
    audioOptions: any[] = [];
    constructor(options: Record<string, ((...args: any[]) => void) | undefined> = {}) { this.options = options; controllers.push(this); }
    get snapshot() { return this.state; }
    async connectPresence() { this.options.onPresenceChange?.(true); }
    async updateAudioOptions(options: any) { this.audioOptions.push(options); }
    resumeRemoteAudio = vi.fn(async () => undefined);
    attachRemoteAudio() {}
    destroy() {}
    async acceptIncoming(callId: string) { this.accepted.push(callId); this.state = { ...this.state, id: callId, state: "RINGING", role: "callee" }; this.options.onChange?.(this.state); }
    async rejectIncoming(callId: string) { this.rejected.push(callId); }
    emitIncoming(invite: unknown) { this.options.onIncomingCall?.(invite); }
    setTerminal() { this.state = { ...this.state, id: "old", state: "ENDED", role: "caller" }; }
  }
  return { MockController, controllers, api };
});

vi.mock("../lib/webrtc", () => ({ CallController: mocked.MockController }));
vi.mock("../lib/api", () => ({ api: mocked.api }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => ({
  "incomingDialog.title": "Incoming call",
  "incomingDialog.answer": "Answer",
  "incomingDialog.decline": "Decline",
  "incomingDialog.audioLabel": "Call audio",
  "incomingDialog.preferencesLoading": "Loading preferences",
  "incomingDialog.preferencesFailed": "Preferences failed",
  "incomingDialog.retry": "Retry",
  "audio.playbackBlocked": "Remote audio is blocked",
  "audio.enablePlayback": "Enable audio playback",
}[key] ?? key) }) }));

import { CallSessionProvider, useCallSession } from "./CallSession";

let updatePreferencesForTest: ((patch: Partial<UserPreferences>) => Promise<void>) | null = null;

const preferences = {
  forceTurn: true, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  audioInputDeviceId: "", audioOutputDeviceId: "", bitrateMode: "standard", bitrateKbps: 32,
  allowIncoming: true, showOnlineStatus: true, theme: "system",
};

function Consumer() {
  const session = useCallSession();
  return <div><output data-testid="ready">{String(session.preferencesReady)}</output><output data-testid="peer">{session.peer?.callerName || "none"}</output><output data-testid="incoming">{session.incoming?.callId || "none"}</output><output data-testid="state">{session.snapshot.state}</output></div>;
}

function render() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<CallSessionProvider userId="test-user"><Consumer /></CallSessionProvider>));
  return { host, root };
}

function PreferenceConsumer() {
  const session = useCallSession();
  updatePreferencesForTest = session.updatePreferences;
  return <div><output data-testid="theme">{session.preferences.theme}</output><output data-testid="bitrate">{session.preferences.bitrateKbps}</output></div>;
}

function renderPreferences() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<CallSessionProvider userId="test-user"><PreferenceConsumer /></CallSessionProvider>));
  return { host, root };
}

function invite(callId = "call-1") { return { callId, callerNumber: "SC111", callerName: "Alice", createdAt: Date.now(), expiresAt: Date.now() + 30_000 }; }

beforeEach(() => { localStorage.clear(); mocked.api.mockReset(); mocked.api.mockResolvedValue({ preferences, version: 0 }); updatePreferencesForTest = null; });
afterEach(() => { document.body.innerHTML = ""; localStorage.clear(); mocked.controllers.length = 0; vi.clearAllMocks(); });

describe("CallSessionProvider preference readiness", () => {
  it("applies authoritative preferences before becoming ready", async () => {
    const view = render();
    await act(async () => { await Promise.resolve(); });
    expect(view.host.querySelector('[data-testid="ready"]')?.textContent).toBe("true");
    expect(mocked.controllers[0].audioOptions[0]).toMatchObject({ forceTurn: true });
    act(() => view.root.unmount());
  });

  it("keeps answering gated while preferences are loading, then allows it", async () => {
    let resolve!: (value: { preferences: typeof preferences; version: number }) => void;
    mocked.api.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const view = render();
    const controller = mocked.controllers[0];
    act(() => controller.emitIncoming(invite()));
    const answer = Array.from(view.host.querySelectorAll("button")).find((button) => button.textContent?.includes("Answer"));
    expect(answer?.hasAttribute("disabled")).toBe(true);
    expect(controller.accepted).toEqual([]);
    await act(async () => { resolve({ preferences, version: 0 }); await Promise.resolve(); });
    const readyAnswer = Array.from(view.host.querySelectorAll("button")).find((button) => button.textContent?.includes("Answer"));
    expect(readyAnswer?.hasAttribute("disabled")).toBe(false);
    await act(async () => { readyAnswer?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
    expect(controller.accepted).toEqual(["call-1"]);
    act(() => view.root.unmount());
  });

  it("fails closed on preference load failure while still allowing decline and retry", async () => {
    mocked.api.mockRejectedValueOnce(new Error("load failed"));
    const view = render();
    await act(async () => { await Promise.resolve(); });
    const controller = mocked.controllers[0];
    act(() => controller.emitIncoming(invite("call-2")));
    expect(view.host.textContent).toContain("Preferences failed");
    const answer = Array.from(view.host.querySelectorAll("button")).find((button) => button.textContent?.includes("Answer"));
    expect(answer?.hasAttribute("disabled")).toBe(true);
    const decline = Array.from(view.host.querySelectorAll("button")).find((button) => button.textContent?.includes("Decline"));
    await act(async () => { decline?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
    expect(controller.rejected).toEqual(["call-2"]);
    act(() => view.root.unmount());
  });
});

describe("CallSessionProvider remote audio recovery", () => {
  it("renders an accessible recovery control when playback is blocked", async () => {
    const view = render();
    await act(async () => { await Promise.resolve(); });
    const controller = mocked.controllers[0];
    act(() => controller.options.onAudioPlaybackBlocked?.());
    expect(view.host.textContent).toContain("Remote audio is blocked");
    const button = Array.from(view.host.querySelectorAll("button")).find((item) => item.textContent?.includes("Enable audio playback"));
    expect(button).toBeTruthy();
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
    expect(controller.resumeRemoteAudio).toHaveBeenCalledTimes(1);
    act(() => view.root.unmount());
  });
});

describe("CallSessionProvider preference writes", () => {
  it("serializes concurrent PATCH requests and applies their increasing versions in order", async () => {
    type Snapshot = { preferences: typeof preferences; version: number };
    const pending: Array<(value: Snapshot) => void> = [];
    mocked.api.mockReset();
    mocked.api.mockResolvedValueOnce({ preferences, version: 0 });
    mocked.api.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return new Promise<Snapshot>((resolve) => pending.push(resolve));
      return Promise.resolve({ preferences, version: 0 });
    });
    const view = renderPreferences();
    await act(async () => { await Promise.resolve(); });

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = updatePreferencesForTest!({ theme: "dark" });
      second = updatePreferencesForTest!({ bitrateKbps: 64 });
      await Promise.resolve();
    });
    const patches = () => mocked.api.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(pending).toHaveLength(1);
    expect(patches()).toHaveLength(1);
    expect(JSON.parse(String(patches()[0]?.[1]?.body))).toEqual({ theme: "dark" });

    await act(async () => { pending[0]?.({ preferences: { ...preferences, theme: "dark" }, version: 1 }); await first; await Promise.resolve(); });
    expect(pending).toHaveLength(2);
    expect(patches()).toHaveLength(2);
    expect(JSON.parse(String(patches()[1]?.[1]?.body))).toEqual({ bitrateKbps: 64 });
    await act(async () => { pending[1]?.({ preferences: { ...preferences, theme: "dark", bitrateKbps: 64 }, version: 2 }); await second; });

    expect(view.host.querySelector('[data-testid="theme"]')?.textContent).toBe("dark");
    expect(view.host.querySelector('[data-testid="bitrate"]')?.textContent).toBe("64");
    expect(mocked.controllers[0]?.audioOptions.at(-1)).toMatchObject({ theme: "dark", bitrateKbps: 64 });
    act(() => view.root.unmount());
  });
});

describe("CallSessionProvider incoming calls", () => {
  it("hides incoming-call UI without rejecting when this browser is in do-not-disturb mode", async () => {
    localStorage.setItem(browserSettingsKey("test-user"), JSON.stringify({ doNotDisturb: true, missedCallNotifications: false }));
    const view = render();
    await act(async () => { await Promise.resolve(); });
    const controller = mocked.controllers[0];
    act(() => controller.emitIncoming(invite("call-dnd")));
    expect(view.host.textContent).not.toContain("Incoming call");
    expect(controller.rejected).toEqual([]);
    act(() => view.root.unmount());
  });

  it("preserves incoming peer identity after answering", async () => {
    const view = render();
    await act(async () => { await Promise.resolve(); });
    const controller = mocked.controllers[0];
    act(() => controller.emitIncoming(invite()));
    expect(view.host.textContent).toContain("Incoming call");
    const answer = Array.from(view.host.querySelectorAll("button")).find((button) => button.textContent?.includes("Answer"));
    await act(async () => { answer?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
    expect(controller.accepted).toEqual(["call-1"]);
    expect(view.host.querySelector('[data-testid="incoming"]')?.textContent).toBe("none");
    expect(view.host.querySelector('[data-testid="peer"]')?.textContent).toBe("Alice");
    act(() => view.root.unmount());
  });

  it("accepts a new invite when the previous controller snapshot is terminal", async () => {
    const view = render();
    await act(async () => { await Promise.resolve(); });
    const controller = mocked.controllers[0];
    controller.setTerminal();
    act(() => controller.emitIncoming(invite("call-2")));
    expect(view.host.textContent).toContain("Incoming call");
    expect(controller.rejected).toEqual([]);
    act(() => view.root.unmount());
  });
});
