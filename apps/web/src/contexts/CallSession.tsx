import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, type HistoryItem, type IncomingCallInvite, type PreferenceSnapshot, type UserPreferences } from "../lib/api";
import { browserSettingsKey, clearSeenMissedCallIds, readBrowserSettings, readSeenMissedCallIds, writeBrowserSettings, writeSeenMissedCallIds, type BrowserSettings } from "../lib/browser-settings";
import { CallController, type CallSnapshot } from "../lib/webrtc";
import { AccessibleDialog, Button, Notice } from "../components/ui";
import { Phone, PhoneOff, RefreshCw } from "lucide-react";

const DEFAULT_PREFERENCES: UserPreferences = {
  forceTurn: false,
  echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  audioInputDeviceId: "", audioOutputDeviceId: "", bitrateMode: "standard", bitrateKbps: 32,
  allowIncoming: true, showOnlineStatus: true, theme: "system",
};
type CallSessionValue = {
  controller: CallController | null;
  snapshot: CallSnapshot;
  online: boolean;
  incoming: IncomingCallInvite | null;
  peer: IncomingCallInvite | null;
  preferences: UserPreferences;
  browserSettings: BrowserSettings;
  preferencesReady: boolean;
  preferenceLoadError: boolean;
  retryPreferences: () => void;
  error: string | null;
  clearError: () => void;
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  updateBrowserSettings: (patch: Partial<BrowserSettings>) => void;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  audioPlaybackBlocked: boolean;
  resumeRemoteAudio: () => Promise<void>;
};
const CallSessionContext = createContext<CallSessionValue | null>(null);
const IDLE: CallSnapshot = { id: null, state: "IDLE", role: null, durationMs: 0, muted: false, connectionState: "new", networkOnline: true, recoveryStatus: "idle" };
const TERMINAL = new Set(["ENDED", "REJECTED", "BUSY", "TIMEOUT", "FAILED", "CANCELLED"]);

export function useCallSession() {
  const value = useContext(CallSessionContext);
  if (!value) throw new Error("useCallSession must be used inside an authenticated workspace.");
  return value;
}

