// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
const startOutgoing = vi.hoisted(() => vi.fn());
const cancel = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ username: null as string | null }));
const session = vi.hoisted(() => ({
  snapshot: { id: null as string | null, state: "IDLE" as string, role: null as "caller" | "callee" | null, durationMs: 0, muted: false, connectionState: "new", connectionMode: "unknown" as "unknown" | "p2p" | "turn", relayUnavailable: false, networkOnline: true, recoveryStatus: "idle" as "idle" | "reconnecting" | "recovered" | "failed" },
  controller: { startOutgoing, cancel, hangup: vi.fn(), toggleMute: vi.fn(), setAudioOutput: vi.fn() },
  incoming: null as null | { callId: string },
  preferencesReady: true,
  preferenceLoadError: false,
  retryPreferences: vi.fn(),
  preferences: { audioInputDeviceId: "", audioOutputDeviceId: "", connectionMode: "auto" },
  peer: null,
  online: true,
  error: null,
  updatePreferences: vi.fn(),
}));

vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../contexts/CallSession", () => ({ useCallSession: () => session }));
vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; className?: string }) => <a href={to} {...props}>{children}</a>,
  useParams: () => ({ username: route.username ?? undefined }),
  useSearchParams: () => [new URLSearchParams("number=5551234")],
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../components/common", () => ({
  PageHeader: () => <header />,
  StatusPill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../components/ui", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Field: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Notice: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
}));
vi.mock("lucide-react", () => ({
  Mic: () => null,
  MicOff: () => null,
  PhoneCall: () => null,
  PhoneOff: () => null,
  RefreshCw: () => null,
  ShieldCheck: () => null,
  Volume2: () => null,
}));

import DialerPage from "./DialerPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  session.snapshot = { id: null, state: "IDLE", role: null, durationMs: 0, muted: false, connectionState: "new", connectionMode: "unknown", relayUnavailable: false, networkOnline: true, recoveryStatus: "idle" };
  session.incoming = null;
  route.username = null;
  vi.clearAllMocks();
});

describe("DialerPage outgoing cancellation", () => {
  it("delegates cancellation to the shared controller while WebRTC setup is delayed", async () => {
    let releaseSetup!: () => void;
    const setup = new Promise<void>((resolve) => { releaseSetup = resolve; });
    startOutgoing.mockImplementation(() => {
      session.snapshot = { ...session.snapshot, id: "call-1", state: "CALLING", role: "caller" };
      return setup;
    });
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/calls") return Promise.resolve({ callId: "call-1", userId: "callee-1" });
      return Promise.resolve(undefined);
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<DialerPage />));

    const form = host.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
      await Promise.resolve();
    });
    expect(startOutgoing).toHaveBeenCalledWith("call-1", "callee-1");
    act(() => root.render(<DialerPage />));

    const cancelButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "actions.cancel") as HTMLButtonElement;
    expect(cancelButton).toBeTruthy();
    act(() => cancelButton.click());

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls.some(([path]) => path === "/api/calls/call-1/cancel")).toBe(false);

    await act(async () => {
      releaseSetup();
      await setup;
    });
  });

  it("shows safe device network and ICE recovery diagnostics", () => {
    session.snapshot = { ...session.snapshot, networkOnline: false, recoveryStatus: "reconnecting" };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<DialerPage />));

    expect(host.textContent).toContain("status.networkStates.offline");
    expect(host.textContent).toContain("status.recovery.reconnecting");
    act(() => root.unmount());
  });

  it("automatically starts a username deep-link call once, including under StrictMode", async () => {
    route.username = "Alice.Example";
    apiMock.mockResolvedValue({ callId: "call-username", userId: "callee-1" });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<StrictMode><DialerPage /></StrictMode>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith("/api/calls", {
      method: "POST",
      body: JSON.stringify({ targetUsername: "Alice.Example" }),
    });
    expect(startOutgoing).toHaveBeenCalledWith("call-username", "callee-1");
    expect(host.textContent).toContain("Alice.Example");
    act(() => root.unmount());
  });

  it("does not auto-start a username link while another call is active", () => {
    route.username = "Alice";
    session.snapshot = { ...session.snapshot, id: "existing-call", state: "CONNECTED", role: "caller" };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<DialerPage />));

    expect(apiMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("errors.alreadyOnCall");
    expect(host.textContent).toContain("actions.openCurrentCall");
    act(() => root.unmount());
  });
});
