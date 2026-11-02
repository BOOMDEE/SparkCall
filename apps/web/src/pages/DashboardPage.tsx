import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { ArrowRight, PhoneCall, Search, Settings, Users } from "lucide-react";
import { type Contact, type HistoryItem, type Me, type Usage } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatBytes, formatDate, formatDuration } from "../lib/format";
import { PageHeader, ResourceState, StatusPill } from "../components/common";
import { Button, Card } from "../components/ui";
import { useCallSession } from "../contexts/CallSession";

export default function DashboardPage() {
  const { me } = useOutletContext<{ me: Me; setMe: (user: Me) => void }>();
  const history = useResource<HistoryItem[]>("/api/history?limit=5");
  const contacts = useResource<Contact[]>("/api/contacts");
  const usage = useResource<Usage>("/api/usage");
  const session = useCallSession();
  const navigate = useNavigate();
  const [number, setNumber] = useState("");
  function quickDial(event: React.FormEvent) {
    event.preventDefault();
    navigate(`/call?number=${encodeURIComponent(number.trim())}`);
  }
  return <>
    <PageHeader eyebrow="Workspace" title="Overview" detail="Your calling workspace at a glance." action={<Link to="/call"><Button><PhoneCall size={15} /> Open dialer</Button></Link>} />
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="p-5 md:col-span-2">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div><p className="text-sm text-neutral-500">Your SparkCall number</p><p className="mt-3 text-2xl font-semibold tracking-tight">{me.number || "Not claimed"}</p>
            {!me.number && <Link className="mt-2 inline-block text-sm underline underline-offset-4" to="/settings/account">Claim a number</Link>}
          </div>
          <StatusPill tone={session.online ? "success" : "neutral"}>{session.online ? "Presence connected" : "Presence offline"}</StatusPill>
        </div>
      </Card>
      <Card className="p-5"><p className="text-sm text-neutral-500">TURN usage · {usage.data?.month || "this month"}</p>
        <ResourceState loading={usage.loading} error={usage.error}>
          <p className="mt-3 text-2xl font-semibold">{usage.data?.available ? formatBytes(usage.data.usedBytes) : "Unavailable"}</p>
          <p className="mt-1 text-xs text-neutral-500">{usage.data?.available ? `of ${formatBytes(usage.data.quotaBytes)} monthly allowance` : "Configure Cloudflare Realtime analytics to show usage."}</p>
          {usage.data?.available && usage.data.percentageUsed != null && <div className="mt-4"><div className="h-1.5 rounded bg-neutral-100 dark:bg-neutral-900"><div className="h-1.5 rounded bg-neutral-900 dark:bg-neutral-100" style={{ width: `${Math.min(100, usage.data.percentageUsed)}%` }} /></div><p className="mt-2 text-xs text-neutral-500">{usage.data.percentageUsed.toFixed(1)}% used · {formatBytes(usage.data.remainingBytes)} remaining</p></div>}
          <Link to="/settings/usage" className="mt-3 inline-block text-xs underline underline-offset-4">Usage details</Link>
        </ResourceState>
      </Card>
    </div>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-medium">Quick dial</h2>
        <p className="mt-1 text-sm text-neutral-500">Enter the exact SparkCall number, including letter case.</p>
        <form className="mt-4 flex gap-2" onSubmit={(event) => void quickDial(event)}>
          <div className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-3 text-neutral-400" /><input aria-label="SparkCall number" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="Enter a number" className="focus-ring w-full rounded-md border border-neutral-200 bg-transparent py-2.5 pl-9 pr-3 text-sm outline-none dark:border-neutral-800" /></div>
          <Button type="submit" disabled={!number.trim()}><PhoneCall size={15} /> Call</Button>
        </form>
      </Card>
      <Card className="p-5"><div className="flex items-center justify-between"><h2 className="font-medium">Contact shortcuts</h2><Link to="/contacts" className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white">All contacts</Link></div>
        <ResourceState loading={contacts.loading} error={contacts.error} empty={!contacts.data?.length} emptyTitle="No contacts yet" emptyDetail="Add a contact by SparkCall number to see it here.">
          <div className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-900">{contacts.data?.slice(0, 4).map((contact) => <div key={contact.id} className="flex items-center justify-between py-3">
            <Link to={`/contacts/${contact.id}`} className="min-w-0"><p className="truncate text-sm font-medium">{contact.name}</p><p className="mt-0.5 text-xs text-neutral-500">{contact.number}</p></Link>
            <Link to={`/call?number=${encodeURIComponent(contact.number)}`} aria-label={`Call ${contact.name}`}><Button variant="ghost" className="px-2"><PhoneCall size={15} /></Button></Link>
          </div>)}</div>
        </ResourceState>
      </Card>
    </div>
    <Card className="mt-5">
      <div className="flex items-center justify-between border-b border-neutral-200 p-5 dark:border-neutral-800"><h2 className="font-medium">Recent calls</h2><Link className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white" to="/history">View history <ArrowRight size={14} /></Link></div>
      <div className="p-5"><ResourceState loading={history.loading} error={history.error} empty={!history.data?.length} emptyTitle="No calls yet" emptyDetail="Your completed and missed calls will appear here.">
        <div className="divide-y divide-neutral-100 dark:divide-neutral-900">{history.data?.map((item) => {
          const participant = item.direction === "outgoing" ? item.recipient : item.caller;
          return <div key={item.id} className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center">
            <div><p className="text-sm font-medium">{participant || "Unknown participant"}</p><p className="mt-1 text-xs text-neutral-500">{item.direction} · {item.status} · {item.durationSeconds ? formatDuration(item.durationSeconds) : "—"}</p></div>
            <p className="text-xs text-neutral-500">{formatDate(item.startedAt)}</p>
          </div>;
        })}</div>
      </ResourceState></div>
    </Card>
    <div className="mt-5 flex flex-wrap gap-2"><Link to="/settings/audio"><Button variant="secondary"><Settings size={15} /> Audio settings</Button></Link><Link to="/contacts"><Button variant="secondary"><Users size={15} /> Browse contacts</Button></Link></div>
  </>;
}