export function CallSessionProvider({ children, userId }: { children: ReactNode; userId: string }) {
  const { t } = useTranslation("dialer");
  const { t: tSettings } = useTranslation("settings");
  const controllerRef = useRef<CallController | null>(null);
  const incomingRef = useRef<IncomingCallInvite | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const loadPreferencesRef = useRef<(() => Promise<void>) | null>(null);
  const preferenceRequestRef = useRef(0);
  const preferenceMutationRef = useRef(0);
  const preferenceVersionRef = useRef(0);
  const preferenceWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const browserSettingsRef = useRef<BrowserSettings>(readBrowserSettings(userId));
  const [controller, setController] = useState<CallController | null>(null);
  const [snapshot, setSnapshot] = useState(IDLE);
  const [online, setOnline] = useState(false);
  const [incoming, setIncomingState] = useState<IncomingCallInvite | null>(null);
  const [peer, setPeer] = useState<IncomingCallInvite | null>(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [browserSettings, setBrowserSettings] = useState<BrowserSettings>(() => readBrowserSettings(userId));
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferenceLoadError, setPreferenceLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
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
        // A terminal snapshot belongs to the previous call. CallController prepares
        // itself for the next call, so it must not reject this new invite as busy.
        const state = callController.snapshot.state;
        if ((!TERMINAL.has(state) && state !== "IDLE") || incomingRef.current) {
          const busyResponder = new CallController();
          void busyResponder.rejectIncoming(invite.callId);
          return;
        }
        if (browserSettingsRef.current.doNotDisturb) return;
        setIncoming(invite);
      },
      onIncomingCallEnded: (callId) => { if (incomingRef.current?.callId === callId) setIncoming(null); },
      onPresenceChange: (value) => { if (active) setOnline(value); },
      onAudioPlaybackBlocked: () => { if (active) setAudioPlaybackBlocked(true); },
      onAudioPlaybackRecovered: () => { if (active) setAudioPlaybackBlocked(false); },
      onError: (cause) => { if (active) setError(cause.message); },
    });
    controllerRef.current = callController;
    setController(callController);
    if (audioRef.current) callController.attachRemoteAudio(audioRef.current);

    loadPreferencesRef.current = async () => {
      const request = ++preferenceRequestRef.current;
      const mutationVersion = preferenceMutationRef.current;
      setPreferencesReady(false);
      setPreferenceLoadError(false);
      try {
        const saved = await api<PreferenceSnapshot>("/api/settings/preferences");
        if (!active || request !== preferenceRequestRef.current || mutationVersion !== preferenceMutationRef.current) return;
        const version = Number.isSafeInteger(saved.version) ? saved.version : 0;
        if (version < preferenceVersionRef.current) {
          setPreferenceLoadError(false);
          setPreferencesReady(true);
          return;
        }
        const next = { ...DEFAULT_PREFERENCES, ...saved.preferences };
        await callController.updateAudioOptions(next);
        if (!active || request !== preferenceRequestRef.current || mutationVersion !== preferenceMutationRef.current) return;
        preferenceVersionRef.current = version;
        setPreferences(next);
        setPreferencesReady(true);
      } catch {
        if (active && request === preferenceRequestRef.current) {
          setPreferencesReady(false);
          setPreferenceLoadError(true);
        }
      }
    };
    void loadPreferencesRef.current();
    void callController.connectPresence().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Presence connection failed.");
    });
    return () => {
      active = false;
      preferenceRequestRef.current += 1;
      loadPreferencesRef.current = null;
      callController.destroy();
      controllerRef.current = null;
      setAudioPlaybackBlocked(false);
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

  useEffect(() => {
    browserSettingsRef.current = browserSettings;
  }, [browserSettings]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== browserSettingsKey(userId) && event.key !== null) return;
      const next = readBrowserSettings(userId);
      browserSettingsRef.current = next;
      setBrowserSettings(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  useEffect(() => {
    if (browserSettings.doNotDisturb && incomingRef.current) setIncoming(null);
  }, [browserSettings.doNotDisturb, setIncoming]);

  const retryPreferences = useCallback(() => { void loadPreferencesRef.current?.(); }, []);
  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    preferenceMutationRef.current += 1;
    preferenceRequestRef.current += 1;
    const operation = preferenceWriteQueueRef.current.then(async () => {
      const saved = await api<PreferenceSnapshot>("/api/settings/preferences", { method: "PATCH", body: JSON.stringify({ ...patch }) });
      const version = Number.isSafeInteger(saved.version) ? saved.version : preferenceVersionRef.current + 1;
      if (version < preferenceVersionRef.current) return;
      const next = { ...DEFAULT_PREFERENCES, ...saved.preferences };
      preferenceVersionRef.current = version;
      setPreferences(next);
      setPreferenceLoadError(false);
      setPreferencesReady(true);
      await controllerRef.current?.updateAudioOptions(next);
    });
    preferenceWriteQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const updateBrowserSettings = useCallback((patch: Partial<BrowserSettings>) => {
    const next = { ...browserSettingsRef.current, ...patch };
    browserSettingsRef.current = next;
    setBrowserSettings(next);
    writeBrowserSettings(userId, next);
    if (patch.missedCallNotifications === false) clearSeenMissedCallIds(userId);
  }, [userId]);

  useEffect(() => {
    if (!preferencesReady || !browserSettings.missedCallNotifications) return;
    let active = true;
    let polling = false;
    let timer: number | undefined;
    const pollMissedCalls = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        const history = await api<HistoryItem[]>("/api/history?type=missed&limit=100");
        if (!active) return;
        const missed = history.filter((item) => item.direction === "incoming");
        const currentIds = missed.map((item) => item.id);
        const seenIds = readSeenMissedCallIds(userId);
        if (seenIds === null) {
          writeSeenMissedCallIds(userId, currentIds);
          return;
        }
        const seen = new Set(seenIds);
        const unseen = missed.filter((item) => !seen.has(item.id));
        writeSeenMissedCallIds(userId, [...seenIds, ...currentIds]);
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        for (let index = 0; index < unseen.length; index += 1) {
          try {
            const notification = new Notification(tSettings("notifications.missedTitle"), {
              body: tSettings("notifications.missedBody"),
            });
            notification.onclick = () => {
              window.focus();
              notification.close();
            };
          } catch {
            // Browser notifications are best-effort and must never interrupt calling.
          }
        }
      } catch {
        // History remains available in the app if polling or notification delivery fails.
      } finally {
        polling = false;
        if (active) timer = window.setTimeout(() => void pollMissedCalls(), 30_000);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void pollMissedCalls();
    };
    void pollMissedCalls();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [browserSettings.missedCallNotifications, preferencesReady, tSettings, userId]);
  const acceptIncoming = useCallback(async () => {
    const invite = incomingRef.current;
    if (!invite || !preferencesReady) return;
    // Keep identity after the prompt disappears so controls and the dialer can render it.
    setPeer(invite);
    setIncoming(null);
    try { await controllerRef.current?.acceptIncoming(invite.callId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not accept the call."); }
  }, [preferencesReady, setIncoming]);
  const resumeRemoteAudio = useCallback(async () => {
    try {
      await controllerRef.current?.resumeRemoteAudio();
    } catch {
      setAudioPlaybackBlocked(true);
    }
  }, []);
  const rejectIncoming = useCallback(async () => {
    const invite = incomingRef.current;
    if (!invite) return;
    setIncoming(null);
    await controllerRef.current?.rejectIncoming(invite.callId);
  }, [setIncoming]);

  const value = useMemo<CallSessionValue>(() => ({
    controller, snapshot, online, incoming, peer, preferences, browserSettings, preferencesReady, preferenceLoadError,
    retryPreferences, error, clearError, updatePreferences, updateBrowserSettings, acceptIncoming, rejectIncoming, audioPlaybackBlocked, resumeRemoteAudio,
  }), [controller, snapshot, online, incoming, peer, preferences, browserSettings, preferencesReady, preferenceLoadError, retryPreferences, error, clearError, updatePreferences, updateBrowserSettings, acceptIncoming, rejectIncoming, audioPlaybackBlocked, resumeRemoteAudio]);

  return <CallSessionContext.Provider value={value}>
    {children}
    <audio ref={audioRef} className="sr-only" autoPlay aria-label={t("incomingDialog.audioLabel")} />
    {audioPlaybackBlocked && <div className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50" role="alert">
      <span>{t("audio.playbackBlocked")}</span>
      <Button variant="secondary" className="shrink-0" onClick={() => void resumeRemoteAudio()}>{t("audio.enablePlayback")}</Button>
    </div>}
    <AccessibleDialog open={Boolean(incoming)} onClose={() => void rejectIncoming()} titleId="incoming-call-title" className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-neutral-100 dark:bg-neutral-900"><Phone size={18} aria-hidden="true" /></div>
      <h2 id="incoming-call-title" className="mt-4 text-lg font-semibold">{t("incomingDialog.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{incoming?.callerName} · {incoming?.callerNumber}</p>
      {!preferencesReady && <div className="mt-4"><Notice>{t(preferenceLoadError ? "incomingDialog.preferencesFailed" : "incomingDialog.preferencesLoading")}{preferenceLoadError && <Button variant="ghost" className="ml-2 px-2 py-1" onClick={retryPreferences}><RefreshCw size={14} aria-hidden="true" />{t("incomingDialog.retry")}</Button>}</Notice></div>}
      {error && <div className="mt-4"><Notice>{error}</Notice></div>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => void rejectIncoming()}><PhoneOff size={16} aria-hidden="true" /> {t("incomingDialog.decline")}</Button>
        <Button disabled={!preferencesReady} onClick={() => void acceptIncoming()}><Phone size={16} aria-hidden="true" /> {t("incomingDialog.answer")}</Button>
      </div>
    </AccessibleDialog>
  </CallSessionContext.Provider>;
}
