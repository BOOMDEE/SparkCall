import { useState, type FormEvent } from "react";
import { Ban, ShieldOff } from "lucide-react";
import { api } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatDate } from "../lib/format";
import { PageHeader, ResourceState } from "../components/common";
import { Button, Card, Field, Notice } from "../components/ui";

type BlockedItem = { id: string; number: string; display_name: string; created_at: string };
export default function BlockedPage() {
  const resource = useResource<BlockedItem[]>("/api/blocked");
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  async function block(event: FormEvent) {
    event.preventDefault(); setError(null); setSuccess(null);
    try { await api("/api/blocked", { method: "POST", body: JSON.stringify({ number }) }); setNumber(""); setSuccess("User blocked. Future calls are rejected by the server."); resource.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not block this number."); }
  }
  async function unblock(item: BlockedItem) {
    setError(null); setSuccess(null);
    try { await api("/api/blocked", { method: "DELETE", body: JSON.stringify({ number: item.number }) }); setSuccess("User unblocked."); resource.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not unblock this user."); }
  }
  return <>
    <PageHeader title="Blocked users" detail="Blocking is enforced on the server: blocked users cannot establish calls in either direction." />
    <Card className="mb-5 p-5"><form onSubmit={(event) => void block(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="w-full max-w-sm"><Field label="SparkCall number" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="Number to block" maxLength={32} required /></div><Button type="submit" disabled={!number.trim()}><Ban size={15} /> Block number</Button></form></Card>
    {error && <div className="mb-4"><Notice>{error}</Notice></div>}{success && <div className="mb-4"><Notice tone="success">{success}</Notice></div>}
    <ResourceState loading={resource.loading} error={resource.error} empty={!resource.data?.length} emptyTitle="No blocked users" emptyDetail="Blocked users will appear here.">
      <Card><div className="divide-y divide-neutral-100 dark:divide-neutral-900">{resource.data?.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 p-4">
        <div><p className="text-sm font-medium">{item.display_name || item.number}</p><p className="mt-1 text-xs text-neutral-500">{item.number} · blocked {formatDate(item.created_at)}</p></div>
        <Button variant="secondary" onClick={() => void unblock(item)}><ShieldOff size={15} /> Unblock</Button>
      </div>)}</div></Card>
    </ResourceState>
  </>;
}
