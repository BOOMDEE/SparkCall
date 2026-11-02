import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Archive, Check, Clipboard, ExternalLink, Globe2, LockKeyhole, Trash2 } from "lucide-react";
import { api, type PublicRecord } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatDate, formatDuration } from "../lib/format";
import { PageHeader, ResourceState, StatusPill } from "../components/common";
import { Button, Card, Field, Notice } from "../components/ui";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { SiteFooter } from "../components/SiteFooter";

const inputClass = "focus-ring w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white";
const areaClass = `${inputClass} min-h-20`;

export default function PublicRecordPage() {
  const { t, i18n } = useTranslation("publicRecord");
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const resource = useResource<PublicRecord>(`/api/records/${encodeURIComponent(slug)}`);
  const record = resource.data;
  const ownerCanManage = Boolean(record?.id);
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch { /* Clipboard access is optional; the URL remains visible. */ }
  }

  const expired = Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() <= Date.now());
  const statusPublic = ownerCanManage ? Boolean(record?.isPublic) : true;

  return <div className="min-h-screen bg-white text-neutral-900 dark:bg-black dark:text-neutral-100">
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4 dark:border-neutral-800">
        <Link to="/" className="text-sm font-semibold tracking-tight" aria-label={t("header.homeAria")}>SparkCall</Link>
        <div className="flex flex-wrap items-center gap-2">
          <LanguageSwitcher />
          <Button variant="secondary" onClick={() => void copyLink()} aria-label={t("actions.copyLinkAria")}><Clipboard size={14} aria-hidden="true" />{copied ? t("actions.copied") : t("actions.copyLink")}</Button>
          {ownerCanManage && <Link to="/records"><Button variant="secondary">{t("actions.myRecords")}</Button></Link>}
        </div>
      </header>

      <ResourceState loading={resource.loading} error={resource.error ? t("errors.load", { detail: resource.error }) : null}>
        {record && <>
          <PageHeader
            eyebrow={ownerCanManage ? t("header.ownerEyebrow") : t("header.publicEyebrow")}
            title={record.title}
            detail={record.description || t("record.noDescription")}
            action={<div className="flex flex-wrap items-center gap-2"><StatusPill tone={statusPublic && !expired ? "success" : "warning"}>{statusPublic ? <><Globe2 size={12} aria-hidden="true" />{t("status.public")}</> : <><LockKeyhole size={12} aria-hidden="true" />{t("status.private")}</>}{expired && <><Archive size={12} aria-hidden="true" />{t("status.expired")}</>}</StatusPill></div>}
          />
          <div className="mb-6 border-y border-neutral-200 py-3 text-sm text-neutral-500 dark:border-neutral-800">
            <p>{ownerCanManage ? t("privacy.ownerAccess") : t("privacy.publicAccess")}</p>
            {record.expiresAt && <p className="mt-1">{expired ? t("expiry.expired", { date: formatDate(record.expiresAt, i18n.language) }) : t("expiry.expires", { date: formatDate(record.expiresAt, i18n.language) })}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DataCard label={t("fields.identifier")} value={record.publicIdentifier || record.slug || slug} mono />
            <DataCard label={t("fields.duration")} value={record.durationSeconds != null ? formatDuration(record.durationSeconds) : t("values.notLinked")} />
            <DataCard label={t("fields.started")} value={formatDate(record.startedAt, i18n.language)} />
            <DataCard label={t("fields.ended")} value={formatDate(record.endedAt, i18n.language)} />
          </div>
          {record.participants?.length > 0 && <Card className="mt-4 p-5"><h2 className="font-medium">{t("sections.participants")}</h2><ul className="mt-3 space-y-2 text-sm">{record.participants.map((person, index) => <li key={`${person.displayName}-${index}`}>{person.displayName}</li>)}</ul></Card>}
          {record.tags?.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label={t("sections.tags")}>{record.tags.map((tag) => <StatusPill key={tag}>{tag}</StatusPill>)}</div>}
          {record.notes && <Card className="mt-4 p-5"><h2 className="font-medium">{t("sections.notes")}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600 dark:text-neutral-300">{record.notes}</p></Card>}
          {record.metadata && Object.keys(record.metadata).length > 0 && <Card className="mt-4 p-5"><h2 className="font-medium">{t("sections.details")}</h2><dl className="mt-3 space-y-2">{Object.entries(record.metadata).map(([key, value]) => <div key={key} className="flex flex-col gap-1 border-t border-neutral-100 pt-2 text-sm first:border-0 first:pt-0 dark:border-neutral-900 sm:flex-row sm:justify-between"><dt className="text-neutral-500">{key}</dt><dd className="break-all sm:text-right">{String(value)}</dd></div>)}</dl></Card>}
          {ownerCanManage && <div className="mt-8"><OwnerEditor record={record} onUpdated={resource.refresh} onSlugChanged={(nextSlug) => navigate(`/callrecords/${encodeURIComponent(nextSlug)}`, { replace: true })} /></div>}
        </>}
      </ResourceState>
      {resource.error && <Card className="mt-5 p-5"><div className="flex items-center gap-2 text-sm font-medium"><LockKeyhole size={16} aria-hidden="true" />{t("errors.privateTitle")}</div><p className="mt-2 text-sm text-neutral-500">{t("errors.privateDetail")}</p></Card>}
    </main>
    <SiteFooter className="mt-8" />
  </div>;
}

function DataCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <Card className="p-5"><p className="text-xs text-neutral-500">{label}</p><p className={`mt-2 break-all text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</p></Card>;
}

function OwnerEditor({ record, onUpdated, onSlugChanged }: { record: PublicRecord; onUpdated: () => void; onSlugChanged: (slug: string) => void }) {
  const { t, i18n } = useTranslation("publicRecord");
  const key = record.id || record.slug || record.publicIdentifier || "";
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(record.title);
  const [slug, setSlug] = useState(record.slug || record.publicIdentifier || "");
  const [description, setDescription] = useState(record.description || "");
  const [notes, setNotes] = useState(record.notes || "");
  const [tags, setTags] = useState((record.tags || []).join(", "));
  const [metadata, setMetadata] = useState(JSON.stringify(record.metadata || {}, null, 2));
  const [isPublic, setIsPublic] = useState(Boolean(record.isPublic));
  const [expiresAt, setExpiresAt] = useState(record.expiresAt ? new Date(record.expiresAt).toISOString().slice(0, 16) : "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null);
    if (isPublic !== Boolean(record.isPublic) && !window.confirm(isPublic ? t("confirm.publish") : t("confirm.revoke"))) return;
    let parsedMetadata: unknown;
    try { parsedMetadata = JSON.parse(metadata || "{}"); } catch { setError(t("errors.invalidMetadata")); return; }
    setBusy(true);
    try {
      await api(`/api/records/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify({ title, slug, description, notes, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), metadata: parsedMetadata, isPublic, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }) });
      const slugChanged = slug !== (record.slug || record.publicIdentifier);
      setNotice(t("notices.updated")); setEditing(false); onUpdated();
      if (slugChanged) onSlugChanged(slug);
    } catch (cause) { setError(`${t("errors.updateFailed")}${cause instanceof Error ? `: ${cause.message}` : ""}`); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(t("confirm.delete", { title: record.title }))) return;
    try { await api(`/api/records/${encodeURIComponent(key)}`, { method: "DELETE" }); window.location.assign("/"); }
    catch (cause) { setError(`${t("errors.deleteFailed")}${cause instanceof Error ? `: ${cause.message}` : ""}`); }
  }

  return <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium">{t("owner.title")}</h2><p className="mt-1 text-xs leading-5 text-neutral-500">{t("owner.detail")}</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => { setEditing(!editing); setError(null); }} aria-expanded={editing}>{editing ? t("actions.close") : t("actions.edit")}</Button><Button variant="danger" className="px-2" aria-label={t("actions.deleteAria")} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" /></Button></div></div>
    {error && <div className="mt-4"><Notice>{error}</Notice></div>}{notice && <div className="mt-4"><Notice tone="success">{notice}</Notice></div>}
    {editing && <form onSubmit={(event) => void save(event)} className="mt-5 grid gap-4 border-t border-neutral-200 pt-5 dark:border-neutral-800 sm:grid-cols-2">
      <Field label={t("fields.title")} maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} required /><Field label={t("fields.slug")} maxLength={96} pattern="[A-Za-z0-9-]+" value={slug} onChange={(event) => setSlug(event.target.value)} required />
      <TextArea label={t("fields.description")} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} /><TextArea label={t("fields.notes")} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} />
      <Field label={t("fields.tags")} value={tags} onChange={(event) => setTags(event.target.value)} /><Field label={t("fields.expiresAt")} type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
      <TextArea label={t("fields.metadata")} value={metadata} onChange={(event) => setMetadata(event.target.value)} mono />
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="mt-1" /> <span>{isPublic ? <><Globe2 size={14} className="mr-1 inline" aria-hidden="true" />{t("consent.publicActive")}</> : <><LockKeyhole size={14} className="mr-1 inline" aria-hidden="true" />{t("consent.keepPrivate")}</>}</span></label>
      <p className="text-xs leading-5 text-neutral-500 sm:col-span-2">{isPublic ? t("consent.publicWarning") : t("consent.privateNote")}</p>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" disabled={busy}><Check size={14} aria-hidden="true" />{busy ? t("actions.saving") : t("actions.save")}</Button>{isPublic && <a href={`/callrecords/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer"><Button type="button" variant="secondary"><ExternalLink size={14} aria-hidden="true" />{t("actions.viewPublic")}</Button></a>}</div>
    </form>}
    <p className="mt-4 text-xs text-neutral-500">{t("owner.updated", { date: formatDate(record.updatedAt, i18n.language) })}</p>
  </Card>;
}

function TextArea({ label, mono = false, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; mono?: boolean }) {
  return <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">{label}</span><textarea {...props} className={`${areaClass} ${mono ? "font-mono text-xs" : ""}`} /></label>;
}
