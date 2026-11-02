import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Bell, Check, Mic2, Palette, RefreshCw, Settings2, Shield } from "lucide-react";
import { useCallSession } from "../contexts/CallSession";
import { api, type Me, type Usage, type UserPreferences } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatBytes, formatDate } from "../lib/format";
import { PageHeader } from "../components/common";
import { Button, Card, Empty, Field, Notice } from "../components/ui";

type SectionId = "account" | "audio" | "privacy" | "notifications" | "appearance" | "usage";
const SECTIONS: Array<{ id: SectionId; icon: typeof Settings2 }> = [
  { id: "account", icon: Settings2 }, { id: "audio", icon: Mic2 }, { id: "privacy", icon: Shield },
  { id: "notifications", icon: Bell }, { id: "appearance", icon: Palette }, { id: "usage", icon: BarChart3 },
];

function messageFor(cause: unknown, t: (key: string, options?: Record<string, unknown>) => string, fallback: string) {
  const code = cause instanceof Error ? cause.message : "";
  return t(fallback, { code: code && code.length < 120 ? code : "" });
}

export default function SettingsLayout() {
  const { t } = useTranslation("settings");
  const location = useLocation();
  const active = (location.pathname.split("/")[2] || "account") as SectionId;
  const pages: Record<SectionId, ReactNode> = {
    account: <AccountSettings />, audio: <AudioSettings />, privacy: <PrivacySettings />,
    notifications: <NotificationsSettings />, appearance: <AppearanceSettings />, usage: <UsageSettings />,
  };
  if (!Object.hasOwn(pages, active)) return <Navigate to="/settings/account" replace />;
  return <>
    <PageHeader title={t("title")} detail={t("description")} />
    <div className="grid gap-8 lg:grid-cols-[184px_minmax(0,1fr)]">
      <nav className="overflow-x-auto lg:overflow-visible" aria-label={t("navigationLabel")}>
        <div className="flex min-w-max gap-1 lg:block lg:min-w-0 lg:space-y-0.5">
          {SECTIONS.map(({ id, icon: Icon }) => <Link key={id} to={`/settings/${id}`} aria-current={active === id ? "page" : undefined}
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
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  async function saveDisplayName(event: FormEvent) { event.preventDefault(); setError(null); setNotice(null); try { const user = await api<Me>("/api/me", { method: "PATCH", body: JSON.stringify({ displayName }) }); setMe(user); setNotice(t("account.displayNameSaved")); } catch (cause) { setError(messageFor(cause, t, "errors.profile")); } }
  async function checkAvailability() { setError(null); setAvailability(null); try { const result = await api<{ available: boolean }>(`/api/numbers/availability?number=${encodeURIComponent(number.trim())}`); setAvailability(result.available); } catch (cause) { setError(messageFor(cause, t, "errors.availability")); } }
  async function claimNumber(event: FormEvent) { event.preventDefault(); setError(null); setNotice(null); setBusy(true); try { await api("/api/numbers", { method: "POST", body: JSON.stringify({ number: number.trim() }) }); setMe(await api<Me>("/api/me")); setNotice(t("account.numberSaved")); setAvailability(null); setNumber(""); } catch (cause) { setError(messageFor(cause, t, "errors.claimNumber")); } finally { setBusy(false); } }
  async function upgrade(event: FormEvent) { event.preventDefault(); setError(null); setNotice(null); setBusy(true); try { const user = await api<Me>("/api/auth/upgrade", { method: "POST", body: JSON.stringify({ username, password }) }); setMe(user); setNotice(t("account.upgradeSaved")); setPassword(""); setUsername(""); } catch (cause) { setError(messageFor(cause, t, "errors.upgrade")); } finally { setBusy(false); } }
  return <SectionCard title={t("account.title")} detail={t("account.detail")}>
    {error && <div className="mt-5"><Notice>{error}</Notice></div>}{notice && <div className="mt-5"><Notice tone="success">{notice}</Notice></div>}
    <form onSubmit={(event) => void saveDisplayName(event)} className="mt-6 grid gap-4 sm:grid-cols-2"><Field label={t("account.displayName")} maxLength={80} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><Field label={t("account.username")} value={me.username || t("account.temporary")} readOnly /><div className="sm:col-span-2"><Button type="submit">{t("actions.saveDisplayName")}</Button></div></form>
    <div className="mt-7 border-t border-neutral-200 pt-6 dark:border-neutral-800"><h3 className="font-medium">{t("account.numberTitle")}</h3><p className="mt-1 text-sm text-neutral-500">{t("account.currentNumber")} <span className="font-medium text-neutral-900 dark:text-neutral-100">{me.number || t("account.notClaimed")}</span></p>
      {me.temporary ? <p className="mt-3 text-sm text-neutral-500">{t("account.temporaryNumber")}</p> : <form onSubmit={(event) => void claimNumber(event)} className="mt-4 space-y-3"><Field label={t("account.chooseNumber")} maxLength={32} minLength={3} value={number} onChange={(event) => { setNumber(event.target.value); setAvailability(null); }} placeholder={t("account.numberPlaceholder")} />
        <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="secondary" disabled={number.trim().length < 3} onClick={() => void checkAvailability()}>{t("actions.checkAvailability")}</Button><Button type="submit" disabled={busy || !number.trim() || availability !== true}>{busy ? t("actions.saving") : t("actions.claimNumber")}</Button>{availability === true && <span className="inline-flex items-center gap-1 text-xs text-green-700"><Check size={13} aria-hidden="true" />{t("account.available")}</span>}{availability === false && <span className="text-xs text-red-600">{t("account.unavailable")}</span>}</div><p className="text-xs text-neutral-500">{t("account.numberCooldown")}</p></form>}
    </div>
    {me.temporary && <div className="mt-7 border-t border-neutral-200 pt-6 dark:border-neutral-800"><h3 className="font-medium">{t("account.upgradeTitle")}</h3><p className="mt-1 text-sm text-neutral-500">{t("account.upgradeDetail")}</p><form onSubmit={(event) => void upgrade(event)} className="mt-4 grid gap-3 sm:grid-cols-2"><Field label={t("account.username")} autoComplete="username" minLength={3} maxLength={32} required value={username} onChange={(event) => setUsername(event.target.value)} /><Field label={t("account.password")} type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={(event) => setPassword(event.target.value)} /><div className="sm:col-span-2"><Button disabled={busy}>{t("actions.upgrade")}</Button></div></form>{me.expiresAt && <p className="mt-3 text-xs text-neutral-500">{t("account.expires", { date: formatDate(me.expiresAt, i18n.language) })}</p>}</div>}
  </SectionCard>;
}

function AudioSettings() {
  const { t } = useTranslation("settings"); const { preferences, updatePreferences } = useCallSession(); const [devices, setDevices] = useState<MediaDeviceInfo[]>([]); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  async function refreshDevices() { setError(null); try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); setDevices(await navigator.mediaDevices.enumerateDevices()); } catch (cause) { setError(messageFor(cause, t, "errors.audioAccess")); } }
  async function update(patch: Partial<UserPreferences>) { setError(null); setSaved(false); try { await updatePreferences(patch); setSaved(true); } catch (cause) { setError(messageFor(cause, t, "errors.audioSave")); } }
  const toggles: Array<[keyof Pick<UserPreferences, "echoCancellation" | "noiseSuppression" | "autoGainControl">, string]> = [["echoCancellation", "audio.echoCancellation"], ["noiseSuppression", "audio.noiseSuppression"], ["autoGainControl", "audio.autoGainControl"]];
  return <SectionCard title={t("audio.title")} detail={t("audio.detail")}>{error && <div className="mt-4"><Notice>{error}</Notice></div>}{saved && <div className="mt-4"><Notice tone="success">{t("audio.saved")}</Notice></div>}<div className="mt-6">{toggles.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 border-b border-neutral-100 py-4 text-sm dark:border-neutral-900"><span>{t(label)}</span><input aria-label={t(label)} type="checkbox" checked={preferences[key]} onChange={(event) => void update({ [key]: event.target.checked })} /></label>)}</div>
    <div className="mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">{t("audio.devicesTitle")}</h3><Button variant="secondary" onClick={() => void refreshDevices()}><RefreshCw size={14} aria-hidden="true" />{t("actions.refreshDevices")}</Button></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><SelectField label={t("audio.microphone")} ariaLabel={t("audio.microphone")} value={preferences.audioInputDeviceId} onChange={(value) => void update({ audioInputDeviceId: value })}><option value="">{t("audio.systemDefault")}</option>{devices.filter((device) => device.kind === "audioinput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || t("audio.microphone")}</option>)}</SelectField><SelectField label={t("audio.speaker")} ariaLabel={t("audio.speaker")} value={preferences.audioOutputDeviceId} onChange={(value) => void update({ audioOutputDeviceId: value })}><option value="">{t("audio.systemDefault")}</option>{devices.filter((device) => device.kind === "audiooutput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || t("audio.speaker")}</option>)}</SelectField></div><p className="mt-2 text-xs text-neutral-500">{t("audio.devicesDetail")}</p></div>
    <div className="mt-6 grid gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800 sm:grid-cols-2"><SelectField label={t("audio.bitrate")} ariaLabel={t("audio.bitrate")} value={preferences.bitrateMode} onChange={(value) => void update({ bitrateMode: value as UserPreferences["bitrateMode"] })}><option value="low">{t("audio.low")}</option><option value="standard">{t("audio.standard")}</option><option value="high">{t("audio.high")}</option><option value="custom">{t("audio.custom")}</option></SelectField>{preferences.bitrateMode === "custom" && <Field label={t("audio.customTarget")} type="number" min={6} max={128} value={preferences.bitrateKbps} onChange={(event) => void update({ bitrateKbps: Number(event.target.value) })} />}</div>
  </SectionCard>;
}

