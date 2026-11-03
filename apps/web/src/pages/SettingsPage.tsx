import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Bell, Check, Link2, Mic2, Palette, RefreshCw, Settings2, Shield, ShieldCheck } from "lucide-react";
import { useCallSession } from "../contexts/CallSession";
import { useSiteConfiguration } from "../contexts/SiteConfiguration";
import { api, type Me, type SiteConfiguration, type Usage, type UserPreferences } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatBytes, formatDate } from "../lib/format";
import { PageHeader } from "../components/common";
import { Button, Card, Field, Notice } from "../components/ui";

type SectionId = "account" | "audio" | "privacy" | "notifications" | "webhook" | "appearance" | "usage" | "admin";
const SECTIONS: Array<{ id: SectionId; icon: typeof Settings2 }> = [
  { id: "account", icon: Settings2 }, { id: "audio", icon: Mic2 }, { id: "privacy", icon: Shield },
  { id: "notifications", icon: Bell }, { id: "webhook", icon: Link2 }, { id: "appearance", icon: Palette }, { id: "usage", icon: BarChart3 }, { id: "admin", icon: ShieldCheck },
];

function messageFor(cause: unknown, t: (key: string, options?: Record<string, unknown>) => string, fallback: string) {
  const code = cause instanceof Error ? cause.message : "";
  return t(fallback, { code: code && code.length < 120 ? code : "" });
}

