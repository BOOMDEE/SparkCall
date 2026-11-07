import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Heart, PhoneCall, Plus, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type Contact } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { PageHeader } from "../components/common";
import { Button, ButtonLink, Card, Field, Notice } from "../components/ui";

const inputClass = "focus-ring w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white";
const areaClass = `${inputClass} min-h-24`;

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? `${fallback}: ${cause.message}` : fallback;
}

export function ContactsPage() {
  const { t } = useTranslation("contacts");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const resource = useResource<Contact[]>(`/api/contacts?q=${encodeURIComponent(query)}`);

  async function createContact(event: FormEvent) {
    event.preventDefault(); setError(null); setSuccess(null);
    try {
      await api("/api/contacts", { method: "POST", body: JSON.stringify({ number, name, notes }) });
      setName(""); setNumber(""); setNotes(""); setShowForm(false); setSuccess(t("notices.added")); resource.refresh();
    } catch (cause) { setError(errorMessage(cause, t("errors.add"))); }
  }

  async function toggleFavorite(contact: Contact) {
    setError(null);
    try { await api(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: "PATCH", body: JSON.stringify({ favorite: !contact.favorite }) }); resource.refresh(); }
    catch (cause) { setError(errorMessage(cause, t("errors.favorite"))); }
  }

  return <div className="pb-8">
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} detail={t("detail")} action={<Button onClick={() => { setShowForm(!showForm); setError(null); }} aria-expanded={showForm}><Plus size={15} aria-hidden="true" /> {showForm ? t("actions.closeForm") : t("actions.add")}</Button>} />
    {error && <div className="mb-4"><Notice>{error}</Notice></div>}
    {success && <div className="mb-4"><Notice tone="success">{success}</Notice></div>}
    {showForm && <Card className="mb-5 p-5 sm:p-6"><div className="border-b border-neutral-200 pb-4 dark:border-neutral-800"><h2 className="font-medium">{t("form.title")}</h2><p className="mt-1 text-sm text-neutral-500">{t("form.detail")}</p></div><form onSubmit={(event) => void createContact(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
      <Field label={t("fields.number")} required maxLength={32} value={number} onChange={(event) => setNumber(event.target.value)} placeholder={t("placeholders.number")} />
      <Field label={t("fields.name")} required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("placeholders.name")} />
      <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">{t("fields.notes")}</span><textarea name={t("fields.notes")} autoComplete="off" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t("placeholders.notes")} className={areaClass} /></label>
      <div className="sm:col-span-2"><Button type="submit" disabled={!number.trim() || !name.trim()}>{t("actions.saveContact")}</Button></div>
    </form></Card>}
    <div className="mb-5 flex max-w-xl items-center gap-2"><div className="relative flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-neutral-400" aria-hidden="true" /><input name="contact-search" autoComplete="off" aria-label={t("search.aria")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search.placeholder")} className={`${inputClass} pl-9`} /></div><span className="hidden text-xs text-neutral-500 sm:inline">{t("search.hint")}</span></div>
    {resource.loading ? <p className="py-8 text-sm text-neutral-500" role="status">{t("states.loading")}</p> : resource.error ? <div className="space-y-3"><Notice>{t("errors.load", { detail: resource.error })}</Notice><Button variant="secondary" onClick={() => resource.refresh()}>{t("actions.retry")}</Button></div> : !resource.data?.length ? <div className="border border-dashed border-neutral-200 px-6 py-12 text-center dark:border-neutral-800"><p className="text-sm font-medium">{query ? t("empty.noMatchTitle") : t("empty.title")}</p><p className="mt-1 text-sm text-neutral-500">{query ? t("empty.noMatchDetail") : t("empty.detail")}</p>{!query && <div className="mt-5"><Button onClick={() => setShowForm(true)}><Plus size={15} aria-hidden="true" /> {t("actions.addFirst")}</Button></div>}</div> : <Card><div className="divide-y divide-neutral-100 dark:divide-neutral-900">{resource.data.map((contact) => <div key={contact.id} className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
      <Link to={`/contacts/${contact.id}`} className="min-w-0 flex-1 rounded-sm focus-ring"><div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm font-medium">{contact.name}</p>{contact.favorite && <span className="shrink-0 text-xs text-neutral-500">{t("labels.favorite")}</span>}</div><p className="mt-1 text-xs text-neutral-500">{contact.number}</p>{contact.notes && <p className="mt-1 truncate text-xs text-neutral-500">{contact.notes}</p>}</Link>
      <div className="flex shrink-0 items-center gap-1"><Button variant="ghost" className="px-2" aria-label={contact.favorite ? t("actions.removeFavoriteAria", { name: contact.name }) : t("actions.addFavoriteAria", { name: contact.name })} onClick={() => void toggleFavorite(contact)}><Heart size={15} aria-hidden="true" fill={contact.favorite ? "currentColor" : "none"} /></Button><ButtonLink to={`/call?number=${encodeURIComponent(contact.number)}`} variant="ghost" className="px-2" aria-label={t("actions.callAria", { name: contact.name })}><PhoneCall size={15} aria-hidden="true" /></ButtonLink></div>
    </div>)}</div></Card>}
  </div>;
}

export function ContactDetailPage() {
  const { t } = useTranslation("contacts");
  const { id } = useParams();
  const navigate = useNavigate();
  const resource = useResource<{ contact: Contact }>(`/api/contacts/${encodeURIComponent(id || "")}`);
  const contact = resource.data?.contact;
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useEffect(() => { if (contact) { setName(contact.name); setNotes(contact.notes || ""); setFavorite(!!contact.favorite); } }, [contact]);

  async function save(event: FormEvent) {
    event.preventDefault(); setError(null); setSuccess(null);
    try { await api(`/api/contacts/${encodeURIComponent(id || "")}`, { method: "PATCH", body: JSON.stringify({ name, notes, favorite }) }); setSuccess(t("notices.saved")); resource.refresh(); }
    catch (cause) { setError(errorMessage(cause, t("errors.save"))); }
  }
  async function remove() {
    if (!id || !window.confirm(t("confirm.delete"))) return;
    try { await api(`/api/contacts?id=${encodeURIComponent(id)}`, { method: "DELETE" }); navigate("/contacts"); }
    catch (cause) { setError(errorMessage(cause, t("errors.delete"))); }
  }
  async function block() {
    if (!contact || !window.confirm(t("confirm.block", { name: contact.name }))) return;
    try { await api("/api/blocked", { method: "POST", body: JSON.stringify({ number: contact.number }) }); navigate("/blocked"); }
    catch (cause) { setError(errorMessage(cause, t("errors.block"))); }
  }

  return <div className="pb-8">
    <PageHeader eyebrow={t("detailPage.eyebrow")} title={contact?.name || t("detailPage.title")} detail={contact?.number} action={<ButtonLink to="/contacts" variant="secondary"><ArrowLeft size={15} aria-hidden="true" /> {t("actions.back")}</ButtonLink>} />
    {resource.loading ? <p className="py-8 text-sm text-neutral-500" role="status">{t("states.loading")}</p> : resource.error ? <div className="space-y-3"><Notice>{t("errors.load", { detail: resource.error })}</Notice><Button variant="secondary" onClick={() => resource.refresh()}>{t("actions.retry")}</Button></div> : contact && <Card className="max-w-2xl p-5 sm:p-7"><form onSubmit={(event) => void save(event)} className="space-y-4">
      <Field label={t("fields.number")} value={contact.number} readOnly />
      <Field label={t("fields.name")} required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      <label className="block text-sm"><span className="mb-1.5 block font-medium">{t("fields.notes")}</span><textarea name={t("fields.notes")} autoComplete="off" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t("placeholders.notes")} className={`${areaClass} min-h-28`} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} /> {t("fields.favorite")}</label>
      {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
      <div className="flex flex-wrap gap-2"><Button type="submit">{t("actions.saveChanges")}</Button><ButtonLink to={`/call?number=${encodeURIComponent(contact.number)}`} variant="secondary"><PhoneCall size={15} aria-hidden="true" /> {t("actions.call")}</ButtonLink><Button type="button" variant="secondary" onClick={() => void block()}><Ban size={15} aria-hidden="true" /> {t("actions.block")}</Button><Button type="button" variant="danger" onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" /> {t("actions.delete")}</Button></div>
    </form></Card>}
  </div>;
}
