// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
const startOutgoing = vi.hoisted(() => vi.fn());
const cancel = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({
  snapshot: { id: null as string | null, state: "IDLE" as string, role: null as "caller" | "callee" | null, durationMs: 0, muted: false, connectionState: "new" },
  controller: { startOutgoing, cancel, hangup: vi.fn(), toggleMute: vi.fn(), setAudioOutput: vi.fn() },
  preferencesReady: true,
  preferenceLoadError: false,
  retryPreferences: vi.fn(),
  preferences: { audioInputDeviceId: "", audioOutputDeviceId: "" },
  peer: null,
  online: true,
  error: null,
  updatePreferences: vi.fn(),
}));

vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../contexts/CallSession", () => ({ useCallSession: () => session }));
vi.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams("number=5551234")] }));
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
});
