import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Copy, PhoneCall, Search, Settings, Users } from "lucide-react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { type Contact, type HistoryItem, type Me, type Usage } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatBytes, formatDate, formatDuration } from "../lib/format";
import { PageHeader, StatusPill } from "../components/common";
import { Button, Card, Notice } from "../components/ui";
import { useCallSession } from "../contexts/CallSession";

const inputClass = "focus-ring w-full rounded-md border border-neutral-200 bg-white py-3 pl-10 pr-3 text-sm outline-none transition placeholder:text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white";

export default function DashboardPage() {
  const { t, i18n } = useTranslation("dashboard");
  const { me } = useOutletContext<{ me: Me; setMe: (user: Me) => void }>();
  const history = useResource<HistoryItem[]>("/api/history?limit=5");
  const contacts = useResource<Contact[]>("/api/contacts");
  const usage = useResource<Usage>("/api/usage");
  const session = useCallSession();
  const navigate = useNavigate();
  const [number, setNumber] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  function quickDial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(`/call?number=${encodeURIComponent(number.trim())}`);
  }

  async function copyOwnNumber() {
    if (!me.number) return;
    setCopyState("idle");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(me.number);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  const hasContacts = Boolean(contacts.data?.length);
  const hasNumber = Boolean(me.number);

  return <div className="pb-8">
    <PageHeader
      eyebrow={t("eyebrow")}
      title={t("title")}
      detail={t("detail")}
      action={<Link to="/call"><Button><PhoneCall size={15} aria-hidden="true" /> {t("actions.openDialer")}</Button></Link>}
    />

    {session.error && <div className="mb-4"><Notice>{t("errors.presence", { detail: session.error })}</Notice></div>}

    <section className="mb-5 grid gap-3 md:grid-cols-[minmax(0,1.45fr)_minmax(16rem,0.75fr)]" aria-label={t("identity.label")}>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">{t("identity.label")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2"><p className="text-2xl font-semibold tracking-tight">{me.number || t("identity.notClaimed")}</p>{me.number && <Button type="button" variant="ghost" className="px-2" onClick={() => void copyOwnNumber()} aria-label={t("identity.copyAria")} title={t("identity.copyAria")}><Copy size={15} aria-hidden="true" /></Button>}</div>
            {!me.number && <Link className="mt-2 inline-block text-sm underline underline-offset-4" to="/settings/account">{t("actions.claimNumber")}</Link>}
            {me.number && copyState === "copied" && <p className="mt-2 text-xs text-neutral-500" role="status" aria-live="polite">{t("identity.copySuccess")}</p>}
            {me.number && copyState === "error" && <p className="mt-2 text-xs text-neutral-500" role="alert">{t("identity.copyError")}</p>}
          </div>
          <StatusPill tone={session.online ? "success" : "neutral"}>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {session.online ? t("identity.connected") : t("identity.offline")}
          </StatusPill>
        </div>
        <p className="mt-4 text-xs text-neutral-500">{session.online ? t("identity.onlineHelp") : t("identity.offlineHelp")}</p>
      </Card>
      <Card className="flex items-center p-5">
        <div>
          <p className="text-sm font-medium">{t("gettingStarted.title")}</p>
          <p className="mt-1 text-sm leading-5 text-neutral-500">{t("gettingStarted.detail")}</p>
        </div>
      </Card>
    </section>

    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
      <Card className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-medium">{t("quickDial.title")}</h2>
            <p className="mt-1 text-sm text-neutral-500">{t("quickDial.detail")}</p>
          </div>
          <PhoneCall size={18} className="shrink-0 text-neutral-400" aria-hidden="true" />
        </div>
        <form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={quickDial}>
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-neutral-400" aria-hidden="true" />
            <input aria-label={t("quickDial.aria")} value={number} onChange={(event) => setNumber(event.target.value)} placeholder={t("quickDial.placeholder")} className={inputClass} />
          </div>
          <Button type="submit" disabled={!number.trim()}><PhoneCall size={15} aria-hidden="true" /> {t("quickDial.submit")}</Button>
        </form>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-medium">{t("gettingStarted.title")}</h2>
        <p className="mt-1 text-sm text-neutral-500">{t("gettingStarted.detail")}</p>
        <div className="mt-4 divide-y divide-neutral-100 dark:divide-neutral-900">
          <div className="flex items-start gap-3 py-3 first:pt-0">
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${hasNumber ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-300 dark:border-neutral-700"}`} aria-hidden="true">{hasNumber && <Check size={12} />}</span>
            <div className="min-w-0 text-sm">
              {hasNumber ? <p>{t("gettingStarted.numberReady")}</p> : <><Link className="underline underline-offset-4" to="/settings/account">{t("gettingStarted.numberNeeded")}</Link><p className="mt-1 text-xs text-neutral-500">{t("gettingStarted.numberNeededDetail")}</p></>}
            </div>
          </div>
          <div className="flex items-start gap-3 py-3">
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${hasContacts ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-300 dark:border-neutral-700"}`} aria-hidden="true">{hasContacts && <Check size={12} />}</span>
            <div className="min-w-0 text-sm">
              {contacts.loading ? <p role="status">{t("gettingStarted.contactsLoading")}</p> : contacts.error ? <p className="text-neutral-500">{t("gettingStarted.contactsUnavailable")}</p> : hasContacts ? <p>{t("gettingStarted.contactsReady")}</p> : <Link className="underline underline-offset-4" to="/contacts">{t("gettingStarted.contactsEmpty")}</Link>}
            </div>
          </div>
          <div className="flex items-start gap-3 py-3 last:pb-0">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-neutral-300 dark:border-neutral-700" aria-hidden="true"><span className="h-1.5 w-1.5 rounded-full bg-current" /></span>
            <div className="min-w-0 text-sm"><p>{session.online ? t("gettingStarted.presenceOnline") : t("gettingStarted.presenceOffline")}</p><p className="mt-1 text-xs text-neutral-500">{t("gettingStarted.presenceDetail")}</p></div>
          </div>
        </div>
      </Card>
    </section>

    <section className="mt-5 grid gap-3 lg:grid-cols-2">
      <Card>
        <div className="flex items-center justify-between border-b border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="font-medium">{t("contacts.title")}</h2>
          <Link to="/contacts" className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white">{t("actions.allContacts")}</Link>
        </div>
        <div className="p-5">
          {contacts.loading ? <p className="py-3 text-sm text-neutral-500" role="status">{t("states.loading")}</p> : contacts.error ? <Notice>{t("errors.loadContacts", { detail: contacts.error })}</Notice> : !hasContacts ? <div className="py-3"><p className="text-sm font-medium">{t("contacts.emptyTitle")}</p><p className="mt-1 text-sm text-neutral-500">{t("contacts.emptyDetail")}</p></div> : <div className="divide-y divide-neutral-100 dark:divide-neutral-900">{contacts.data?.slice(0, 4).map((contact) => <div key={contact.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <Link to={`/contacts/${contact.id}`} className="min-w-0 rounded-sm focus-ring"><p className="truncate text-sm font-medium">{contact.name}</p><p className="mt-0.5 text-xs text-neutral-500">{contact.number}</p></Link>
            <Link to={`/call?number=${encodeURIComponent(contact.number)}`}><Button variant="ghost" className="px-2" aria-label={t("contacts.callAria", { name: contact.name })}><PhoneCall size={15} aria-hidden="true" /></Button></Link>
          </div>)}</div>}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-neutral-200 p-5 dark:border-neutral-800"><h2 className="font-medium">{t("recent.title")}</h2><Link className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white" to="/history">{t("actions.viewHistory")} <ArrowRight size={14} aria-hidden="true" /></Link></div>
        <div className="p-5">
          {history.loading ? <p className="py-3 text-sm text-neutral-500" role="status">{t("states.loading")}</p> : history.error ? <Notice>{t("errors.loadHistory", { detail: history.error })}</Notice> : !history.data?.length ? <div className="py-3"><p className="text-sm font-medium">{t("recent.emptyTitle")}</p><p className="mt-1 text-sm text-neutral-500">{t("recent.emptyDetail")}</p></div> : <div className="divide-y divide-neutral-100 dark:divide-neutral-900">{history.data.map((item) => {
            const participant = item.direction === "outgoing" ? item.recipient : item.caller;
            const direction = item.direction === "incoming" ? t("recent.incoming") : t("recent.outgoing");
            return <div key={item.id} className="flex flex-col justify-between gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"><div><p className="text-sm font-medium">{participant || t("recent.unknownParticipant")}</p><p className="mt-1 text-xs text-neutral-500">{t("recent.meta", { direction, status: item.status, duration: item.durationSeconds ? formatDuration(item.durationSeconds) : "—" })}</p></div><p className="text-xs text-neutral-500">{formatDate(item.startedAt, i18n.language)}</p></div>;
          })}</div>}
        </div>
      </Card>
    </section>

    <section className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm"><span className="font-medium">{t("usage.label", { month: usage.data?.month || (i18n.language === "zh" ? "本月" : "this month") })}</span>{usage.loading ? <span className="ml-2 text-neutral-500" role="status">{t("states.loading")}</span> : usage.error ? <span className="ml-2 text-neutral-500">{t("errors.loadUsage", { detail: usage.error })}</span> : <span className="ml-2 text-neutral-500">{usage.data?.available ? `${formatBytes(usage.data.usedBytes)} ${t("usage.allowance", { quota: formatBytes(usage.data.quotaBytes) })}` : `— ${t("usage.unavailable")}`}</span>}</div>
        <div className="flex flex-wrap gap-2"><Link to="/settings/usage" className="text-sm underline underline-offset-4">{t("actions.usageDetails")}</Link><Link to="/settings/audio"><Button variant="secondary"><Settings size={15} aria-hidden="true" /> {t("actions.audioSettings")}</Button></Link><Link to="/contacts"><Button variant="secondary"><Users size={15} aria-hidden="true" /> {t("actions.browseContacts")}</Button></Link></div>
      </div>
      {usage.data?.available && usage.data.percentageUsed != null && <div className="mt-3 max-w-xl"><div className="h-1.5 rounded bg-neutral-100 dark:bg-neutral-900"><div className="h-1.5 rounded bg-neutral-900 dark:bg-neutral-100" style={{ width: `${Math.min(100, usage.data.percentageUsed)}%` }} /></div><p className="mt-2 text-xs text-neutral-500">{t("usage.used", { percentage: usage.data.percentageUsed.toFixed(1), remaining: formatBytes(usage.data.remainingBytes) })}</p></div>}
      {!usage.loading && !usage.error && usage.data && !usage.data.available && <p className="mt-2 text-xs text-neutral-500">{t("usage.configure")}</p>}
    </section>
  </div>;
}