export default function SettingsLayout() {
  const { t } = useTranslation("settings");
  const location = useLocation();
  const active = (location.pathname.split("/")[2] || "account") as SectionId;
  const [isAdmin, setIsAdmin] = useState(false), [adminChecked, setAdminChecked] = useState(false);
  useEffect(() => {
    let activeRequest = true;
    void api<{ configuration: SiteConfiguration }>("/api/admin/config").then(() => { if (activeRequest) setIsAdmin(true); })
      .catch(() => { if (activeRequest) setIsAdmin(false); })
      .finally(() => { if (activeRequest) setAdminChecked(true); });
    return () => { activeRequest = false; };
  }, []);
  const pages: Record<SectionId, ReactNode> = {
    account: <AccountSettings />, audio: <AudioSettings />, privacy: <PrivacySettings />,
    notifications: <NotificationsSettings />, webhook: <WebhookSettings />, appearance: <AppearanceSettings />, usage: <UsageSettings />, admin: <AdminSettings />,
  };
  if (!Object.hasOwn(pages, active)) return <Navigate to="/settings/account" replace />;
  if (active === "admin" && adminChecked && !isAdmin) return <Navigate to="/settings/account" replace />;
  if (active === "admin" && !adminChecked) return <div className="py-6 text-sm text-neutral-500" role="status">{t("states.loading")}</div>;
  return <>
    <PageHeader title={t("title")} detail={t("description")} />
    <div className="grid gap-8 lg:grid-cols-[184px_minmax(0,1fr)]">
      <nav className="overflow-x-auto lg:overflow-visible" aria-label={t("navigationLabel")}>
        <div className="flex min-w-max gap-1 lg:block lg:min-w-0 lg:space-y-0.5">
          {SECTIONS.filter(({ id }) => id !== "admin" || isAdmin).map(({ id, icon: Icon }) => <Link key={id} to={`/settings/${id}`} aria-current={active === id ? "page" : undefined}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${active === id ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-900 dark:text-white" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-white"}`}>
            <Icon size={15} strokeWidth={1.8} aria-hidden="true" />{t(`sections.${id}`)}
          </Link>)}
        </div>
      </nav>
      <div className="min-w-0">{pages[active]}</div>
    </div>
  </>;
}

function SectionCard({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return <Card className="p-5 sm:p-7"><h2 className="text-lg font-semibold tracking-tight">{title}</h2><p className="mt-1 text-sm leading-6 text-neutral-500">{detail}</p>{children}</Card>;
}

function AccountSettings() {
  const { t, i18n } = useTranslation("settings");
  const { me, setMe } = useOutletContext<{ me: Me; setMe: (user: Me) => void }>();
  const [displayName, setDisplayName] = useState(me.displayName), [number, setNumber] = useState("");
  const [availability, setAvailability] = useState<boolean | null>(null), [username, setUsername] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [savingDisplayName, setSavingDisplayName] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  async function saveDisplayName(event: FormEvent) { event.preventDefault(); setError(null); setNotice(null); setSavingDisplayName(true); try { const user = await api<Me>("/api/me", { method: "PATCH", body: JSON.stringify({ displayName }) }); setMe(user); setNotice(t("account.displayNameSaved")); } catch (cause) { setError(messageFor(cause, t, "errors.profile")); } finally { setSavingDisplayName(false); } }
  async function checkAvailability() { setError(null); setAvailability(null); try { const result = await api<{ available: boolean }>(`/api/numbers/availability?number=${encodeURIComponent(number.trim())}`); setAvailability(result.available); } catch (cause) { setError(messageFor(cause, t, "errors.availability")); } }
  async function claimNumber(event: FormEvent) { event.preventDefault(); setError(null); setNotice(null); setBusy(true); try { await api("/api/numbers", { method: "POST", body: JSON.stringify({ number: number.trim() }) }); setMe(await api<Me>("/api/me")); setNotice(t("account.numberSaved")); setAvailability(null); setNumber(""); } catch (cause) { setError(messageFor(cause, t, "errors.claimNumber")); } finally { setBusy(false); } }
  async function upgrade(event: FormEvent) { event.preventDefault(); setError(null); setNotice(null); setBusy(true); try { const user = await api<Me>("/api/auth/upgrade", { method: "POST", body: JSON.stringify({ username, password }) }); setMe(user); setNotice(t("account.upgradeSaved")); setPassword(""); setUsername(""); } catch (cause) { setError(messageFor(cause, t, "errors.upgrade")); } finally { setBusy(false); } }
  return <SectionCard title={t("account.title")} detail={t("account.detail")}>
    {error && <div className="mt-5"><Notice>{error}</Notice></div>}{notice && <div className="mt-5"><Notice tone="success">{notice}</Notice></div>}
    <form onSubmit={(event) => void saveDisplayName(event)} className="mt-6 grid gap-4 sm:grid-cols-2"><Field label={t("account.displayName")} maxLength={80} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><Field label={t("account.username")} value={me.username || t("account.temporary")} readOnly /><div className="sm:col-span-2"><Button type="submit" disabled={savingDisplayName}>{savingDisplayName ? t("actions.saving") : t("actions.saveDisplayName")}</Button></div></form>
    <div className="mt-7 border-t border-neutral-200 pt-6 dark:border-neutral-800"><h3 className="font-medium">{t("account.numberTitle")}</h3><p className="mt-1 text-sm text-neutral-500">{t("account.currentNumber")} <span className="font-medium text-neutral-900 dark:text-neutral-100">{me.number || t("account.notClaimed")}</span></p>
      {me.temporary ? <p className="mt-3 text-sm text-neutral-500">{t("account.temporaryNumber")}</p> : <form onSubmit={(event) => void claimNumber(event)} className="mt-4 space-y-3"><Field label={t("account.chooseNumber")} maxLength={32} minLength={3} value={number} onChange={(event) => { setNumber(event.target.value); setAvailability(null); }} placeholder={t("account.numberPlaceholder")} />
        <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="secondary" disabled={number.trim().length < 3} onClick={() => void checkAvailability()}>{t("actions.checkAvailability")}</Button><Button type="submit" disabled={busy || !number.trim() || availability !== true}>{busy ? t("actions.saving") : t("actions.claimNumber")}</Button>{availability === true && <span className="inline-flex items-center gap-1 text-xs text-green-700"><Check size={13} aria-hidden="true" />{t("account.available")}</span>}{availability === false && <span className="text-xs text-red-600">{t("account.unavailable")}</span>}</div><p className="text-xs text-neutral-500">{t("account.numberCooldown")}</p></form>}
    </div>
    {me.temporary && <div className="mt-7 border-t border-neutral-200 pt-6 dark:border-neutral-800"><h3 className="font-medium">{t("account.upgradeTitle")}</h3><p className="mt-1 text-sm text-neutral-500">{t("account.upgradeDetail")}</p><form onSubmit={(event) => void upgrade(event)} className="mt-4 grid gap-3 sm:grid-cols-2"><Field label={t("account.username")} autoComplete="username" minLength={3} maxLength={32} required value={username} onChange={(event) => setUsername(event.target.value)} /><Field label={t("account.password")} type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={(event) => setPassword(event.target.value)} /><div className="sm:col-span-2"><Button disabled={busy}>{t("actions.upgrade")}</Button></div></form>{me.expiresAt && <p className="mt-3 text-xs text-neutral-500">{t("account.expires", { date: formatDate(me.expiresAt, i18n.language) })}</p>}</div>}
  </SectionCard>;
}

function AudioSettings() {
  const { t } = useTranslation("settings"); const { preferences, updatePreferences } = useCallSession(); const site = useSiteConfiguration(); const [devices, setDevices] = useState<MediaDeviceInfo[]>([]); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false); const [saving, setSaving] = useState(false);
  async function refreshDevices() { setError(null); try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); setDevices(await navigator.mediaDevices.enumerateDevices()); } catch (cause) { setError(messageFor(cause, t, "errors.audioAccess")); } }
  async function update(patch: Partial<UserPreferences>) { setError(null); setSaved(false); setSaving(true); try { await updatePreferences(patch); setSaved(true); } catch (cause) { setError(messageFor(cause, t, "errors.audioSave")); } finally { setSaving(false); } }
  const toggles: Array<[keyof Pick<UserPreferences, "echoCancellation" | "noiseSuppression" | "autoGainControl">, string]> = [["echoCancellation", "audio.echoCancellation"], ["noiseSuppression", "audio.noiseSuppression"], ["autoGainControl", "audio.autoGainControl"]];
  return <SectionCard title={t("audio.title")} detail={t("audio.detail")}>{error && <div className="mt-4"><Notice>{error}</Notice></div>}{saved && <div className="mt-4"><Notice tone="success">{t("audio.saved")}</Notice></div>}<div className="mt-6">{toggles.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 border-b border-neutral-100 py-4 text-sm dark:border-neutral-900"><span>{t(label)}</span><input aria-label={t(label)} type="checkbox" checked={preferences[key]} disabled={saving} onChange={(event) => void update({ [key]: event.target.checked })} /></label>)}</div>
  <div className="mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">{t("audio.devicesTitle")}</h3><Button variant="secondary" onClick={() => void refreshDevices()}><RefreshCw size={14} aria-hidden="true" />{t("actions.refreshDevices")}</Button></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><SelectField label={t("audio.microphone")} ariaLabel={t("audio.microphone")} value={preferences.audioInputDeviceId} onChange={(value) => void update({ audioInputDeviceId: value })}><option value="">{t("audio.systemDefault")}</option>{devices.filter((device) => device.kind === "audioinput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || t("audio.microphone")}</option>)}</SelectField><SelectField label={t("audio.speaker")} ariaLabel={t("audio.speaker")} value={preferences.audioOutputDeviceId} onChange={(value) => void update({ audioOutputDeviceId: value })}><option value="">{t("audio.systemDefault")}</option>{devices.filter((device) => device.kind === "audiooutput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || t("audio.speaker")}</option>)}</SelectField></div><p className="mt-2 text-xs text-neutral-500">{t("audio.devicesDetail")}</p></div>
  <div className="mt-6 grid gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800 sm:grid-cols-2"><SelectField label={t("audio.connectionMode")} ariaLabel={t("audio.connectionMode")} value={preferences.connectionMode} disabled={saving} onChange={(value) => void update({ connectionMode: value as UserPreferences["connectionMode"] })}><option value="auto">{t("audio.modeAuto")}</option><option value="p2p">{t("audio.modeP2p")}</option><option value="turn">{t("audio.modeTurn")}</option></SelectField><SelectField label={t("audio.bitrate")} ariaLabel={t("audio.bitrate")} value={preferences.bitrateMode} disabled={saving || !site.usage.allowUserBitrateSettings} onChange={(value) => void update({ bitrateMode: value as UserPreferences["bitrateMode"] })}><option value="low">{t("audio.low")}</option><option value="standard">{t("audio.standard")}</option><option value="high">{t("audio.high")}</option><option value="custom">{t("audio.custom")}</option></SelectField>{preferences.bitrateMode === "custom" && site.usage.allowUserBitrateSettings && <Field label={t("audio.customTarget")} type="number" min={6} max={128} disabled={saving} value={preferences.bitrateKbps} onChange={(event) => void update({ bitrateKbps: Number(event.target.value) })} />}</div><p className="mt-3 text-xs leading-5 text-neutral-500">{t("audio.modeDetail")}</p>{!site.usage.allowUserBitrateSettings && <p className="mt-2 text-xs leading-5 text-neutral-500">{t("audio.bitrateDisabled")}</p>}
  </SectionCard>;
}

function SelectField({ label, ariaLabel, children, ...props }: { label: string; ariaLabel: string; value: string; disabled?: boolean; onChange: (value: string) => void; children: ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-700 dark:text-neutral-300">{label}</span><select aria-label={ariaLabel} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)} className="focus-ring block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800">{children}</select></label>; }

function PrivacySettings() { const { t } = useTranslation("settings"); const { preferences, updatePreferences } = useCallSession(); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); async function update(patch: Partial<UserPreferences>) { setError(null); setSaving(true); try { await updatePreferences(patch); } catch (cause) { setError(messageFor(cause, t, "errors.privacySave")); } finally { setSaving(false); } } const options: Array<[keyof Pick<UserPreferences, "allowIncoming" | "showOnlineStatus">, string, string]> = [["allowIncoming", "privacy.allowIncoming", "privacy.allowIncomingDetail"], ["showOnlineStatus", "privacy.showOnlineStatus", "privacy.showOnlineStatusDetail"]]; return <SectionCard title={t("privacy.title")} detail={t("privacy.detail")}>{error && <div className="mt-4"><Notice>{error}</Notice></div>}<div className="mt-6">{options.map(([key, title, detail]) => <label key={key} className="flex items-start justify-between gap-4 border-b border-neutral-100 py-4 last:border-0 dark:border-neutral-900"><span><span className="block text-sm font-medium">{t(title)}</span><span className="mt-1 block text-xs leading-5 text-neutral-500">{t(detail)}</span></span><input type="checkbox" aria-label={t(title)} checked={preferences[key]} disabled={saving} onChange={(event) => void update({ [key]: event.target.checked })} /></label>)}</div></SectionCard>; }

function WebhookSettings() {
  const { t } = useTranslation("settings");
  const [url, setUrl] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { void api<{ configured: boolean }>("/api/settings/webhook").then((result) => setConfigured(result.configured)).catch((cause) => setError(messageFor(cause, t, "errors.webhook"))).finally(() => setLoading(false)); }, [t]);
  async function save(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null);
    try { const parsed = new URL(url.trim()); if (parsed.protocol !== "https:") throw new Error(t("webhook.httpsRequired"));
      setBusy(true); const result = await api<{ configured: boolean }>("/api/settings/webhook", { method: "PUT", body: JSON.stringify({ url: url.trim() }) });
      setConfigured(result.configured); setUrl(""); setNotice(t("webhook.saved"));
    } catch (cause) { setError(messageFor(cause, t, "errors.webhook")); } finally { setBusy(false); }
  }
  async function remove() { if (!window.confirm(t("webhook.confirmRemove"))) return; setError(null); setNotice(null); setBusy(true); try { const result = await api<{ configured: boolean }>("/api/settings/webhook", { method: "DELETE" }); setConfigured(result.configured); setNotice(t("webhook.removed")); } catch (cause) { setError(messageFor(cause, t, "errors.webhook")); } finally { setBusy(false); } }
  return <SectionCard title={t("webhook.title")} detail={t("webhook.detail")}>
    {error && <div className="mt-4"><Notice>{error}</Notice></div>}{notice && <div className="mt-4"><Notice tone="success">{notice}</Notice></div>}
    <div className="mt-5 rounded-md border border-neutral-200 p-4 text-sm leading-6 text-neutral-500 dark:border-neutral-800"><p>{t("webhook.privacy")}</p><p className="mt-2">{t("webhook.events")}</p><p className="mt-2">{t("webhook.cost")}</p></div>
    {loading ? <p className="mt-5 text-sm text-neutral-500" role="status">{t("states.loading")}</p> : error && !configured ? <div className="mt-5 space-y-3"><Notice>{error}</Notice><Button variant="secondary" onClick={() => { setLoading(true); setError(null); void api<{ configured: boolean }>("/api/settings/webhook").then((result) => setConfigured(result.configured)).catch((cause) => setError(messageFor(cause, t, "errors.webhook"))).finally(() => setLoading(false)); }}>{t("actions.retry")}</Button></div> : <>
      {configured && <div className="mt-5 flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-4 py-3 text-sm dark:bg-neutral-900"><span>{t("webhook.configured")}</span><Button variant="secondary" disabled={busy} onClick={() => void remove()}>{t("webhook.remove")}</Button></div>}
      <form onSubmit={(event) => void save(event)} className="mt-5 space-y-3"><Field label={t("webhook.url")} type="url" inputMode="url" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} autoComplete="off" aria-describedby="webhook-help" required /><p id="webhook-help" className="text-xs text-neutral-500">{t("webhook.replaceDetail")}</p><Button disabled={busy || !url.trim()}>{busy ? t("actions.saving") : configured ? t("webhook.replace") : t("webhook.save")}</Button></form>
    </>}
  </SectionCard>;
}
function NotificationsSettings() {
  const { t } = useTranslation("settings");
  const { browserSettings, updateBrowserSettings } = useCallSession();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function toggleMissedCallNotifications(enabled: boolean) {
    setError(null);
    if (!enabled) {
      updateBrowserSettings({ missedCallNotifications: false });
      return;
    }
    setSaving(true);
    try {
      if (typeof Notification === "undefined") {
        setError(t("notifications.unsupported"));
        return;
      }
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        setError(t("notifications.permissionDenied"));
        return;
      }
      updateBrowserSettings({ missedCallNotifications: true });
    } catch {
      setError(t("notifications.permissionDenied"));
    } finally {
      setSaving(false);
    }
  }

  return <SectionCard title={t("notifications.title")} detail={t("notifications.detail")}>
    {error && <div className="mt-4"><Notice>{error}</Notice></div>}
    <div className="mt-6">
      <label className="flex items-start justify-between gap-4 border-b border-neutral-100 py-4 dark:border-neutral-900">
        <span><span className="block text-sm font-medium">{t("notifications.doNotDisturb")}</span><span className="mt-1 block text-xs leading-5 text-neutral-500">{t("notifications.doNotDisturbDetail")}</span></span>
        <input type="checkbox" aria-label={t("notifications.doNotDisturb")} checked={browserSettings.doNotDisturb} onChange={(event) => updateBrowserSettings({ doNotDisturb: event.target.checked })} />
      </label>
      <label className="flex items-start justify-between gap-4 py-4">
        <span><span className="block text-sm font-medium">{t("notifications.missedCalls")}</span><span className="mt-1 block text-xs leading-5 text-neutral-500">{t("notifications.missedCallsDetail")}</span></span>
        <input type="checkbox" aria-label={t("notifications.missedCalls")} checked={browserSettings.missedCallNotifications} disabled={saving} onChange={(event) => void toggleMissedCallNotifications(event.target.checked)} />
      </label>
    </div>
  </SectionCard>;
}

function UsageSettings() { const { t, i18n } = useTranslation("settings"); const resource = useResource<Usage>("/api/usage"), usage = resource.data; const platform = useResource<{ available: boolean; month: string; usedBytes: number | null; lastUpdated: string | null }>("/api/admin/usage"); const bytes = (value: number | null | undefined) => formatBytes(value) === "Unavailable" ? t("usage.unavailableValue") : formatBytes(value); const source = (value: string) => t(`usage.sources.${value}`, { defaultValue: t("usage.sources.unknown") }); const note = (value: string) => t(`usage.notes.${value}`, { defaultValue: value }); return <SectionCard title={t("usage.title")} detail={t("usage.detail")}>{resource.loading ? <p className="mt-6 text-sm text-neutral-500" role="status">{t("states.loading")}</p> : resource.error ? <div className="mt-4 space-y-3"><Notice>{t("errors.usage", { code: resource.error })}</Notice><Button variant="secondary" onClick={() => resource.refresh()}>{t("actions.retry")}</Button></div> : !usage?.available ? <div className="mt-5 rounded-md border border-neutral-200 p-4 text-sm leading-6 text-neutral-500 dark:border-neutral-800">{t("usage.unavailable")}</div> : <><div className="mt-6 grid gap-3 sm:grid-cols-3"><Metric label={t("usage.monthly")} value={bytes(usage.usedBytes)} /><Metric label={t("usage.quota")} value={bytes(usage.quotaBytes)} /><Metric label={t("usage.remaining")} value={bytes(usage.remainingBytes)} /></div>{usage.percentageUsed != null && <div className="mt-6"><div className="flex justify-between text-xs text-neutral-500"><span>{t("usage.quotaUsed")}</span><span>{usage.percentageUsed.toFixed(1)}%</span></div><div className="mt-2 h-2 rounded bg-neutral-100 dark:bg-neutral-900"><div className="h-2 rounded bg-neutral-900 dark:bg-neutral-100" style={{ width: `${Math.max(0, Math.min(100, usage.percentageUsed))}%` }} /></div></div>}<dl className="mt-6 grid gap-4 border-t border-neutral-200 pt-5 text-sm dark:border-neutral-800 sm:grid-cols-2"><Data label={t("usage.month")} value={usage.month} /><Data label={t("usage.lastUpdated")} value={formatDate(usage.lastUpdated, i18n.language)} /><Data label={t("usage.source")} value={source(usage.source)} /><Data label={t("usage.accounting")} value={usage.authoritative ? t("usage.authoritative") : t("usage.estimated")} /></dl><p className="mt-4 text-xs leading-5 text-neutral-500">{note(usage.note)}</p>{platform.data?.available && <div className="mt-7 border-t border-neutral-200 pt-5 dark:border-neutral-800"><h3 className="text-sm font-medium">{t("usage.platformTitle")}</h3><div className="mt-3 grid gap-4 sm:grid-cols-3"><Metric label={t("usage.month")} value={platform.data.month} /><Metric label={t("usage.egress")} value={bytes(platform.data.usedBytes)} /><Metric label={t("usage.lastUpdated")} value={formatDate(platform.data.lastUpdated, i18n.language)} /></div><p className="mt-3 text-xs text-neutral-500">{t("usage.platformDetail")}</p></div>}</>}
  </SectionCard>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="border border-neutral-200 p-4 dark:border-neutral-800"><p className="text-xs text-neutral-500">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>; }
function Data({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-neutral-500">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>; }

function AppearanceSettings() { const { t } = useTranslation("settings"); const { preferences, updatePreferences } = useCallSession(); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); async function setTheme(theme: UserPreferences["theme"]) { setError(null); setSaving(true); try { await updatePreferences({ theme }); } catch (cause) { setError(messageFor(cause, t, "errors.appearanceSave")); } finally { setSaving(false); } } return <SectionCard title={t("appearance.title")} detail={t("appearance.detail")}>{error && <div className="mt-4"><Notice>{error}</Notice></div>}<div className="mt-6 max-w-sm"><SelectField label={t("appearance.theme")} ariaLabel={t("appearance.theme")} value={preferences.theme} disabled={saving} onChange={(value) => void setTheme(value as UserPreferences["theme"])}><option value="system">{t("appearance.system")}</option><option value="light">{t("appearance.light")}</option><option value="dark">{t("appearance.dark")}</option></SelectField></div></SectionCard>; }

type AdminUsageSummary = {
  available: boolean; month: string; usedBytes: number | null; lastUpdated: string | null;
  temporaryAccounts: { available: boolean; month: string; activeUsers: number; sampledUsers: number; usedBytes: number | null; monthlyBudgetBytes: number | null; remainingBudgetBytes: number | null; lastUpdated: string | null; note: string };
};

type ManagedUser = { id: string; username: string | null; displayName: string; temporary: boolean; monthlyTurnLimitBytesOverride: number | null };
type ManagedUsersResult = { users: ManagedUser[]; nextCursor: string | null; totalUsers: number; temporaryUsers: number; permanentUsers: number };

async function loadManagedUsers(): Promise<ManagedUsersResult> {
  const users: ManagedUser[] = [];
  let cursor: string | null = null;
  let summary: Omit<ManagedUsersResult, "users" | "nextCursor"> | undefined;
  do {
    const query = new URLSearchParams({ limit: "250" });
    if (cursor) query.set("after", cursor);
    const page = await api<ManagedUsersResult>(`/api/admin/users?${query.toString()}`);
    users.push(...page.users);
    summary = { totalUsers: page.totalUsers, temporaryUsers: page.temporaryUsers, permanentUsers: page.permanentUsers };
    if (page.nextCursor && page.nextCursor === cursor) throw new Error("User list pagination did not advance.");
    cursor = page.nextCursor;
  } while (cursor);
  if (!summary) throw new Error("The user list response did not contain a summary.");
  return { users, nextCursor: null, ...summary };
}

function AdminSettings() {
  const { t, i18n } = useTranslation("settings");
  const [configuration, setConfiguration] = useState<SiteConfiguration | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [userCounts, setUserCounts] = useState({ totalUsers: 0, temporaryUsers: 0, permanentUsers: 0 });
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [individualLimitGb, setIndividualLimitGb] = useState("");
  const [batchScope, setBatchScope] = useState<"all" | "temporary">("all");
  const [batchLimitGb, setBatchLimitGb] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [userActionBusy, setUserActionBusy] = useState(false);
  const usage = useResource<AdminUsageSummary>("/api/admin/usage");
  useEffect(() => {
    let active = true;
    void Promise.all([api<{ configuration: SiteConfiguration }>("/api/admin/config"), loadManagedUsers()])
      .then(([result, userResult]) => {
        if (!active) return;
        setConfiguration(result.configuration);
        setManagedUsers(userResult.users);
        setUserCounts({ totalUsers: userResult.totalUsers, temporaryUsers: userResult.temporaryUsers, permanentUsers: userResult.permanentUsers });
        setSelectedUserId((current) => current || userResult.users[0]?.id || "");
      })
      .catch((cause) => { if (active) setError(messageFor(cause, t, "errors.admin")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);

  const selectedUser = managedUsers.find((user) => user.id === selectedUserId) ?? null;
  const filteredUsers = managedUsers.filter((user) => `${user.displayName} ${user.username ?? ""} ${user.id}`.toLowerCase().includes(userSearch.trim().toLowerCase()));
  useEffect(() => {
    setIndividualLimitGb(selectedUser?.monthlyTurnLimitBytesOverride == null ? "" : String(selectedUser.monthlyTurnLimitBytesOverride / 1_000_000_000));
  }, [selectedUser]);

  function update(section: keyof SiteConfiguration, key: string, value: unknown) {
    setConfiguration((current) => current ? { ...current, [section]: { ...current[section], [key]: value } } as SiteConfiguration : current);
  }
  function setGb(section: "usage" | "temporaryAccounts", key: string, value: string) {
    const bytes = value.trim() === "" ? null : Math.round(Number(value) * 1_000_000_000);
    update(section, key, bytes);
  }
  function parseGb(value: string): number | null | undefined {
    if (value.trim() === "") return null;
    const gb = Number(value);
    if (!Number.isFinite(gb) || gb < 0 || gb > 1_000_000) return undefined;
    const bytes = Math.round(gb * 1_000_000_000);
    return Number.isSafeInteger(bytes) ? bytes : undefined;
  }
  async function refreshManagedUsers() {
    const result = await loadManagedUsers();
    setManagedUsers(result.users);
    setUserCounts({ totalUsers: result.totalUsers, temporaryUsers: result.temporaryUsers, permanentUsers: result.permanentUsers });
  }
  async function saveIndividualLimit() {
    if (!selectedUser) return;
    const bytes = parseGb(individualLimitGb);
    if (bytes === undefined) { setError(t("admin.invalidLimit")); return; }
    setError(null); setNotice(null); setUserActionBusy(true);
    try {
      await api(`/api/admin/users/${encodeURIComponent(selectedUser.id)}/turn-limit`, { method: "PATCH", body: JSON.stringify({ monthlyTurnLimitBytes: bytes }) });
      await refreshManagedUsers();
      setNotice(t("admin.userLimitSaved"));
    } catch (cause) { setError(messageFor(cause, t, "errors.admin")); }
    finally { setUserActionBusy(false); }
  }
  async function applyBatchLimit() {
    const bytes = parseGb(batchLimitGb);
    if (bytes === undefined) { setError(t("admin.invalidLimit")); return; }
    const expectedCount = batchScope === "all" ? userCounts.totalUsers : userCounts.temporaryUsers;
    const scopeLabel = t(batchScope === "all" ? "admin.allUsers" : "admin.temporaryUsersOnly");
    const quotaLabel = bytes === null ? t("admin.inheritDefault") : bytes === 0 ? t("admin.unlimited") : t("admin.gbValue", { value: (bytes / 1_000_000_000).toFixed(1) });
    if (!window.confirm(t("admin.confirmBatchLimit", { count: expectedCount, scope: scopeLabel, quota: quotaLabel }))) return;
    setError(null); setNotice(null); setUserActionBusy(true);
    try {
      const result = await api<{ affectedCount: number }>("/api/admin/users/batch-turn-limit", { method: "POST", body: JSON.stringify({ scope: batchScope, monthlyTurnLimitBytes: bytes, expectedCount }) });
      await refreshManagedUsers();
      setNotice(t("admin.batchLimitApplied", { count: result.affectedCount }));
    } catch (cause) { setError(messageFor(cause, t, "errors.admin")); }
    finally { setUserActionBusy(false); }
  }
  async function resetSelectedPassword(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser || newPassword.length < 12 || newPassword.length > 200) return;
    if (!window.confirm(t("admin.confirmPasswordReset", { user: selectedUser.displayName || selectedUser.username || selectedUser.id }))) return;
    setError(null); setNotice(null); setUserActionBusy(true);
    try {
      await api(`/api/admin/users/${encodeURIComponent(selectedUser.id)}/password`, { method: "POST", body: JSON.stringify({ newPassword }) });
      setNewPassword("");
      setNotice(t("admin.passwordResetDone"));
    } catch (cause) { setError(messageFor(cause, t, "errors.admin")); }
    finally { setUserActionBusy(false); }
  }
  async function exportConfigurations() {
    setError(null); setNotice(null); setUserActionBusy(true);
    try {
      const data = await api<Record<string, unknown>>("/api/admin/users/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href; anchor.download = "sparkcall-user-config-export.json"; anchor.click();
      URL.revokeObjectURL(href);
      setNotice(t("admin.exportDone"));
    } catch (cause) { setError(messageFor(cause, t, "errors.admin")); }
    finally { setUserActionBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!configuration) return;
    setError(null); setNotice(null); setSaving(true);
    try {
      const result = await api<{ configuration: SiteConfiguration }>("/api/admin/config", { method: "PATCH", body: JSON.stringify({ configuration }) });
      setConfiguration(result.configuration); setNotice(t("admin.saved"));
    } catch (cause) { setError(messageFor(cause, t, "errors.admin")); }
    finally { setSaving(false); }
  }
  async function reset() {
    if (!window.confirm(t("admin.confirmReset"))) return;
    setError(null); setNotice(null); setSaving(true);
    try {
      const result = await api<{ configuration: SiteConfiguration }>("/api/admin/config", { method: "DELETE" });
      setConfiguration(result.configuration); setNotice(t("admin.resetDone"));
    } catch (cause) { setError(messageFor(cause, t, "errors.admin")); }
    finally { setSaving(false); }
  }
  const bytes = (value: number | null | undefined) => value == null ? t("usage.unavailableValue") : formatBytes(value);
  if (loading) return <SectionCard title={t("admin.title")} detail={t("admin.detail")}><p className="mt-6 text-sm text-neutral-500" role="status">{t("states.loading")}</p></SectionCard>;
  if (!configuration) return <SectionCard title={t("admin.title")} detail={t("admin.detail")}><div className="mt-4"><Notice>{error || t("admin.loadError", { detail: "" })}</Notice></div></SectionCard>;

  return <div className="space-y-5">
    {error && <Notice>{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    <form onSubmit={(event) => void save(event)} className="space-y-5">
      <SectionCard title={t("admin.title")} detail={t("admin.detail")}>
        <p className="mt-4 rounded-md border border-neutral-200 p-3 text-xs leading-5 text-neutral-500 dark:border-neutral-800">{t("admin.authorization")}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <AdminTextField label={t("admin.productName")} value={configuration.branding.productName} maxLength={60} disabled={saving} onChange={(value) => update("branding", "productName", value)} />
          <AdminTextField label={t("admin.logoUrl")} value={configuration.branding.logoUrl} maxLength={500} disabled={saving} onChange={(value) => update("branding", "logoUrl", value)} />
          <p className="-mt-2 text-xs leading-5 text-neutral-500 sm:col-span-2">{t("admin.logoHint")}</p>
          <AdminTextField label={t("admin.footerBadge")} value={configuration.branding.footerBadge} maxLength={100} disabled={saving} onChange={(value) => update("branding", "footerBadge", value)} />
          <AdminTextField label={t("admin.footerLicense")} value={configuration.branding.footerLicense} maxLength={140} disabled={saving} onChange={(value) => update("branding", "footerLicense", value)} />
        </div>
      </SectionCard>

      <SectionCard title={t("admin.usageTitle")} detail={t("admin.showPublicAggregateDetail")}>
        <AdminToggle label={t("admin.showPublicAggregate")} checked={configuration.usage.showPublicAggregate} disabled={saving} onChange={(value) => update("usage", "showPublicAggregate", value)} />
        <AdminToggle label={t("admin.allowUserBitrateSettings")} checked={configuration.usage.allowUserBitrateSettings} disabled={saving} onChange={(value) => update("usage", "allowUserBitrateSettings", value)} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <AdminNumberField label={t("admin.minimumAggregateUsers")} value={configuration.usage.minimumAggregateUsers} min={5} max={100} step={1} disabled={saving} onChange={(value) => { if (value !== "") update("usage", "minimumAggregateUsers", value); }} />
          <AdminNumberField label={t("admin.monthlyUserQuotaGb")} value={configuration.usage.monthlyUserQuotaBytes === null ? "" : configuration.usage.monthlyUserQuotaBytes / 1_000_000_000} min={0} step={0.1} disabled={saving} onChange={(value) => setGb("usage", "monthlyUserQuotaBytes", String(value))} />
          <AdminNumberField label={t("admin.monthlyTurnLimitGb")} value={configuration.usage.monthlyTurnLimitBytes === null ? "" : configuration.usage.monthlyTurnLimitBytes / 1_000_000_000} min={0} step={0.1} disabled={saving} onChange={(value) => setGb("usage", "monthlyTurnLimitBytes", String(value))} />
        </div>
        <p className="mt-2 text-xs leading-5 text-neutral-500">{t("admin.monthlyUserQuotaDetail")}</p>
        <p className="mt-2 text-xs leading-5 text-neutral-500">{t("admin.monthlyTurnLimitDetail")}</p>
      </SectionCard>

      <SectionCard title={t("admin.temporaryTitle")} detail={t("admin.temporaryDetail")}>
        <AdminToggle label={t("admin.enableTemporary")} checked={configuration.temporaryAccounts.enabled} disabled={saving} onChange={(value) => update("temporaryAccounts", "enabled", value)} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <AdminNumberField label={t("admin.lifetimeHours")} value={configuration.temporaryAccounts.lifetimeHours} min={1} max={168} step={1} disabled={saving} onChange={(value) => { if (value !== "") update("temporaryAccounts", "lifetimeHours", value); }} />
          <AdminNumberField label={t("admin.maxActiveAccounts")} value={configuration.temporaryAccounts.maxActiveAccounts} min={0} max={100000} step={1} disabled={saving} onChange={(value) => { if (value !== "") update("temporaryAccounts", "maxActiveAccounts", value); }} />
          <AdminNumberField label={t("admin.perIpCreationLimit")} value={configuration.temporaryAccounts.perIpCreationLimit} min={0} max={50} step={1} disabled={saving} onChange={(value) => { if (value !== "") update("temporaryAccounts", "perIpCreationLimit", value); }} />
          <AdminNumberField label={t("admin.perIpWindowMinutes")} value={configuration.temporaryAccounts.perIpWindowMinutes} min={1} max={1440} step={1} disabled={saving} onChange={(value) => { if (value !== "") update("temporaryAccounts", "perIpWindowMinutes", value); }} />
          <AdminNumberField label={t("admin.tempMonthlyQuotaGb")} value={configuration.temporaryAccounts.monthlyTurnQuotaBytes === null ? "" : configuration.temporaryAccounts.monthlyTurnQuotaBytes / 1_000_000_000} min={0} step={0.1} disabled={saving} onChange={(value) => setGb("temporaryAccounts", "monthlyTurnQuotaBytes", String(value))} />
          <AdminNumberField label={t("admin.tempMonthlyLimitGb")} value={configuration.temporaryAccounts.monthlyTurnLimitBytes === null ? "" : configuration.temporaryAccounts.monthlyTurnLimitBytes / 1_000_000_000} min={0} step={0.1} disabled={saving} onChange={(value) => setGb("temporaryAccounts", "monthlyTurnLimitBytes", String(value))} />
          <AdminNumberField label={t("admin.monthlyAggregateBudgetGb")} value={configuration.temporaryAccounts.monthlyAggregateBudgetBytes === null ? "" : configuration.temporaryAccounts.monthlyAggregateBudgetBytes / 1_000_000_000} min={0} step={0.1} disabled={saving} onChange={(value) => setGb("temporaryAccounts", "monthlyAggregateBudgetBytes", String(value))} />
        </div>
        <p className="mt-2 text-xs leading-5 text-neutral-500">{t("admin.tempQuotaDetail")}</p>
        <p className="mt-2 text-xs leading-5 text-neutral-500">{t("admin.aggregateBudgetDetail")}</p>
        <p className="mt-4 rounded-md border border-neutral-200 p-3 text-xs leading-5 text-neutral-500 dark:border-neutral-800">{t("admin.capacityWarning")}</p>
      </SectionCard>

      <div className="flex flex-wrap gap-2"><Button disabled={saving}>{saving ? t("actions.saving") : t("admin.save")}</Button><Button type="button" variant="secondary" disabled={saving} onClick={() => void reset()}>{t("admin.reset")}</Button></div>
    </form>

    <SectionCard title={t("admin.userManagementTitle")} detail={t("admin.userManagementDetail")}>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.userSearch")} value={userSearch} onChange={(event) => setUserSearch(event.target.value)} />
        <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-700 dark:text-neutral-300">{t("admin.userTarget")}</span><select aria-label={t("admin.userTarget")} value={selectedUserId} disabled={userActionBusy || filteredUsers.length === 0} onChange={(event) => setSelectedUserId(event.target.value)} className="focus-ring block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-800">{filteredUsers.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.username || user.id} · {user.temporary ? t("admin.userKindTemporary") : t("admin.userKindPermanent")}</option>)}</select></label>
      </div>
      {filteredUsers.length === 0 && <p className="mt-3 text-sm text-neutral-500">{t("admin.noUsers")}</p>}
      {selectedUser && <div className="mt-5 grid gap-4 sm:grid-cols-2"><AdminNumberField label={t("admin.individualLimitGb")} value={individualLimitGb} min={0} step={0.1} disabled={userActionBusy} onChange={(value) => setIndividualLimitGb(String(value))} /><div className="flex items-end"><Button type="button" variant="secondary" disabled={userActionBusy} onClick={() => void saveIndividualLimit()}>{t("admin.saveUserLimit")}</Button></div></div>}
      <div className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800"><h3 className="text-sm font-medium">{t("admin.batchScope")}</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><SelectField label={t("admin.batchScope")} ariaLabel={t("admin.batchScope")} value={batchScope} disabled={userActionBusy} onChange={(value) => setBatchScope(value as "all" | "temporary")}><option value="all">{t("admin.allUsers")}</option><option value="temporary">{t("admin.temporaryUsersOnly")}</option></SelectField><AdminNumberField label={t("admin.batchLimitGb")} value={batchLimitGb} min={0} step={0.1} disabled={userActionBusy} onChange={(value) => setBatchLimitGb(String(value))} /></div><p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{t("admin.batchPreview", { scope: t(batchScope === "all" ? "admin.allUsers" : "admin.temporaryUsersOnly"), count: batchScope === "all" ? userCounts.totalUsers : userCounts.temporaryUsers, quota: parseGb(batchLimitGb) === null ? t("admin.inheritDefault") : parseGb(batchLimitGb) === 0 ? t("admin.unlimited") : `${batchLimitGb} GB` })}</p><div className="mt-3"><Button type="button" variant="secondary" disabled={userActionBusy} onClick={() => void applyBatchLimit()}>{t("admin.applyBatch")}</Button></div></div>
      {selectedUser && <form onSubmit={(event) => void resetSelectedPassword(event)} className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800"><h3 className="text-sm font-medium">{t("admin.passwordResetTitle")}</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label={t("admin.newPassword")} type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={newPassword} disabled={userActionBusy} onChange={(event) => setNewPassword(event.target.value)} /><div className="flex items-end"><Button type="submit" variant="secondary" disabled={userActionBusy || newPassword.length < 12}>{t("admin.resetPassword")}</Button></div></div></form>}
      <div className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800"><h3 className="text-sm font-medium">{t("admin.exportTitle")}</h3><p className="mt-1 text-xs leading-5 text-neutral-500">{t("admin.exportDetail")}</p><div className="mt-3"><Button type="button" variant="secondary" disabled={userActionBusy} onClick={() => void exportConfigurations()}>{t("admin.exportButton")}</Button></div></div>
    </SectionCard>

    <SectionCard title={t("admin.usageSummaryTitle")} detail={t("admin.platformDetail")}>
      {usage.loading ? <p className="mt-5 text-sm text-neutral-500" role="status">{t("states.loading")}</p> : usage.error ? <div className="mt-4"><Notice>{t("admin.loadError", { detail: usage.error })}</Notice></div> : usage.data && <div className="mt-5 space-y-6">
        <div><h3 className="text-sm font-medium">{t("admin.platformTitle")}</h3>{usage.data.available ? <div className="mt-3 grid gap-3 sm:grid-cols-3"><Metric label={t("usage.month")} value={usage.data.month} /><Metric label={t("usage.egress")} value={bytes(usage.data.usedBytes)} /><Metric label={t("usage.lastUpdated")} value={formatDate(usage.data.lastUpdated, i18n.language)} /></div> : <p className="mt-2 text-sm text-neutral-500">{t("admin.dataUnavailable")}</p>}</div>
        <div className="border-t border-neutral-200 pt-5 dark:border-neutral-800"><h3 className="text-sm font-medium">{t("usage.temporaryTotal")}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label={t("usage.month")} value={usage.data.temporaryAccounts.month} /><Metric label={t("usage.activeTemporary")} value={String(usage.data.temporaryAccounts.activeUsers)} /><Metric label={t("usage.sampledTemporary")} value={String(usage.data.temporaryAccounts.sampledUsers)} /><Metric label={t("usage.temporaryUsed")} value={bytes(usage.data.temporaryAccounts.usedBytes)} /><Metric label={t("usage.temporaryBudget")} value={usage.data.temporaryAccounts.monthlyBudgetBytes ? bytes(usage.data.temporaryAccounts.monthlyBudgetBytes) : t("admin.budgetNoLimit")} /></div><p className="mt-3 text-xs leading-5 text-neutral-500">{usage.data.temporaryAccounts.note}</p></div>
      </div>}
    </SectionCard>
  </div>;
}

function AdminTextField({ label, value, maxLength, disabled, onChange }: { label: string; value: string; maxLength: number; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-700 dark:text-neutral-300">{label}</span><input type="text" value={value} maxLength={maxLength} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="focus-ring block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-800" /></label>;
}

function AdminNumberField({ label, value, min, max, step, disabled, onChange }: { label: string; value: number | string; min: number; max?: number; step: number; disabled: boolean; onChange: (value: number | string) => void }) {
  return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-700 dark:text-neutral-300">{label}</span><input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} className="focus-ring block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-800" /></label>;
}

function AdminToggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center justify-between gap-4 border-b border-neutral-100 py-4 text-sm dark:border-neutral-900"><span className="font-medium">{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /></label>;
}
