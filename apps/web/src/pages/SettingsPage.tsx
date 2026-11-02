import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useOutletContext } from "react-router-dom";
import { useCallSession } from "../contexts/CallSession";
import { api, type Me, type Usage, type UserPreferences } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatBytes, formatDate } from "../lib/format";
import { PageHeader } from "../components/common";
import { Button, Card, Field, Notice } from "../components/ui";

const SECTIONS = [["account", "Account"], ["audio", "Audio"], ["privacy", "Privacy"], ["usage", "Usage"], ["appearance", "Appearance"]] as const;
export default function SettingsLayout() {
  const location = useLocation();
  const active = location.pathname.split("/")[2] || "account";
  const pages: Record<(typeof SECTIONS)[number][0], React.ReactNode> = {
    account: <AccountSettings />, audio: <AudioSettings />, privacy: <PrivacySettings />, usage: <UsageSettings />, appearance: <AppearanceSettings />,
  };
  if (!Object.hasOwn(pages, active)) return <Navigate to="/settings/account" replace />;
  return <><PageHeader title="Settings" detail="Manage your identity, calling preferences, privacy, and display." />
    <div className="grid gap-7 lg:grid-cols-[160px_1fr]"><nav className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5" aria-label="Settings sections">
      {SECTIONS.map(([id, label]) => <Link key={id} to={`/settings/${id}`} className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm ${active === id ? "bg-neutral-100 font-medium dark:bg-neutral-900" : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900"}`}>{label}</Link>)}
    </nav><div className="min-w-0">{pages[active as keyof typeof pages]}</div></div>
  </>;
}

function AccountSettings() {
  const { me, setMe } = useOutletContext<{ me: Me; setMe: (user: Me) => void }>();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [number, setNumber] = useState("");
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function saveDisplayName(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null);
    try { const user = await api<Me>("/api/me", { method: "PATCH", body: JSON.stringify({ displayName }) }); setMe(user); setNotice("Display name saved."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save profile."); }
  }
  async function checkAvailability() {
    setError(null); setAvailability(null);
    try { const result = await api<{ available: boolean }>(`/api/numbers/availability?number=${encodeURIComponent(number.trim())}`); setAvailability(result.available); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not check number availability."); }
  }
  async function claimNumber(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null); setBusy(true);
    try { await api("/api/numbers", { method: "POST", body: JSON.stringify({ number: number.trim() }) }); const fresh = await api<Me>("/api/me"); setMe(fresh); setNotice("SparkCall number saved."); setAvailability(null); setNumber(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not claim this number."); }
    finally { setBusy(false); }
  }
  async function upgrade(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null); setBusy(true);
    try { const user = await api<Me>("/api/auth/upgrade", { method: "POST", body: JSON.stringify({ username, password }) }); setMe(user); setNotice("Your temporary identity is now a permanent account. Existing contacts and call records remain on this identity."); setPassword(""); setUsername(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not upgrade the account."); }
    finally { setBusy(false); }
  }
  return <Card className="p-5 sm:p-7"><h2 className="text-lg font-semibold">Account and identity</h2><p className="mt-1 text-sm text-neutral-500">Your SparkCall identity is separate from your login session.</p>
    {error && <div className="mt-5"><Notice>{error}</Notice></div>}{notice && <div className="mt-5"><Notice tone="success">{notice}</Notice></div>}
    <form onSubmit={(event) => void saveDisplayName(event)} className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Display name" maxLength={80} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><Field label="Username" value={me.username || "Temporary account"} readOnly /><div className="sm:col-span-2"><Button type="submit">Save display name</Button></div></form>
    <div className="mt-7 border-t border-neutral-200 pt-6 dark:border-neutral-800"><h3 className="font-medium">SparkCall number</h3><p className="mt-1 text-sm text-neutral-500">Current number: <span className="font-medium text-neutral-900 dark:text-neutral-100">{me.number || "Not claimed"}</span></p>
      {me.temporary ? <p className="mt-3 text-sm text-neutral-500">Temporary accounts use an automatically generated number and cannot claim a custom number.</p> : <form onSubmit={(event) => void claimNumber(event)} className="mt-4 space-y-3"><Field label="Choose a number" maxLength={32} minLength={3} value={number} onChange={(event) => { setNumber(event.target.value); setAvailability(null); }} placeholder="Letters and numbers only; case-sensitive" />
        <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="secondary" disabled={number.trim().length < 3} onClick={() => void checkAvailability()}>Check availability</Button><Button type="submit" disabled={busy || !number.trim() || availability !== true}>{busy ? "Saving…" : "Claim number"}</Button>{availability === true && <span className="text-xs text-green-700">Available</span>}{availability === false && <span className="text-xs text-red-600">Unavailable</span>}</div>
        <p className="text-xs text-neutral-500">Numbers are case-sensitive. You can change your number once every 30 days.</p></form>}
    </div>
    {me.temporary && <div className="mt-7 border-t border-neutral-200 pt-6 dark:border-neutral-800"><h3 className="font-medium">Upgrade temporary account</h3><p className="mt-1 text-sm text-neutral-500">Create a permanent username and password while preserving this identity and its eligible data.</p><form onSubmit={(event) => void upgrade(event)} className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Username" autoComplete="username" minLength={3} maxLength={32} required value={username} onChange={(event) => setUsername(event.target.value)} /><Field label="Password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={(event) => setPassword(event.target.value)} /><div className="sm:col-span-2"><Button disabled={busy}>Upgrade account</Button></div></form>{me.expiresAt && <p className="mt-3 text-xs text-neutral-500">This temporary account expires {formatDate(me.expiresAt)}.</p>}</div>}
  </Card>;
}

function AudioSettings() {
  const { preferences, updatePreferences } = useCallSession();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function refreshDevices() {
    setError(null);
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); setDevices(await navigator.mediaDevices.enumerateDevices()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not access audio devices."); }
  }
  async function update(patch: Partial<UserPreferences>) {
    setError(null); setSaved(false);
    try { await updatePreferences(patch); setSaved(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save audio preferences."); }
  }
  const toggleOptions = [["echoCancellation", "Echo cancellation"], ["noiseSuppression", "Noise suppression"], ["autoGainControl", "Automatic gain control"]] as const;
  return <Card className="p-5 sm:p-7"><h2 className="text-lg font-semibold">Audio</h2><p className="mt-1 text-sm text-neutral-500">Settings are persisted and used on future calls. Actual audio bitrate can vary with network conditions and codec behavior.</p>
    {error && <div className="mt-4"><Notice>{error}</Notice></div>}{saved && <div className="mt-4"><Notice tone="success">Audio preferences saved.</Notice></div>}
    <div className="mt-6 space-y-1">{toggleOptions.map(([key, label]) => <label key={key} className="flex items-center justify-between border-b border-neutral-100 py-4 text-sm dark:border-neutral-900"><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={(event) => void update({ [key]: event.target.checked })} /></label>)}</div>
    <div className="mt-6"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Audio devices</h3><Button variant="secondary" onClick={() => void refreshDevices()}>Refresh devices</Button></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm">Microphone<select value={preferences.audioInputDeviceId} onChange={(event) => void update({ audioInputDeviceId: event.target.value })} className="focus-ring mt-1.5 block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm dark:border-neutral-800"><option value="">System default</option>{devices.filter((device) => device.kind === "audioinput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}</select></label>
        <label className="text-sm">Speaker<select value={preferences.audioOutputDeviceId} onChange={(event) => void update({ audioOutputDeviceId: event.target.value })} className="focus-ring mt-1.5 block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm dark:border-neutral-800"><option value="">System default</option>{devices.filter((device) => device.kind === "audiooutput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Speaker"}</option>)}</select></label></div>
      <p className="mt-2 text-xs text-neutral-500">Device names appear after you grant microphone access. Speaker switching depends on browser support.</p>
    </div>
    <div className="mt-6 grid gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800 sm:grid-cols-2"><label className="text-sm">Outgoing bitrate target<select value={preferences.bitrateMode} onChange={(event) => void update({ bitrateMode: event.target.value as UserPreferences["bitrateMode"] })} className="focus-ring mt-1.5 block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm dark:border-neutral-800"><option value="low">Low · 16 kbps</option><option value="standard">Standard · 32 kbps</option><option value="high">High · 64 kbps</option><option value="custom">Custom</option></select></label>
      {preferences.bitrateMode === "custom" && <Field label="Custom target (6–128 kbps)" type="number" min={6} max={128} value={preferences.bitrateKbps} onChange={(event) => void update({ bitrateKbps: Number(event.target.value) })} />}</div>
  </Card>;
}

function PrivacySettings() {
  const { preferences, updatePreferences } = useCallSession();
  const [error, setError] = useState<string | null>(null);
  async function update(patch: Partial<UserPreferences>) { setError(null); try { await updatePreferences(patch); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save privacy preferences."); } }
  return <Card className="p-5 sm:p-7"><h2 className="text-lg font-semibold">Privacy</h2><p className="mt-1 text-sm text-neutral-500">Call audio is not recorded. Blocking and incoming-call settings are enforced by the server.</p>
    {error && <div className="mt-4"><Notice>{error}</Notice></div>}
    <div className="mt-6">{([["allowIncoming", "Allow incoming calls", "Declined calls are rejected before WebRTC setup."], ["showOnlineStatus", "Show online status", "Controls whether presence may be shared by future public-facing features."]] as const).map(([key, title, detail]) => <label key={key} className="flex items-start justify-between gap-4 border-b border-neutral-100 py-4 last:border-0 dark:border-neutral-900"><span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-neutral-500">{detail}</span></span><input type="checkbox" checked={preferences[key]} onChange={(event) => void update({ [key]: event.target.checked })} /></label>)}</div>
  </Card>;
}

function UsageSettings() {
  const resource = useResource<Usage>("/api/usage");
  const usage = resource.data;
  const platform = useResource<{ available: boolean; month: string; usedBytes: number | null; lastUpdated: string | null }>("/api/admin/usage");
  return <Card className="p-5 sm:p-7"><h2 className="text-lg font-semibold">TURN usage</h2><p className="mt-1 text-sm text-neutral-500">Monthly relay usage from Cloudflare Realtime analytics. Sampled analytics may not equal final billing data.</p>
    {resource.loading ? <p className="mt-6 text-sm text-neutral-500">Loading usage…</p> : resource.error ? <div className="mt-4"><Notice>{resource.error}</Notice></div> : !usage?.available ? <div className="mt-5 rounded-md border border-neutral-200 p-4 text-sm text-neutral-500 dark:border-neutral-800">Usage reporting is not configured or the analytics service returned no data. Calls can still work when TURN credentials are configured.</div> : <>
      <div className="mt-6 grid gap-4 sm:grid-cols-3"><Metric label="Monthly usage" value={formatBytes(usage.usedBytes)} /><Metric label="Quota" value={formatBytes(usage.quotaBytes)} /><Metric label="Remaining" value={formatBytes(usage.remainingBytes)} /></div>
      {usage.percentageUsed != null && <div className="mt-6"><div className="flex justify-between text-xs text-neutral-500"><span>Quota used</span><span>{usage.percentageUsed.toFixed(1)}%</span></div><div className="mt-2 h-2 rounded bg-neutral-100 dark:bg-neutral-900"><div className="h-2 rounded bg-neutral-900 dark:bg-neutral-100" style={{ width: `${Math.max(0, Math.min(100, usage.percentageUsed))}%` }} /></div></div>}
      <dl className="mt-6 grid gap-4 border-t border-neutral-200 pt-5 text-sm dark:border-neutral-800 sm:grid-cols-2"><div><dt className="text-xs text-neutral-500">Month</dt><dd className="mt-1">{usage.month}</dd></div><div><dt className="text-xs text-neutral-500">Last updated</dt><dd className="mt-1">{formatDate(usage.lastUpdated)}</dd></div><div><dt className="text-xs text-neutral-500">Data source</dt><dd className="mt-1">{usage.source}</dd></div><div><dt className="text-xs text-neutral-500">Accounting</dt><dd className="mt-1">{usage.authoritative ? "Authoritative" : "Estimated / sampled"}</dd></div></dl><p className="mt-4 text-xs leading-5 text-neutral-500">{usage.note}</p>
    </>}
    {platform.data?.available && <div className="mt-7 border-t border-neutral-200 pt-5 dark:border-neutral-800"><h3 className="text-sm font-medium">Platform total · authorized administrators</h3><div className="mt-3 grid gap-4 sm:grid-cols-3"><Metric label="Month" value={platform.data.month} /><Metric label="TURN egress" value={formatBytes(platform.data.usedBytes)} /><Metric label="Last updated" value={formatDate(platform.data.lastUpdated)} /></div><p className="mt-3 text-xs text-neutral-500">Aggregate values are sampled estimates, not authoritative billing totals.</p></div>}
  </Card>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800"><p className="text-xs text-neutral-500">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>; }

function AppearanceSettings() {
  const { preferences, updatePreferences } = useCallSession();
  const [error, setError] = useState<string | null>(null);
  async function setTheme(theme: UserPreferences["theme"]) { setError(null); try { await updatePreferences({ theme }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save appearance preference."); } }
  return <Card className="p-5 sm:p-7"><h2 className="text-lg font-semibold">Appearance</h2><p className="mt-1 text-sm text-neutral-500">Choose light, dark, or follow your system preference.</p>{error && <div className="mt-4"><Notice>{error}</Notice></div>}<label className="mt-6 block max-w-sm text-sm">Theme<select value={preferences.theme} onChange={(event) => void setTheme(event.target.value as UserPreferences["theme"])} className="focus-ring mt-1.5 block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 dark:border-neutral-800"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></Card>;
}
