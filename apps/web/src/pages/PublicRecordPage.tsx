import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Copy, LockKeyhole, Trash2 } from "lucide-react";
import { api, type PublicRecord } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatDate, formatDuration } from "../lib/format";
import { PageHeader, ResourceState, StatusPill } from "../components/common";
import { Button, Card, Field, Notice } from "../components/ui";

export default function PublicRecordPage() {
  const { slug = "" } = useParams();
  const resource = useResource<PublicRecord>(`/api/records/${encodeURIComponent(slug)}`);
  const record = resource.data;
  const ownerCanManage = Boolean(record?.id);
  const [copied, setCopied] = useState(false);
  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true); window.setTimeout(() => setCopied(false), 2_000);
  }
  return <main className="min-h-screen bg-white px-4 py-8 text-neutral-900 dark:bg-black dark:text-neutral-100 sm:px-6">
    <div className="mx-auto max-w-3xl"><header className="mb-8 flex items-center justify-between border-b border-neutral-200 pb-4 dark:border-neutral-800"><Link to="/" className="text-sm font-semibold tracking-tight">SparkCall</Link><div className="flex gap-2"><Button variant="secondary" onClick={() => void copyLink()}><Copy size={14} />{copied ? "Copied" : "Copy link"}</Button>{ownerCanManage && <Link to="/records"><Button variant="secondary">My records</Button></Link>}</div></header>
      <ResourceState loading={resource.loading} error={resource.error}>
        {record && <>
          <PageHeader eyebrow={ownerCanManage ? "Private owner view" : "Call record"} title={record.title} detail={record.description || "No description was provided."} action={<StatusPill tone={record.isPublic ? "success" : "neutral"}>{record.isPublic ? "Public" : "Private"}</StatusPill>} />
          <div className="grid gap-4 sm:grid-cols-2"><Card className="p-5"><p className="text-xs text-neutral-500">Public identifier</p><p className="mt-2 break-all text-sm font-medium">{record.publicIdentifier || record.slug || slug}</p></Card>
            <Card className="p-5"><p className="text-xs text-neutral-500">Call duration</p><p className="mt-2 text-sm font-medium">{record.durationSeconds != null ? formatDuration(record.durationSeconds) : "Not linked to a call"}</p></Card>
            <Card className="p-5"><p className="text-xs text-neutral-500">Started</p><p className="mt-2 text-sm font-medium">{formatDate(record.startedAt)}</p></Card>
            <Card className="p-5"><p className="text-xs text-neutral-500">Ended</p><p className="mt-2 text-sm font-medium">{formatDate(record.endedAt)}</p></Card>
          </div>
          {record.participants?.length > 0 && <Card className="mt-4 p-5"><h2 className="font-medium">Participants</h2><ul className="mt-3 space-y-2">{record.participants.map((person, index) => <li key={`${person.displayName}-${index}`} className="text-sm">{person.displayName}</li>)}</ul></Card>}
          {record.tags?.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{record.tags.map((tag) => <StatusPill key={tag}>{tag}</StatusPill>)}</div>}
          {record.notes && <Card className="mt-4 p-5"><h2 className="font-medium">Notes</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600 dark:text-neutral-300">{record.notes}</p></Card>}
          {record.metadata && Object.keys(record.metadata).length > 0 && <Card className="mt-4 p-5"><h2 className="font-medium">Additional details</h2><dl className="mt-3 space-y-2">{Object.entries(record.metadata).map(([key, value]) => <div key={key} className="flex flex-col gap-1 border-t border-neutral-100 pt-2 text-sm first:border-0 first:pt-0 dark:border-neutral-900 sm:flex-row sm:justify-between"><dt className="text-neutral-500">{key}</dt><dd className="break-all sm:text-right">{String(value)}</dd></div>)}</dl></Card>}
          {record.expiresAt && <p className="mt-4 text-xs text-neutral-500">Record expires {formatDate(record.expiresAt)}.</p>}
          {ownerCanManage && <div className="mt-8"><OwnerEditor record={record} onUpdated={resource.refresh} /></div>}
        </>}
      </ResourceState>
      {resource.error && <Card className="mt-5 p-5"><div className="flex items-center gap-2 text-sm font-medium"><LockKeyhole size={16} /> This record is private or does not exist.</div><p className="mt-2 text-sm text-neutral-500">Only a signed-in owner or a browser holding the record’s secure recovery credential can open a private record.</p></Card>}
      <footer className="mt-12 border-t border-neutral-200 pt-5 text-xs text-neutral-500 dark:border-neutral-800">SparkCall does not store call audio. Public records should contain only information their participants have agreed to share.</footer>
    </div>
  </main>;
}

function OwnerEditor({ record, onUpdated }: { record: PublicRecord; onUpdated: () => void }) {
  const key = record.id || record.slug || record.publicIdentifier || "";
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(record.title);
  const [slug, setSlug] = useState(record.slug || record.publicIdentifier || "");
  const [description, setDescription] = useState(record.description || "");
  const [notes, setNotes] = useState(record.notes || "");
  const [tags, setTags] = useState((record.tags || []).join(", "));
  const [isPublic, setIsPublic] = useState(!!record.isPublic);
  const [expiresAt, setExpiresAt] = useState(record.expiresAt ? new Date(record.expiresAt).toISOString().slice(0, 16) : "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null);
    try {
      await api(`/api/records/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify({ title, slug, description, notes, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), isPublic, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }) });
      setNotice("Record updated. Refresh the page to see the new visibility or slug."); setEditing(false); onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this record."); }
  }
  async function remove() {
    if (!window.confirm("Delete this record permanently?")) return;
    try { await api(`/api/records/${encodeURIComponent(key)}`, { method: "DELETE" }); window.location.assign("/"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete this record."); }
  }
  return <Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">Manage this record</h2><p className="mt-1 text-xs text-neutral-500">Owner access was verified by your account session or the HttpOnly recovery credential.</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => setEditing(!editing)}>{editing ? "Close" : "Edit"}</Button><Button variant="danger" className="px-2" aria-label="Delete this record" onClick={() => void remove()}><Trash2 size={15} /></Button></div></div>
    {error && <div className="mt-4"><Notice>{error}</Notice></div>}{notice && <div className="mt-4"><Notice tone="success">{notice}</Notice></div>}
    {editing && <form onSubmit={(event) => void save(event)} className="mt-5 grid gap-3 border-t border-neutral-200 pt-5 dark:border-neutral-800 sm:grid-cols-2"><Field label="Title" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} required /><Field label="Public URL slug" maxLength={96} value={slug} onChange={(event) => setSlug(event.target.value)} required />
      <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} className="focus-ring min-h-20 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 outline-none dark:border-neutral-800" /></label>
      <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} className="focus-ring min-h-20 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 outline-none dark:border-neutral-800" /></label>
      <Field label="Tags" value={tags} onChange={(event) => setTags(event.target.value)} /><Field label="Expires at" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /> Allow anyone with the URL to view this record</label>
      <div className="sm:col-span-2"><Button type="submit">Save record</Button></div>
    </form>}
  </Card>;
}
