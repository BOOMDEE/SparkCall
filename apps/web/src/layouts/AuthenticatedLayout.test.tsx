// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  snapshot: { id: "call-1", state: "CONNECTED", role: "callee", durationMs: 0, muted: false, connectionState: "connected", connectionMode: "unknown", relayUnavailable: false },
  peer: { callId: "call-1", callerName: "Alice", callerNumber: "SC111", createdAt: 0, expiresAt: Date.now() + 1000 },
  controller: { toggleMute: vi.fn(), hangup: vi.fn(), cancel: vi.fn() },
}));
vi.mock("../contexts/CallSession", () => ({ useCallSession: () => session }));

import { ActiveCallControls } from "./AuthenticatedLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("ActiveCallControls", () => {
  it("renders mute and hang-up controls for an incoming call outside the dialer", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<ActiveCallControls onOpenDialer={vi.fn()} />));
    expect(host.querySelector('[role="region"]')?.textContent).toContain("Alice");
    const mute = host.querySelector('button[aria-label="Mute call"]') as HTMLButtonElement;
    const hangup = host.querySelector('button[aria-label="Hang up call"]') as HTMLButtonElement;
    expect(mute).toBeTruthy();
    expect(hangup).toBeTruthy();
    act(() => mute.click());
    act(() => hangup.click());
    expect(session.controller.toggleMute).toHaveBeenCalledTimes(1);
    expect(session.controller.hangup).toHaveBeenCalledTimes(1);
  });

  it("does not render controls for a terminal call", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    session.snapshot = { ...session.snapshot, state: "ENDED" };
    act(() => root.render(<ActiveCallControls onOpenDialer={vi.fn()} />));
    expect(host.querySelector('[role="region"]')).toBeNull();
    session.snapshot = { ...session.snapshot, state: "CONNECTED" };
  });
});
