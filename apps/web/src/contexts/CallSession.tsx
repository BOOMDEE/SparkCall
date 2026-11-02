import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type IncomingCallInvite, type UserPreferences } from "../lib/api";
import { CallController, type CallSnapshot } from "../lib/webrtc";
import { Button, Notice } from "../components/ui";
import { Phone, PhoneOff } from "lucide-react";

const DEFAULT_PREFERENCES: UserPreferences = {
  echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  audioInputDeviceId: "", audioOutputDeviceId: "", bitrateMode: "standard", bitrateKbps: 32,
  allowIncoming: true, showOnlineStatus: true, theme: "system",
};
type CallSessionValue = {
  controller: CallController | null;
  snapshot: CallSnapshot;
  online: boolean;
  incoming: IncomingCallInvite | null;
  preferences: UserPreferences;
  error: string | null;
  clearError: () => void;
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
};
const CallSessionContext = createContext<CallSessionValue | null>(null);
const IDLE: CallSnapshot = { id: null, state: "IDLE", role: null, durationMs: 0, muted: false, connectionState: "new" };

export function useCallSession() {
  const value = useContext(CallSessionContext);
  if (!value) throw new Error("useCallSession must be used inside an authenticated workspace.");
  return value;
}

export function CallSessionProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<CallController | null>(null);
  const incomingRef = useRef<IncomingCallInvite | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [controller, setController] = useState<CallController | null>(null);
  const [snapshot, setSnapshot] = useState(IDLE);
  const [online, setOnline] = useState(false);
  const [incoming, setIncomingState] = useState<IncomingCallInvite | null>(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [error, setError] = useState<string | null>(null);
  const setIncoming = useCallback((invite: IncomingCallInvite | null) => {
    incomingRef.current = invite;
    setIncomingState(invite);
  }, []);
  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    let active = true;
    const callController = new CallController({
      onChange: (next) => { if (active) setSnapshot(next); },
      onIncomingCall: (invite) => {
        if (!active) return;
        if (callController.snapshot.state !== "IDLE" || incomingRef.current) {
          const busyResponder = new CallController();
          void busyResponder.rejectIncoming(invite.callId);
          return;
        }
        setIncoming(invite);
      },
      onIncomingCallEnded: (callId) => { if (incomingRef.current?.callId === callId) setIncoming(null); },
      onPresenceChange: (value) => { if (active) setOnline(value); },
      onError: (cause) => { if (active) setError(cause.message); },
    });
    controllerRef.current = callController;
    setController(callController);
    if (audioRef.current) callController.attachRemoteAudio(audioRef.current);
    void api<UserPreferences>("/api/settings/preferences").then(async (saved) => {
      if (!active) return;
      const next = { ...DEFAULT_PREFERENCES, ...saved };
      setPreferences(next);
      await callController.updateAudioOptions(next);
    }).catch(() => undefined);
    void callController.connectPresence().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Presence connection failed.");
    });
    return () => {
      active = false;
      callController.destroy();
      controllerRef.current = null;
      setController(null);
    };
  }, [setIncoming]);

  useEffect(() => {
    if (!incoming) return;
    const timeout = window.setTimeout(() => {
      if (incomingRef.current?.callId === incoming.callId) setIncoming(null);
    }, Math.max(0, incoming.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [incoming, setIncoming]);

  const updatePreferences = useCallback(async (patch: Partial<UserPreferences>) => {
    const saved = await api<UserPreferences>("/api/settings/preferences", { method: "PATCH", body: JSON.stringify(patch) });
    const next = { ...DEFAULT_PREFERENCES, ...saved };
    setPreferences(next);
    await controllerRef.current?.updateAudioOptions(next);
  }, []);
  const acceptIncoming = useCallback(async () => {
    const invite = incomingRef.current;
    if (!invite) return;
    setIncoming(null);
    try { await controllerRef.current?.acceptIncoming(invite.callId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not accept the call."); }
  }, [setIncoming]);
  const rejectIncoming = useCallback(async () => {
    const invite = incomingRef.current;
    if (!invite) return;
    setIncoming(null);
    await controllerRef.current?.rejectIncoming(invite.callId);
  }, [setIncoming]);

  const value = useMemo<CallSessionValue>(() => ({
    controller, snapshot, online, incoming, preferences, error, clearError,
    updatePreferences, acceptIncoming, rejectIncoming,
  }), [controller, snapshot, online, incoming, preferences, error, clearError, updatePreferences, acceptIncoming, rejectIncoming]);

  return <CallSessionContext.Provider value={value}>
    {children}
    <audio ref={audioRef} className="sr-only" autoPlay aria-label="Call audio" />
    {incoming && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <section className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-950" role="dialog" aria-modal="true" aria-labelledby="incoming-call-title">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-neutral-100 dark:bg-neutral-900"><Phone size={18} /></div>
        <h2 id="incoming-call-title" className="mt-4 text-lg font-semibold">Incoming call</h2>
        <p className="mt-1 text-sm text-neutral-500">{incoming.callerName} · {incoming.callerNumber}</p>
        {error && <div className="mt-4"><Notice>{error}</Notice></div>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => void rejectIncoming()}><PhoneOff size={16} /> Decline</Button>
          <Button onClick={() => void acceptIncoming()}><Phone size={16} /> Answer</Button>
        </div>
      </section>
    </div>}
  </CallSessionContext.Provider>;
}
