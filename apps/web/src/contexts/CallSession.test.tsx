// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocked = vi.hoisted(() => {
  const controllers: any[] = [];
  class MockController {
    options: Record<string, ((...args: any[]) => void) | undefined>;
    state: any = { id: null, state: "IDLE", role: null, durationMs: 0, muted: false, connectionState: "new" };
    accepted: string[] = [];
    rejected: string[] = [];
    constructor(options: Record<string, ((...args: any[]) => void) | undefined> = {}) { this.options = options; controllers.push(this); }
    get snapshot() { return this.state; }
    async connectPresence() { this.options.onPresenceChange?.(true); }
    async updateAudioOptions() {}
    attachRemoteAudio() {}
    destroy() {}
    async acceptIncoming(callId: string) { this.accepted.push(callId); this.state = { ...this.state, id: callId, state: "RINGING", role: "callee" }; this.options.onChange?.(this.state); }
    async rejectIncoming(callId: string) { this.rejected.push(callId); }
    emitIncoming(invite: unknown) { this.options.onIncomingCall?.(invite); }
    setTerminal() { this.state = { ...this.state, id: "old", state: "ENDED", role: "caller" }; }
  }
  return { MockController, controllers };
});

vi.mock("../lib/webrtc", () => ({ CallController: mocked.MockController }));
vi.mock("../lib/api", () => ({ api: vi.fn().mockResolvedValue({}) }));

import { CallSessionProvider, useCallSession } from "./CallSession";

function Consumer() {
  const session = useCallSession();
  return <div><output data-testid="peer">{session.peer?.callerName || "none"}</output><output data-testid="incoming">{session.incoming?.callId || "none"}</output><output data-testid="state">{session.snapshot.state}</output></div>;
}

function render() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<CallSessionProvider><Consumer /></CallSessionProvider>));
  return { host, root };
}

function invite(callId = "call-1") { return { callId, callerNumber: "SC111", callerName: "Alice", createdAt: Date.now(), expiresAt: Date.now() + 30_000 }; }

afterEach(() => { document.body.innerHTML = ""; mocked.controllers.length = 0; vi.clearAllMocks(); });

describe("CallSessionProvider incoming calls", () => {
  it("preserves incoming peer identity after answering", async () => {
    const view = render();
    const controller = mocked.controllers[0];
    act(() => controller.emitIncoming(invite()));
    expect(view.host.textContent).toContain("Incoming call");
    const answer = Array.from(view.host.querySelectorAll("button")).find((button) => button.textContent?.includes("Answer"));
    expect(answer).toBeTruthy();
    await act(async () => { answer?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
    expect(controller.accepted).toEqual(["call-1"]);
    expect(view.host.querySelector('[data-testid="incoming"]')?.textContent).toBe("none");
    expect(view.host.querySelector('[data-testid="peer"]')?.textContent).toBe("Alice");
    act(() => view.root.unmount());
  });

  it("accepts a new invite when the previous controller snapshot is terminal", () => {
    const view = render();
    const controller = mocked.controllers[0];
    controller.setTerminal();
    act(() => controller.emitIncoming(invite("call-2")));
    expect(view.host.textContent).toContain("Incoming call");
    expect(controller.rejected).toEqual([]);
    act(() => view.root.unmount());
  });
});