function SelectField({ label, ariaLabel, children, ...props }: { label: string; ariaLabel: string; value: string; onChange: (value: string) => void; children: ReactNode }) { return <label className="text-sm"><span className="mb-1.5 block font-medium text-neutral-700 dark:text-neutral-300">{label}</span><select aria-label={ariaLabel} value={props.value} onChange={(event) => props.onChange(event.target.value)} className="focus-ring block w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm dark:border-neutral-800">{children}</select></label>; }

function PrivacySettings() { const { t } = useTranslation("settings"); const { preferences, updatePreferences } = useCallSession(); const [error, setError] = useState<string | null>(null); async function update(patch: Partial<UserPreferences>) { setError(null); try { await updatePreferences(patch); } catch (cause) { setError(messageFor(cause, t, "errors.privacySave")); } } const options: Array<[keyof Pick<UserPreferences, "allowIncoming" | "showOnlineStatus">, string, string]> = [["allowIncoming", "privacy.allowIncoming", "privacy.allowIncomingDetail"], ["showOnlineStatus", "privacy.showOnlineStatus", "privacy.showOnlineStatusDetail"]]; return <SectionCard title={t("privacy.title")} detail={t("privacy.detail")}>{error && <div className="mt-4"><Notice>{error}</Notice></div>}<div className="mt-6">{options.map(([key, title, detail]) => <label key={key} className="flex items-start justify-between gap-4 border-b border-neutral-100 py-4 last:border-0 dark:border-neutral-900"><span><span className="block text-sm font-medium">{t(title)}</span><span className="mt-1 block text-xs leading-5 text-neutral-500">{t(detail)}</span></span><input type="checkbox" aria-label={t(title)} checked={preferences[key]} onChange={(event) => void update({ [key]: event.target.checked })} /></label>)}</div></SectionCard>; }

