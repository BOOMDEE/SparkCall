import { useEffect, useState, type FormEvent, type TextareaHTMLAttributes } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Archive, Check, Clipboard, ExternalLink, FilePlus2, Globe2, LockKeyhole, ShieldCheck, Trash2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type HistoryItem, type PrivateRecord } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatDate, formatDuration } from "../lib/format";
import { PageHeader, StatusPill } from "../components/common";
import { Button, Card, Empty, Field, Notice } from "../components/ui";

const inputClass = "focus-ring w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white";
const areaClass = `${inputClass} min-h-20`;

export default function RecordsPage() {
  const { t, i18n } = useTranslation("records");
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

  useEffect(() => {
    if (params.get("callId")) {
      setCallId(params.get("callId") || "");
      setCreating(true);
    }
  }, [params]);

  async function createRecord(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    let parsedMetadata: unknown;
    try {
      parsedMetadata = JSON.parse(metadata || "{}");
    } catch {
      setError(t("errors.invalidMetadata"));
      setBusy(false);
      return;
    }
    const participants = participantConsent
      ? participantNames.split("\n").map((displayName) => ({ displayName: displayName.trim(), consent: true })).filter((participant) => participant.displayName)
      : [];
    try {
      const result = await api<{ id: string; slug: string; recoveryCapability: boolean }>("/api/records", {
        method: "POST",
        body: JSON.stringify({
          slug,
          title,
          callId: callId || undefined,
          description,
          notes,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          participants,
          metadata: parsedMetadata,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      setNotice(result.recoveryCapability ? t("notices.createdWithRecovery") : t("notices.created"));
      setCreating(false);
      setSlug(""); setTitle(""); setDescription(""); setNotes(""); setTags(""); setParticipantNames(""); setParticipantConsent(false); setMetadata("{}"); setExpiresAt(""); setCallId("");
      records.refresh();
    } catch (cause) {
      setError(`${t("errors.createFailed")}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  return <div className="pb-8">
    <PageHeader
      eyebrow={t("eyebrow")}
      title={t("title")}
      detail={t("detail")}
      action={<Button onClick={() => { setCreating(!creating); setError(null); }} aria-expanded={creating} aria-controls="record-create-form"><FilePlus2 size={15} aria-hidden="true" /> {creating ? t("actions.closeForm") : t("actions.newRecord")}</Button>}
    />
    <div className="mb-6 flex items-start gap-3 border-y border-neutral-200 py-3 text-xs leading-5 text-neutral-500 dark:border-neutral-800">
      <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>{t("security.ownerNote")}</p>
    </div>
    {error && <div className="mb-4"><Notice>{error}</Notice></div>}
    {notice && <div className="mb-4"><Notice tone="success">{notice}</Notice></div>}
    {creating && <Card className="mb-6 p-5 sm:p-6"><div className="flex items-start gap-3 border-b border-neutral-200 pb-4 dark:border-neutral-800"><LockKeyhole size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><div><h2 className="font-medium">{t("create.title")}</h2><p className="mt-1 text-sm text-neutral-500">{t("create.detail")}</p></div></div>
      <form id="record-create-form" onSubmit={(event) => void createRecord(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={t("fields.slug")} required minLength={3} maxLength={96} pattern="[A-Za-z0-9-]+" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={t("placeholders.slug")} />
        <Field label={t("fields.title")} required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("placeholders.title")} />
        <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">{t("fields.associatedCall")}</span><select name="associated-call" autoComplete="off" aria-label={t("fields.associatedCall")} value={callId} onChange={(event) => setCallId(event.target.value)} className={inputClass}><option value="">{t("options.noLinkedCall")}</option>{history.data?.map((call) => <option key={call.id} value={call.id}>{call.direction === "outgoing" ? t("options.outgoing") : t("options.incoming")} · {call.direction === "outgoing" ? call.recipient : call.caller} · {formatDate(call.startedAt, i18n.language)}</option>)}</select></label>
        <TextArea label={t("fields.description")} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} />
        <TextArea label={t("fields.notes")} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} />
        <Field label={t("fields.tags")} maxLength={1000} value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("placeholders.tags")} />
        <Field label={t("fields.expiration")} type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        <TextArea label={t("fields.participants")} value={participantNames} onChange={(event) => setParticipantNames(event.target.value)} maxLength={1600} placeholder={t("placeholders.participants")} />
        <label className="flex items-start gap-2 text-xs leading-5 text-neutral-500 sm:col-span-2"><input name="participant-consent" autoComplete="off" type="checkbox" checked={participantConsent} onChange={(event) => setParticipantConsent(event.target.checked)} className="mt-1" /> <span>{t("consent.create")}</span></label>
        <TextArea label={t("fields.metadata")} value={metadata} onChange={(event) => setMetadata(event.target.value)} mono />
        <p className="text-xs leading-5 text-neutral-500 sm:col-span-2">{t("create.privacyNote")}</p>
        <p className="text-xs leading-5 text-neutral-500 sm:col-span-2">{t("create.capabilityNote")}</p>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? t("actions.creating") : t("actions.createPrivate")}</Button></div>
      </form>
    </Card>}
    {records.loading && <div className="py-8 text-sm text-neutral-500" role="status" aria-live="polite">{t("states.loading")}</div>}
    {!records.loading && records.error && <div className="space-y-3"><Notice>{`${t("errors.loadFailed")}: ${records.error}`}</Notice><Button variant="secondary" onClick={() => records.refresh()}>{t("actions.retry")}</Button></div>}
    {!records.loading && !records.error && !records.data?.length && <Empty title={t("empty.title")} detail={t("empty.detail")} />}
    {!records.loading && !records.error && Boolean(records.data?.length) && <div className="space-y-3">{records.data?.map((record) => <RecordCard key={record.id} record={record} onUpdated={records.refresh} locale={i18n.language} />)}</div>}
  </div>;
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; mono?: boolean };
function TextArea({ label, mono = false, ...props }: TextAreaProps) {
  return <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">{label}</span><textarea {...props} name={props.name || label} autoComplete={props.autoComplete || "off"} className={`${areaClass} ${mono ? "font-mono text-xs" : ""}`} /></label>;
}

function RecordCard({ record, onUpdated, locale }: { record: PrivateRecord; onUpdated: () => void; locale: string }) {
  const { t } = useTranslation("records");
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
  const [busy, setBusy] = useState(false);
  const expired = Boolean(record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now());

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!record.isPublic && isPublic && !window.confirm(t("confirm.publish"))) return;
    let parsed: unknown;
    try { parsed = JSON.parse(metadata || "{}"); } catch { setError(t("errors.invalidMetadata")); return; }
    setBusy(true);
    try {
      await api(`/api/records/${encodeURIComponent(record.id)}`, { method: "PATCH", body: JSON.stringify({ title, slug, description, notes, tags: tags.split(",").map((item) => item.trim()).filter(Boolean), metadata: parsed, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, isPublic }) });
      onUpdated();
      setExpanded(false);
    } catch (cause) {
      setError(`${t("errors.saveFailed")}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("confirm.delete", { title: record.title }))) return;
    setBusy(true);
    try { await api(`/api/records/${encodeURIComponent(record.id)}`, { method: "DELETE" }); onUpdated(); }
    catch (cause) { setError(`${t("errors.deleteFailed")}${cause instanceof Error ? `: ${cause.message}` : ""}`); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/callrecords/${encodeURIComponent(record.slug)}`); setCopied(true); window.setTimeout(() => setCopied(false), 2_000); }
    catch { setError(t("errors.copyFailed")); }
  }

  return <Card className="p-4 sm:p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link to={`/callrecords/${encodeURIComponent(record.slug)}`} className="truncate text-sm font-semibold hover:underline">{record.title}</Link><StatusPill tone={record.isPublic ? "success" : "neutral"}>{record.isPublic ? <><Globe2 size={12} className="mr-1" aria-hidden="true" />{t("status.public")}</> : <><LockKeyhole size={12} className="mr-1" aria-hidden="true" />{t("status.private")}</>}</StatusPill>{expired && <StatusPill tone="warning"><Archive size={12} className="mr-1" aria-hidden="true" />{t("status.expired")}</StatusPill>}</div><p className="mt-1 truncate text-xs text-neutral-500">/callrecords/{record.slug} · {t("record.updated", { date: formatDate(record.updatedAt, locale) })}</p><p className="mt-2 line-clamp-2 text-sm text-neutral-500">{record.description || t("record.noDescription")}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">{record.durationSeconds != null && <span>{t("record.duration", { duration: formatDuration(record.durationSeconds) })}</span>}{record.participants.length > 0 && <span><Users size={12} className="mr-1 inline" aria-hidden="true" />{t("record.participants", { count: record.participants.length })}</span>}{record.expiresAt && <span>{t("record.expires", { date: formatDate(record.expiresAt, locale) })}</span>}</div></div><div className="flex shrink-0 flex-wrap gap-2"><Button variant="secondary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? t("actions.close") : t("actions.edit")}</Button>{record.isPublic && <Button variant="secondary" onClick={() => void copyLink()}><Clipboard size={14} aria-hidden="true" />{copied ? <><Check size={14} aria-hidden="true" />{t("actions.copied")}</> : t("actions.copyLink")}</Button>}<Button variant="danger" className="px-2" disabled={busy} aria-label={t("actions.deleteAria")} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" /></Button></div></div>
    {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    {expanded && <form onSubmit={(event) => void save(event)} className="mt-5 grid gap-4 border-t border-neutral-200 pt-5 dark:border-neutral-800 sm:grid-cols-2"><Field label={t("fields.title")} required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /><Field label={t("fields.slug")} required minLength={3} maxLength={96} pattern="[A-Za-z0-9-]+" value={slug} onChange={(event) => setSlug(event.target.value)} /><TextArea label={t("fields.description")} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} /><TextArea label={t("fields.notes")} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} /><Field label={t("fields.tags")} value={tags} onChange={(event) => setTags(event.target.value)} /><Field label={t("fields.expiration")} type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /><TextArea label={t("fields.metadata")} value={metadata} onChange={(event) => setMetadata(event.target.value)} mono /><label className="flex items-start gap-2 text-sm sm:col-span-2"><input name="record-public" autoComplete="off" type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="mt-1" /> <span>{isPublic ? <><Globe2 size={14} className="mr-1 inline" aria-hidden="true" />{t("consent.publicActive")}</> : <><LockKeyhole size={14} className="mr-1 inline" aria-hidden="true" />{t("consent.keepPrivate")}</>}</span></label><p className="text-xs leading-5 text-neutral-500 sm:col-span-2">{isPublic ? t("consent.publicWarning") : t("consent.privateNote")}</p><div className="flex flex-wrap items-center gap-2 sm:col-span-2"><Button type="submit" disabled={busy}><Check size={14} aria-hidden="true" />{busy ? t("actions.saving") : t("actions.save")}</Button>{isPublic && <a className="sc-button focus-ring inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium sc-button-secondary border border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-black dark:hover:bg-neutral-900" href={`/callrecords/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />{t("actions.viewPublic")}</a>}</div></form>}
  </Card>;
}
