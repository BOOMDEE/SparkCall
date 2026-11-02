import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Heart, PhoneCall, Plus, Search, Trash2 } from "lucide-react";
import { api, type Contact } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { PageHeader, ResourceState } from "../components/common";
import { Button, Card, Field, Notice } from "../components/ui";

export function ContactsPage() {
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
      setName(""); setNumber(""); setNotes(""); setShowForm(false); setSuccess("Contact added."); resource.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add contact."); }
  }
  async function toggleFavorite(contact: Contact) {
    try { await api(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: "PATCH", body: JSON.stringify({ favorite: !contact.favorite }) }); resource.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update contact."); }
  }
  return <>
    <PageHeader title="Contacts" detail="Search by SparkCall number or name. Contact records are private to your account." action={<Button onClick={() => setShowForm(!showForm)}><Plus size={15} /> {showForm ? "Close form" : "Add contact"}</Button>} />
    {error && <div className="mb-4"><Notice>{error}</Notice></div>}{success && <div className="mb-4"><Notice tone="success">{success}</Notice></div>}
    {showForm && <Card className="mb-5 p-5"><h2 className="font-medium">Add a contact</h2><form onSubmit={(event) => void createContact(event)} className="mt-4 grid gap-3 sm:grid-cols-2">
      <Field label="SparkCall number" required maxLength={32} value={number} onChange={(event) => setNumber(event.target.value)} placeholder="Case-sensitive number" />
      <Field label="Name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name to show in your contacts" />
      <label className="text-sm sm:col-span-2"><span className="mb-1.5 block font-medium">Notes</span><textarea maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} className="focus-ring min-h-20 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 outline-none dark:border-neutral-800" /></label>
      <div className="sm:col-span-2"><Button type="submit" disabled={!number.trim() || !name.trim()}>Save contact</Button></div>
    </form></Card>}
    <div className="mb-4 max-w-sm"><div className="relative"><Search size={15} className="absolute left-3 top-3 text-neutral-400" /><input aria-label="Search contacts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts" className="focus-ring w-full rounded-md border border-neutral-200 bg-transparent py-2.5 pl-9 pr-3 text-sm outline-none dark:border-neutral-800" /></div></div>
    <ResourceState loading={resource.loading} error={resource.error} empty={!resource.data?.length} emptyTitle="No matching contacts" emptyDetail={query ? "Try a different name or number." : "Add a SparkCall number to create your first contact."}>
      <Card><div className="divide-y divide-neutral-100 dark:divide-neutral-900">{resource.data?.map((contact) => <div key={contact.id} className="flex items-center justify-between gap-3 p-4">
        <Link to={`/contacts/${contact.id}`} className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{contact.name} {contact.favorite && <span className="ml-1 text-xs text-neutral-400">Favorite</span>}</p><p className="mt-1 text-xs text-neutral-500">{contact.number}</p>{contact.notes && <p className="mt-1 truncate text-xs text-neutral-500">{contact.notes}</p>}</Link>
        <div className="flex items-center gap-1"><Button variant="ghost" className="px-2" aria-label={contact.favorite ? "Remove favorite" : "Add favorite"} onClick={() => void toggleFavorite(contact)}><Heart size={15} fill={contact.favorite ? "currentColor" : "none"} /></Button><Link to={`/call?number=${encodeURIComponent(contact.number)}`}><Button variant="ghost" className="px-2" aria-label={`Call ${contact.name}`}><PhoneCall size={15} /></Button></Link></div>
      </div>)}</div></Card>
    </ResourceState>
  </>;
}

export function ContactDetailPage() {
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
    try { await api(`/api/contacts/${encodeURIComponent(id || "")}`, { method: "PATCH", body: JSON.stringify({ name, notes, favorite }) }); setSuccess("Contact saved."); resource.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the contact."); }
  }
  async function remove() {
    if (!id) return;
    if (!window.confirm("Delete this contact? This cannot be undone.")) return;
    try { await api(`/api/contacts?id=${encodeURIComponent(id)}`, { method: "DELETE" }); navigate("/contacts"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete contact."); }
  }
  async function block() {
    if (!contact) return;
    try { await api("/api/blocked", { method: "POST", body: JSON.stringify({ number: contact.number }) }); navigate("/blocked"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not block user."); }
  }
  return <>
    <PageHeader eyebrow="Contact" title={contact?.name || "Contact details"} detail={contact?.number} action={<Link to="/contacts"><Button variant="secondary"><ArrowLeft size={15} /> Contacts</Button></Link>} />
    <ResourceState loading={resource.loading} error={resource.error}>
      {contact && <Card className="max-w-2xl p-5 sm:p-7"><form onSubmit={(event) => void save(event)} className="space-y-4">
        <Field label="SparkCall number" value={contact.number} readOnly />
        <Field label="Contact name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        <label className="block text-sm"><span className="mb-1.5 block font-medium">Notes</span><textarea maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} className="focus-ring min-h-28 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 outline-none dark:border-neutral-800" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} /> Favorite contact</label>
        {error && <Notice>{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
        <div className="flex flex-wrap gap-2"><Button type="submit">Save changes</Button><Link to={`/call?number=${encodeURIComponent(contact.number)}`}><Button variant="secondary"><PhoneCall size={15} /> Call</Button></Link><Button type="button" variant="secondary" onClick={() => void block()}><Ban size={15} /> Block</Button><Button type="button" variant="danger" onClick={() => void remove()}><Trash2 size={15} /> Delete</Button></div>
      </form></Card>}
    </ResourceState>
  </>;
}