function NotificationsSettings() { const { t } = useTranslation("settings"); return <SectionCard title={t("notifications.title")} detail={t("notifications.detail")}><div className="mt-6"><Empty title={t("notifications.emptyTitle")} detail={t("notifications.emptyDetail")} /></div></SectionCard>; }

function UsageSettings() { const { t, i18n } = useTranslation("settings"); const resource = useResource<Usage>("/api/usage"), usage = resource.data; const platform = useResource<{ available: boolean; month: string; usedBytes: number | null; lastUpdated: string | null }>("/api/admin/usage"); const bytes = (value: number | null | undefined) => formatBytes(value) === "Unavailable" ? t("usage.unavailableValue") : formatBytes(value); return <SectionCard title={t("usage.title")} detail={t("usage.detail")}>{resource.loading ? <p className="mt-6 text-sm text-neutral-500" role="status">{t("states.loading")}</p> : resource.error ? <div className="mt-4"><Notice>{t("errors.usage", { code: resource.error })}</Notice></div> : !usage?.available ? <div className="mt-5 rounded-md border border-neutral-200 p-4 text-sm leading-6 text-neutral-500 dark:border-neutral-800">{t("usage.unavailable")}</div> : <><div className="mt-6 grid gap-3 sm:grid-cols-3"><Metric label={t("usage.monthly")} value={bytes(usage.usedBytes)} /><Metric label={t("usage.quota")} value={bytes(usage.quotaBytes)} /><Metric label={t("usage.remaining")} value={bytes(usage.remainingBytes)} /></div>{usage.percentageUsed != null && <div className="mt-6"><div className="flex justify-between text-xs text-neutral-500"><span>{t("usage.quotaUsed")}</span><span>{usage.percentageUsed.toFixed(1)}%</span></div><div className="mt-2 h-2 rounded bg-neutral-100 dark:bg-neutral-900"><div className="h-2 rounded bg-neutral-900 dark:bg-neutral-100" style={{ width: `${Math.max(0, Math.min(100, usage.percentageUsed))}%` }} /></div></div>}<dl className="mt-6 grid gap-4 border-t border-neutral-200 pt-5 text-sm dark:border-neutral-800 sm:grid-cols-2"><Data label={t("usage.month")} value={usage.month} /><Data label={t("usage.lastUpdated")} value={formatDate(usage.lastUpdated, i18n.language)} /><Data label={t("usage.source")} value={usage.source} /><Data label={t("usage.accounting")} value={usage.authoritative ? t("usage.authoritative") : t("usage.estimated")} /></dl><p className="mt-4 text-xs leading-5 text-neutral-500">{usage.note}</p>{platform.data?.available && <div className="mt-7 border-t border-neutral-200 pt-5 dark:border-neutral-800"><h3 className="text-sm font-medium">{t("usage.platformTitle")}</h3><div className="mt-3 grid gap-4 sm:grid-cols-3"><Metric label={t("usage.month")} value={platform.data.month} /><Metric label={t("usage.egress")} value={bytes(platform.data.usedBytes)} /><Metric label={t("usage.lastUpdated")} value={formatDate(platform.data.lastUpdated, i18n.language)} /></div><p className="mt-3 text-xs text-neutral-500">{t("usage.platformDetail")}</p></div>}</>}
  </SectionCard>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="border border-neutral-200 p-4 dark:border-neutral-800"><p className="text-xs text-neutral-500">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>; }
function Data({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-neutral-500">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>; }

function AppearanceSettings() { const { t } = useTranslation("settings"); const { preferences, updatePreferences } = useCallSession(); const [error, setError] = useState<string | null>(null); async function setTheme(theme: UserPreferences["theme"]) { setError(null); try { await updatePreferences({ theme }); } catch (cause) { setError(messageFor(cause, t, "errors.appearanceSave")); } } return <SectionCard title={t("appearance.title")} detail={t("appearance.detail")}>{error && <div className="mt-4"><Notice>{error}</Notice></div>}<div className="mt-6 max-w-sm"><SelectField label={t("appearance.theme")} ariaLabel={t("appearance.theme")} value={preferences.theme} onChange={(value) => void setTheme(value as UserPreferences["theme"])}><option value="system">{t("appearance.system")}</option><option value="light">{t("appearance.light")}</option><option value="dark">{t("appearance.dark")}</option></SelectField></div></SectionCard>; }
