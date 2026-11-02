import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Mic, MicOff, PhoneCall, PhoneOff, RefreshCw, Volume2 } from "lucide-react";
import { api } from "../lib/api";
import { formatElapsed } from "../lib/format";
import { PageHeader, StatusPill } from "../components/common";
import { Button, Card, Field, Notice } from "../components/ui";
import { useCallSession } from "../contexts/CallSession";

export default function DialerPage() {
  const [params] = useSearchParams();
  const [number, setNumber] = useState(params.get("number") || "");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const session = useCallSession();
  const call = session.snapshot;
  const active = !["IDLE", "ENDED", "REJECTED", "BUSY", "TIMEOUT", "FAILED", "CANCELLED"].includes(call.state);

  useEffect(() => { const fromUrl = params.get("number"); if (fromUrl) setNumber(fromUrl); }, [params]);
  async function placeCall(event?: FormEvent) {
    event?.preventDefault();
    if (!number.trim() || !session.controller) return;
    setError(null); setRequesting(true);
    let callId: string | undefined;
    try {
      const created = await api<{ callId: string; userId: string }>("/api/calls", { method: "POST", body: JSON.stringify({ number: number.trim() }) });
      callId = created.callId;
      await session.controller.startOutgoing(created.callId, created.userId);
    } catch (cause) {
      if (callId) await api(`/api/calls/${encodeURIComponent(callId)}/cancel`, { method: "POST" }).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "Could not start the call.");
    }
    finally { setRequesting(false); }
  }
  async function refreshDevices() {
    setDeviceError(null);
    try {
      const temporary = await navigator.mediaDevices.getUserMedia({ audio: true });
      temporary.getTracks().forEach((track) => track.stop());
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (cause) { setDeviceError(cause instanceof Error ? cause.message : "Could not access audio devices."); }
  }
  async function changeInput(deviceId: string) {
    try {
      await session.updatePreferences({ audioInputDeviceId: deviceId });
    } catch (cause) { setDeviceError(cause instanceof Error ? cause.message : "Could not change microphone."); }
  }
  async function changeOutput(deviceId: string) {
    try {
      await session.updatePreferences({ audioOutputDeviceId: deviceId });
      if (active) await session.controller?.setAudioOutput(deviceId);
    } catch (cause) { setDeviceError(cause instanceof Error ? cause.message : "Speaker selection is not available in this browser."); }
  }

  return <>
    <PageHeader eyebrow="Calling" title="Dialer" detail="Call another SparkCall number from your browser. Microphone access is requested only when you place or answer a call." />
    <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-[1.1fr_.9fr]">
      <Card className="p-5 sm:p-7">
        <div className="flex items-center justify-between"><h2 className="font-medium">{active ? "Current call" : "Place a call"}</h2>{active && <StatusPill tone={call.state === "CONNECTED" ? "success" : "warning"}>{call.state.toLowerCase()}</StatusPill>}</div>
        {!active ? <form onSubmit={(event) => void placeCall(event)} className="mt-5">
          <Field label="SparkCall number" autoComplete="off" inputMode="text" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="For example: SC888" />
          <p className="mt-2 text-xs text-neutral-500">Numbers are case-sensitive. Enter the recipient’s exact SparkCall number.</p>
          {error && <div className="mt-4"><Notice>{error}</Notice></div>}
          <Button type="submit" className="mt-5 w-full" disabled={!number.trim() || requesting || !session.controller}>{requesting ? "Connecting…" : <><PhoneCall size={16} /> Call</>}</Button>
        </form> : <div className="mt-5">
          <p className="text-2xl font-semibold tracking-tight">{call.role === "caller" ? number : session.incoming?.callerNumber || "Incoming caller"}</p>
          <p className="mt-1 text-sm text-neutral-500">{call.state === "CONNECTED" ? `Connected · ${formatElapsed(call.durationMs)}` : call.state === "CALLING" ? "Calling…" : call.state === "RINGING" ? "Ringing…" : "Establishing secure audio…"}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => session.controller?.toggleMute()}>{call.muted ? <MicOff size={16} /> : <Mic size={16} />}{call.muted ? "Unmute" : "Mute"}</Button>
            <Button variant="danger" onClick={() => call.role === "caller" && call.state !== "CONNECTED" ? session.controller?.cancel() : session.controller?.hangup()}><PhoneOff size={16} />{call.role === "caller" && call.state !== "CONNECTED" ? "Cancel" : "Hang up"}</Button>
          </div>
          <div className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800">
            <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Call audio</h3><Button variant="ghost" className="px-2" onClick={() => void refreshDevices()}><RefreshCw size={14} /> Refresh devices</Button></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-neutral-500">Microphone<select aria-label="Microphone" value={session.preferences.audioInputDeviceId} onChange={(event) => void changeInput(event.target.value)} className="focus-ring mt-1 block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 dark:border-neutral-800 dark:text-white"><option value="">System default</option>{devices.filter((device) => device.kind === "audioinput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}</select></label>
              <label className="text-xs text-neutral-500">Speaker<select aria-label="Speaker" value={session.preferences.audioOutputDeviceId} onChange={(event) => void changeOutput(event.target.value)} className="focus-ring mt-1 block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 dark:border-neutral-800 dark:text-white"><option value="">System default</option>{devices.filter((device) => device.kind === "audiooutput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Speaker"}</option>)}</select></label>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-neutral-500"><Volume2 size={14} className="mt-0.5 shrink-0" />Speaker selection depends on browser support. Bitrate is a target; network and codec behavior can change the actual rate.</p>
            {deviceError && <p role="alert" className="mt-2 text-xs text-red-600">{deviceError}</p>}
          </div>
        </div>}
      </Card>
      <Card className="p-5 sm:p-6">
        <h2 className="font-medium">Call status</h2>
        <dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-neutral-500">Presence</dt><dd>{session.online ? "Connected" : "Reconnecting"}</dd></div><div className="flex justify-between gap-4"><dt className="text-neutral-500">Connection</dt><dd className="capitalize">{call.connectionState}</dd></div><div className="flex justify-between gap-4"><dt className="text-neutral-500">Duration</dt><dd>{formatElapsed(call.durationMs)}</dd></div></dl>
        <div className="mt-5 border-t border-neutral-200 pt-4 text-xs leading-5 text-neutral-500 dark:border-neutral-800"><p>Calls use WebRTC. Cloudflare TURN credentials are fetched server-side and are never exposed as long-lived account credentials.</p><p className="mt-2">If the connection fails, confirm TURN credentials are configured for this deployment and try again.</p></div>
      </Card>
    </div>
  </>;
}
