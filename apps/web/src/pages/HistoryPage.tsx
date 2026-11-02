import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FilePlus2, PhoneCall } from "lucide-react";
import { type HistoryItem } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatDate, formatDuration } from "../lib/format";
import { PageHeader, ResourceState, StatusPill } from "../components/common";
import { Button, Card } from "../components/ui";

export default function HistoryPage() {
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const path = `/api/history?limit=200${type === "all" ? "" : `&type=${type}`}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const resource = useResource<HistoryItem[]>(path);
  return <>
    <PageHeader title="Call history" detail="Call metadata only. SparkCall does not record call audio." />
    <div className="mb-4 flex flex-col gap-3 sm:flex-row">
      <input aria-label="Search call history" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by number" className="focus-ring max-w-sm rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-neutral-800" />
      <select aria-label="Filter call history" value={type} onChange={(event) => setType(event.target.value)} className="focus-ring max-w-xs rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-neutral-800">
        <option value="all">All calls</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option><option value="missed">Missed</option>
      </select>
    </div>
    <ResourceState loading={resource.loading} error={resource.error} empty={!resource.data?.length} emptyTitle="No calls found" emptyDetail="Try a different filter or place your first call.">
      <Card><div className="divide-y divide-neutral-100 dark:divide-neutral-900">{resource.data?.map((call) => {
        const participant = call.direction === "outgoing" ? call.recipient : call.caller;
        const tone = call.status === "connected" || call.status === "ended" ? "success" : call.status === "timeout" || call.status === "rejected" ? "warning" : call.status === "failed" || call.status === "busy" ? "error" : "neutral";
        return <div key={call.id} className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3"><span className="mt-0.5 text-neutral-500"><PhoneCall size={16} /></span><div><Link to={`/history/${call.id}`} className="text-sm font-medium hover:underline">{participant || "Unknown participant"}</Link><p className="mt-1 text-xs text-neutral-500">{call.direction} · {call.durationSeconds != null ? formatDuration(call.durationSeconds) : "—"}</p></div></div>
          <div className="flex items-center justify-between gap-4 sm:justify-end"><StatusPill tone={tone}>{call.status}</StatusPill><span className="text-xs text-neutral-500">{formatDate(call.startedAt)}</span></div>
        </div>;
      })}</div></Card>
    </ResourceState>
  </>;
}

type CallDetail = { id: string; caller: string | null; recipient: string | null; direction: string; startedAt: string; endedAt: string | null; durationSeconds: number | null; status: string };
export function HistoryDetailPage() {
  const { id = "" } = useParams();
  const resource = useResource<{ call: CallDetail }>(`/api/history/${encodeURIComponent(id)}`);
  const call = resource.data?.call;
  return <>
    <PageHeader eyebrow="Call history" title="Call details" detail={call ? `${call.direction} call · ${call.status}` : "Metadata for this call."} action={<Link to="/history"><Button variant="secondary"><ArrowLeft size={15} /> Call history</Button></Link>} />
    <ResourceState loading={resource.loading} error={resource.error}>
      {call && <Card className="max-w-2xl p-5 sm:p-7"><dl className="grid gap-5 sm:grid-cols-2">
        <div><dt className="text-xs text-neutral-500">Participant</dt><dd className="mt-1 text-sm">{call.direction === "outgoing" ? call.recipient : call.caller}</dd></div>
        <div><dt className="text-xs text-neutral-500">Direction</dt><dd className="mt-1 text-sm capitalize">{call.direction}</dd></div>
        <div><dt className="text-xs text-neutral-500">Status</dt><dd className="mt-1 text-sm capitalize">{call.status}</dd></div>
        <div><dt className="text-xs text-neutral-500">Duration</dt><dd className="mt-1 text-sm">{call.durationSeconds != null ? formatDuration(call.durationSeconds) : "—"}</dd></div>
        <div><dt className="text-xs text-neutral-500">Started</dt><dd className="mt-1 text-sm">{formatDate(call.startedAt)}</dd></div>
        <div><dt className="text-xs text-neutral-500">Ended</dt><dd className="mt-1 text-sm">{formatDate(call.endedAt)}</dd></div>
      </dl><div className="mt-6 flex flex-wrap gap-2"><Link to={`/call?number=${encodeURIComponent(call.direction === "outgoing" ? call.recipient || "" : call.caller || "")}`}><Button><PhoneCall size={15} /> Call again</Button></Link><Link to={`/records?callId=${encodeURIComponent(call.id)}`}><Button variant="secondary"><FilePlus2 size={15} /> Create call record</Button></Link></div><p className="mt-4 text-xs text-neutral-500">The call ID is private metadata and is not published with a record unless you choose to share a public link.</p></Card>}
    </ResourceState>
  </>;
}
