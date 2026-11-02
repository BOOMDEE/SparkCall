import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Copy, ExternalLink, FilePlus2, Globe2, LockKeyhole, Trash2 } from "lucide-react";
import { api, type HistoryItem, type PrivateRecord } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatDate, formatDuration } from "../lib/format";
import { PageHeader, ResourceState, StatusPill } from "../components/common";
import { Button, Card, Field, Notice } from "../components/ui";

export default function RecordsPage() {
  const [params] = useSearchParams();
  const records = useResource<PrivateRecord[]>("/api/records");
  const history = useResource<HistoryItem[]>("/api/history?limit=200");
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [callId, setCallId] = useState(params.get("callId") || "");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [participantNames, setParticipantNames] = useState("");
  const [participantConsent, setParticipantConsent] = useState(false);
  const [metadata, setMetadata] = useState("{}");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (params.get("callId")) { setCallId(params.get("callId") || ""); setCreating(true); } }, [params]);

  async function createRecord(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null); setBusy(true);
    let parsedMetadata: unknown;
    try { parsedMetadata = JSON.parse(metadata || "{}"); }
    catch { setError("Custom metadata must be valid JSON."); setBusy(false); return; }
    const participants = participantConsent ? participantNames.split("\n").map((displayName) => ({ displayName: displayName.trim(), consent: true })) : [];
    try {
      const result = await api<{ id: string; slug: string; recoveryCapability: boolean }>("/api/records", {
        method: "POST",
        body: JSON.stringify({
          slug, title, callId: callId || undefined, description, notes,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), participants,
          metadata: parsedMetadata, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      setNotice(result.recoveryCapability ? "Private record created. A separate HttpOnly recovery credential is saved in this browser so you can still manage it if your temporary session expires." : "Private record created. Publishing is an explicit action.");
      setCreating(false); setSlug(""); setTitle(""); setDescription(""); setNotes(""); setTags(""); setParticipantNames(""); setParticipantConsent(false); setMetadata("{}"); setExpiresAt(""); setCallId(""); records.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create record."); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeader title="Call records" detail="Create a private summary of a call. Records never include audio, and public sharing is off until you enable it." action={<Button onClick={() => setCreating(!creating)}><FilePlus2 size={15} /> {creating ? "Close form" : "New record"}</Button>} />
    {error && <div className="mb-4"><Notice>{error}</Notice></div>}{notice && <div className="mb-4"><Notice tone="success">{notice}</Notice></div>}
    {creating && <Card className="mb-5 p-5 sm:p-6"><h2 className="font-medium">Create a private call record</h2>
      <form onSubmit={(event) => void createRecord(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Public URL slug" required minLength={3} maxLength={96} pattern="[A-Za-z0-9-]+" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="project-meeting" />
        <Field label="Title" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Project check-in" />
        <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">Associated call (optional)</span><select value={callId} onChange={(event) => setCallId(event.target.value)} className="focus-ring w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 dark:border-neutral-800"><option value="">No linked call</option>{history.data?.map((call) => <option key={call.id} value={call.id}>{call.direction} · {call.direction === "outgoing" ? call.recipient : call.caller} · {formatDate(call.startedAt)}</option>)}</select></label>
        <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">Description</span><textarea maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} className="focus-ring min-h-20 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 outline-none dark:border-neutral-800" /></label>
        <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">Notes</span><textarea maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} className="focus-ring min-h-20 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 outline-none dark:border-neutral-800" /></label>
        <Field label="Tags (comma-separated)" maxLength={1000} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="planning, project" />
        <Field label="Expiration (optional)" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">Participant display names (one per line)</span><textarea maxLength={1600} value={participantNames} onChange={(event) => setParticipantNames(event.target.value)} className="focus-ring min-h-20 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 outline-none dark:border-neutral-800" placeholder="Names are not added unless you confirm consent below." /></label>
        <label className="flex items-start gap-2 text-xs leading-5 text-neutral-500 sm:col-span-2"><input type="checkbox" checked={participantConsent} onChange={(event) => setParticipantConsent(event.target.checked)} /><span>I have appropriate consent to include these display names if I later publish this record. Without consent, names are not stored.</span></label>
        <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">Custom metadata (JSON object)</span><textarea value={metadata} onChange={(event) => setMetadata(event.target.value)} className="focus-ring min-h-24 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 font-mono text-xs outline-none dark:border-neutral-800" /></label>
        <p className="text-xs leading-5 text-neutral-500 sm:col-span-2">The record is always created privately. You can publish it later. Do not enter account emails, credentials, or private session data.</p>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create private record"}</Button></div>
      </form>
    </Card>}
    <ResourceState loading={records.loading} error={records.error} empty={!records.data?.length} emptyTitle="No call records" emptyDetail="Create a private summary; you decide if and when to publish it.">
      <div className="space-y-3">{records.data?.map((record) => <RecordCard key={record.id} record={record} onUpdated={records.refresh} />)}</div>
    </ResourceState>
  </>;
}

function RecordCard({ record, onUpdated }: { record: PrivateRecord; onUpdated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(record.title);
  const [slug, setSlug] = useState(record.slug);
  const [description, setDescription] = useState(record.description);
  const [notes, setNotes] = useState(record.notes);
  const [tags, setTags] = useState(record.tags.join(", "));
  const [metadata, setMetadata] = useState(JSON.stringify(record.metadata, null, 2));
  const [expiresAt, setExpiresAt] = useState(record.expiresAt ? new Date(record.expiresAt).toISOString().slice(0, 16) : "");
  const [isPublic, setIsPublic] = useState(record.isPublic);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setError(null);
    let parsed: unknown;
    try { parsed = JSON.parse(metadata || "{}"); }
    catch { setError("Custom metadata must be valid JSON."); return; }
    try {
      await api(`/api/records/${encodeURIComponent(record.id)}`, { method: "PATCH", body: JSON.stringify({ title, slug, description, notes, tags: tags.split(",").map((item) => item.trim()).filter(Boolean), metadata: parsed, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, isPublic }) });
      onUpdated(); setExpanded(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save record."); }
  }
  async function remove() {
    if (!window.confirm(`Delete “${record.title}”?`)) return;
    try { await api(`/api/records/${encodeURIComponent(record.id)}`, { method: "DELETE" }); onUpdated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete record."); }
  }
  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/callrecords/${encodeURIComponent(record.slug)}`);
    setCopied(true); window.setTimeout(() => setCopied(false), 2_000);
  }
  return <Card className="p-4 sm:p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link to={`/callrecords/${encodeURIComponent(record.slug)}`} className="truncate text-sm font-semibold hover:underline">{record.title}</Link><StatusPill tone={record.isPublic ? "success" : "neutral"}>{record.isPublic ? "Public" : "Private"}</StatusPill></div><p className="mt-1 truncate text-xs text-neutral-500">/callrecords/{record.slug} · updated {formatDate(record.updatedAt)}</p><p className="mt-2 line-clamp-2 text-sm text-neutral-500">{record.description || "No description"}</p>{record.durationSeconds != null && <p className="mt-1 text-xs text-neutral-500">Call duration: {formatDuration(record.durationSeconds)}</p>}</div>
      <div className="flex shrink-0 flex-wrap gap-2"><Button variant="secondary" onClick={() => setExpanded(!expanded)}>{expanded ? "Close" : "Edit"}</Button>{record.isPublic && <Button variant="secondary" onClick={() => void copyLink()}><Copy size={14} />{copied ? "Copied" : "Copy link"}</Button>}<Button variant="danger" className="px-2" aria-label="Delete record" onClick={() => void remove()}><Trash2 size={15} /></Button></div></div>
    {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    {expanded && <form onSubmit={(event) => void save(event)} className="mt-5 grid gap-3 border-t border-neutral-200 pt-5 dark:border-neutral-800 sm:grid-cols-2">
      <Field label="Title" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /><Field label="Public slug" required maxLength={96} value={slug} onChange={(event) => setSlug(event.target.value)} />
      <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">Description</span><textarea maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} className="focus-ring min-h-20 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 outline-none dark:border-neutral-800" /></label>
      <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">Notes</span><textarea maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} className="focus-ring min-h-20 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 outline-none dark:border-neutral-800" /></label>
      <Field label="Tags (comma-separated)" value={tags} onChange={(event) => setTags(event.target.value)} /><Field label="Expiration" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
      <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">Custom metadata (JSON)</span><textarea value={metadata} onChange={(event) => setMetadata(event.target.value)} className="focus-ring min-h-24 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 font-mono text-xs outline-none dark:border-neutral-800" /></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /> <span>{isPublic ? <><Globe2 size={14} className="mr-1 inline" /> Public link is active</> : <><LockKeyhole size={14} className="mr-1 inline" /> Keep this record private</>}</span></label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2"><Button type="submit">Save changes</Button>{isPublic && <a href={`/callrecords/${encodeURIComponent(record.slug)}`} target="_blank" rel="noreferrer"><Button type="button" variant="secondary"><ExternalLink size={14} /> View public page</Button></a>}</div>
    </form>}
  </Card>;
}
