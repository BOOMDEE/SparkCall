import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mic, MicOff, PhoneCall, PhoneOff, RefreshCw, ShieldCheck, Volume2 } from "lucide-react";
import { api, type UserPreferences } from "../lib/api";
import { formatElapsed } from "../lib/format";
import { PageHeader, StatusPill } from "../components/common";
import { Button, Card, Field, Notice } from "../components/ui";
import { useCallSession } from "../contexts/CallSession";

const TERMINAL_STATES = new Set(["IDLE", "ENDED", "REJECTED", "BUSY", "TIMEOUT", "FAILED", "CANCELLED"]);

type Translate = (key: string, options?: Record<string, unknown>) => string;

function errorMessage(cause: unknown, t: Translate, key: string) {
  const detail = cause instanceof Error ? cause.message : "";
  return t(key, { detail: detail && detail.length < 160 ? detail : "" });
}

export default function DialerPage() {
  const { t } = useTranslation("dialer");
  const [params] = useSearchParams();
  const [number, setNumber] = useState(params.get("number") || "");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const session = useCallSession();
  const callAttemptRef = useRef(0);
  const call = session.snapshot;
  const active = !TERMINAL_STATES.has(call.state);
  const peerName = call.role === "caller"
    ? number.trim() || t("identity.outgoingCall")
    : session.peer?.callerName || session.peer?.callerNumber || t("identity.incomingCaller");
  const stateLabel = t(`states.${call.state.toLowerCase()}`);
  const statusTone = call.state === "CONNECTED" ? "success" : call.state === "FAILED" ? "error" : "warning";

  useEffect(() => {
    const fromUrl = params.get("number");
    if (fromUrl) setNumber(fromUrl);
  }, [params]);

  async function placeCall(event?: FormEvent) {
    event?.preventDefault();
    if (!number.trim()) {
      setError(t("errors.missingNumber"));
      return;
    }
    if (!session.controller || !session.preferencesReady) return;
    const attempt = ++callAttemptRef.current;
    setError(null);
    setRequesting(true);
    let callId: string | undefined;
    try {
      const created = await api<{ callId: string; userId: string }>("/api/calls", {
        method: "POST",
        body: JSON.stringify({ number: number.trim() }),
      });
      callId = created.callId;
      await session.controller.startOutgoing(created.callId, created.userId);
    } catch (cause) {
      if (callId) {
        await cancelServerCall(callId);
      }
      if (attempt === callAttemptRef.current) setError(errorMessage(cause, t, "errors.callFailed"));
    } finally {
      if (attempt === callAttemptRef.current) setRequesting(false);
    }
  }

  function cancelServerCall(callId: string): Promise<void> {
    return api(`/api/calls/${encodeURIComponent(callId)}/cancel`, { method: "POST" })
      .then(() => undefined)
      .catch(() => undefined);
  }

  function cancelOutgoing() {
    callAttemptRef.current += 1;
    setRequesting(false);
    session.controller?.cancel();
  }

  async function refreshDevices() {
    setDeviceError(null);
    try {
      const temporary = await navigator.mediaDevices.getUserMedia({ audio: true });
      temporary.getTracks().forEach((track) => track.stop());
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (cause) {
      setDeviceError(errorMessage(cause, t, "errors.audioDevicesFailed"));
    }
  }

  async function changeInput(deviceId: string) {
    setDeviceError(null);
    try {
      await session.updatePreferences({ audioInputDeviceId: deviceId });
    } catch (cause) {
      setDeviceError(errorMessage(cause, t, "errors.microphoneFailed"));
    }
  }

  async function changeOutput(deviceId: string) {
    setDeviceError(null);
    try {
      await session.updatePreferences({ audioOutputDeviceId: deviceId });
      if (active) await session.controller?.setAudioOutput(deviceId);
    } catch (cause) {
      setDeviceError(errorMessage(cause, t, "errors.speakerFailed"));
    }
  }

  async function changeConnectionMode(value: UserPreferences["connectionMode"]) {
    setModeSaving(true);
    setError(null);
    try { await session.updatePreferences({ connectionMode: value }); }
    catch (cause) { setError(errorMessage(cause, t, "errors.modeSave")); }
    finally { setModeSaving(false); }
  }

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} detail={t("detail")} />
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(250px,.65fr)]">
      <Card className="overflow-hidden">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">{active ? t("sections.currentCall") : t("sections.placeCall")}</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">{active ? peerName : t("form.prompt")}</h2>
            </div>
            {active && <StatusPill tone={statusTone}>{stateLabel}</StatusPill>}
          </div>
        </div>

        {!active ? <form onSubmit={(event) => void placeCall(event)} className="p-5 sm:p-7">
          <Field
            label={t("form.numberLabel")}
            autoComplete="off"
            inputMode="text"
            value={number}
            onChange={(event) => { setNumber(event.target.value); if (error) setError(null); }}
            placeholder={t("form.numberPlaceholder")}
            aria-describedby="dialer-number-hint"
          />
          <p id="dialer-number-hint" className="mt-2 text-xs leading-5 text-neutral-500">{t("form.numberHint")}</p>
          {error && <div className="mt-4"><Notice>{error}</Notice></div>}
          {!session.preferencesReady && <div className="mt-4"><Notice>{t(session.preferenceLoadError ? "errors.preferencesFailed" : "errors.preferencesLoading")} {session.preferenceLoadError && <Button variant="ghost" className="ml-2 px-2 py-1" onClick={session.retryPreferences}><RefreshCw size={14} aria-hidden="true" />{t("actions.retry")}</Button>}</Notice></div>}
          {session.error && <div className="mt-4"><Notice>{t("errors.session", { detail: session.error })}</Notice></div>}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" className="sm:min-w-36" disabled={requesting || !session.controller || !session.preferencesReady}>
              <PhoneCall size={16} aria-hidden="true" />{requesting ? t("form.connecting") : t("form.call")}
            </Button>
            <p className="flex items-center gap-2 text-xs text-neutral-500"><ShieldCheck size={14} aria-hidden="true" />{t("form.privacyNote")}</p>
          </div>
        </form> : <div className="p-5 sm:p-7">
          <div className="flex items-center gap-3 text-sm text-neutral-500">
            <span className={`h-2 w-2 rounded-full ${call.state === "CONNECTED" ? "bg-green-500" : "bg-amber-500"}`} aria-hidden="true" />
            <span aria-live="polite">{stateLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{formatElapsed(call.durationMs)}</span>
          </div>
          <p className="mt-6 break-all text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{peerName}</p>
          <p className="mt-2 text-sm text-neutral-500">{call.role === "caller" ? t("identity.outgoingCall") : t("identity.incomingCall")}</p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => session.controller?.toggleMute()} aria-pressed={call.muted}>
              {call.muted ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
              {call.muted ? t("actions.unmute") : t("actions.mute")}
            </Button>
            <Button variant="danger" onClick={() => call.role === "caller" && call.state !== "CONNECTED" ? cancelOutgoing() : session.controller?.hangup()}>
              <PhoneOff size={16} aria-hidden="true" />{call.role === "caller" && call.state !== "CONNECTED" ? t("actions.cancel") : t("actions.hangUp")}
            </Button>
          </div>
          {session.error && <div className="mt-6"><Notice>{t("errors.session", { detail: session.error })}</Notice></div>}
        </div>}

        <div className="border-t border-neutral-200 px-5 py-4 dark:border-neutral-800 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">{t("audio.title")}</h3>
              <p className="mt-1 text-xs text-neutral-500">{t("audio.detail")}</p>
            </div>
            <Button variant="ghost" className="px-2" onClick={() => void refreshDevices()}>
              <RefreshCw size={14} aria-hidden="true" />{t("actions.refreshDevices")}
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-neutral-500">
              <span className="mb-1.5 block font-medium">{t("audio.microphone")}</span>
              <select aria-label={t("audio.microphone")} value={session.preferences.audioInputDeviceId} onChange={(event) => void changeInput(event.target.value)} className="focus-ring block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 dark:border-neutral-800 dark:text-white">
                <option value="">{t("audio.systemDefault")}</option>
                {devices.filter((device) => device.kind === "audioinput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || t("audio.microphoneOption")}</option>)}
              </select>
            </label>
            <label className="text-xs text-neutral-500">
              <span className="mb-1.5 block font-medium">{t("audio.speaker")}</span>
              <select aria-label={t("audio.speaker")} value={session.preferences.audioOutputDeviceId} onChange={(event) => void changeOutput(event.target.value)} className="focus-ring block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 dark:border-neutral-800 dark:text-white">
                <option value="">{t("audio.systemDefault")}</option>
                {devices.filter((device) => device.kind === "audiooutput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || t("audio.speakerOption")}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-neutral-500"><Volume2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{t("audio.supportNote")}</p>
          {deviceError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{deviceError}</p>}
        </div>
      </Card>

      <Card className="h-fit p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">{t("status.eyebrow")}</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{t("sections.callStatus")}</h2>
          </div>
          <span className={`mt-1 h-2 w-2 rounded-full ${session.online ? "bg-green-500" : "bg-amber-500"}`} aria-label={session.online ? t("status.online") : t("status.offline")} />
        </div>
        <label className="mt-5 block text-xs font-medium text-neutral-600 dark:text-neutral-400"><span className="mb-1.5 block">{t("status.preferredMode")}</span><select aria-label={t("status.preferredMode")} value={session.preferences.connectionMode} disabled={!session.preferencesReady || modeSaving} onChange={(event) => void changeConnectionMode(event.target.value as UserPreferences["connectionMode"])} className="focus-ring block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:text-white"><option value="auto">{t("status.connectionModes.auto")}</option><option value="p2p">{t("status.connectionModes.preferredP2p")}</option><option value="turn">{t("status.connectionModes.preferredTurn")}</option></select></label>
        <p className="mt-2 text-xs leading-5 text-neutral-500">{t("status.modePreferenceDetail")}</p>
        <dl className="mt-6 divide-y divide-neutral-200 border-y border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          <div className="flex items-center justify-between gap-4 py-3"><dt className="text-neutral-500">{t("status.presence")}</dt><dd>{session.online ? t("status.online") : t("status.offline")}</dd></div>
          <div className="flex items-center justify-between gap-4 py-3"><dt className="text-neutral-500">{t("status.network")}</dt><dd>{t(`status.networkStates.${call.networkOnline ? "online" : "offline"}`)}</dd></div>
          <div className="flex items-center justify-between gap-4 py-3"><dt className="text-neutral-500">{t("status.state")}</dt><dd>{stateLabel}</dd></div>
          <div className="flex items-center justify-between gap-4 py-3"><dt className="text-neutral-500">{t("status.connection")}</dt><dd>{t(`status.connectionStates.${call.connectionState}`)}</dd></div>
          <div className="flex items-center justify-between gap-4 py-3"><dt className="text-neutral-500">{t("status.currentMode")}</dt><dd>{t(`status.connectionModes.${call.connectionMode}`)}</dd></div>
          <div className="flex items-center justify-between gap-4 py-3"><dt className="text-neutral-500">{t("status.duration")}</dt><dd>{formatElapsed(call.durationMs)}</dd></div>
        </dl>
        {call.relayUnavailable && <p role="status" aria-live="polite" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">{t("status.relayUnavailable")}</p>}
        {call.recoveryStatus !== "idle" && <p role={call.recoveryStatus === "failed" ? "alert" : "status"} aria-live="polite" className={`mt-4 text-sm leading-6 ${call.recoveryStatus === "failed" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}`}>{t(`status.recovery.${call.recoveryStatus}`)}</p>}
        <div className="mt-5 space-y-2 text-xs leading-5 text-neutral-500">
          <p>{t("status.webrtcNote")}</p>
          <p>{t("status.failureHint")}</p>
        </div>
      </Card>
    </div>
  </>;
}
