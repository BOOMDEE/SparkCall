import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FilePlus2, PhoneCall, Search, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type HistoryItem } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatDate, formatDuration } from "../lib/format";
import { PageHeader, StatusPill } from "../components/common";
import { Button, Card, Empty, Notice } from "../components/ui";

type StatusTone = "neutral" | "success" | "warning" | "error";

function statusTone(status: string): StatusTone {
  if (status === "connected" || status === "ended") return "success";
  if (status === "timeout" || status === "rejected") return "warning";
  if (status === "failed" || status === "busy") return "error";
  return "neutral";
}

function translatedValue(t: (key: string, options?: Record<string, unknown>) => string, group: string, value: string) {
  return t(`${group}.${value}`, { defaultValue: value });
}

function ResourceMessage({ loading, error, empty, emptyTitle, emptyDetail, children }: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyTitle: string;
  emptyDetail: string;
  children: React.ReactNode;
}) {
  if (loading) return <p className="py-10 text-center text-sm text-neutral-500" role="status">{emptyTitle}</p>;
  if (error) return <Notice>{error}</Notice>;
  if (empty) return <Empty title={emptyTitle} detail={emptyDetail} />;
  return <>{children}</>;
}

export default function HistoryPage() {
  const { t, i18n } = useTranslation("history");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const path = `/api/history?limit=200${type === "all" ? "" : `&type=${type}`}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const resource = useResource<HistoryItem[]>(path);

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} detail={t("detail")} />
    <div className="mb-5 flex flex-col gap-3 border-b border-neutral-200 pb-5 dark:border-neutral-800 sm:flex-row sm:items-end">
      <label className="relative block min-w-0 flex-1 sm:max-w-sm">
        <span className="sr-only">{t("filters.searchLabel")}</span>
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input aria-label={t("filters.searchLabel")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filters.searchPlaceholder")} className="focus-ring w-full rounded-md border border-neutral-200 bg-transparent py-2 pl-9 pr-3 text-sm outline-none dark:border-neutral-800" />
      </label>
      <label className="flex items-center gap-2 text-sm text-neutral-500">
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span className="sr-only">{t("filters.typeLabel")}</span>
        <select aria-label={t("filters.typeLabel")} value={type} onChange={(event) => setType(event.target.value)} className="focus-ring rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 outline-none dark:border-neutral-800 dark:text-white">
          <option value="all">{t("filters.all")}</option>
          <option value="incoming">{t("filters.incoming")}</option>
          <option value="outgoing">{t("filters.outgoing")}</option>
          <option value="missed">{t("filters.missed")}</option>
        </select>
      </label>
    </div>
    <ResourceMessage loading={resource.loading} error={resource.error ? t("errors.load", { detail: resource.error }) : null} empty={!resource.data?.length} emptyTitle={resource.loading ? t("states.loading") : t("empty.title")} emptyDetail={t("empty.detail")}>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-neutral-200 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_8rem]">
          <span>{t("table.participant")}</span><span className="hidden sm:block">{t("table.direction")}</span><span className="hidden sm:block">{t("table.status")}</span><span className="text-right">{t("table.started")}</span>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-900">
          {resource.data?.map((call) => {
            const participant = call.direction === "outgoing" ? call.recipient : call.caller;
            return <div key={call.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_8rem]">
              <div className="flex min-w-0 items-start gap-3"><PhoneCall size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-neutral-500" /><div className="min-w-0"><Link to={`/history/${call.id}`} className="block truncate text-sm font-medium hover:underline">{participant || t("unknownParticipant")}</Link><p className="mt-1 text-xs text-neutral-500 sm:hidden">{translatedValue(t, "direction", call.direction)} · {call.durationSeconds != null ? formatDuration(call.durationSeconds) : t("notAvailable")}</p></div></div>
              <span className="hidden text-sm text-neutral-600 dark:text-neutral-400 sm:block">{translatedValue(t, "direction", call.direction)}</span>
              <span className="hidden sm:block"><StatusPill tone={statusTone(call.status)}>{translatedValue(t, "status", call.status)}</StatusPill></span>
              <div className="text-right"><p className="text-xs text-neutral-500">{formatDate(call.startedAt, i18n.language)}</p><p className="mt-1 text-xs text-neutral-500 sm:hidden"><StatusPill tone={statusTone(call.status)}>{translatedValue(t, "status", call.status)}</StatusPill></p></div>
            </div>;
          })}
        </div>
      </Card>
    </ResourceMessage>
  </>;
}

type CallDetail = { id: string; caller: string | null; recipient: string | null; direction: string; startedAt: string; endedAt: string | null; durationSeconds: number | null; status: string };

export function HistoryDetailPage() {
  const { t, i18n } = useTranslation("history");
  const { id = "" } = useParams();
  const resource = useResource<{ call: CallDetail }>(`/api/history/${encodeURIComponent(id)}`);
  const call = resource.data?.call;
  const participant = call ? (call.direction === "outgoing" ? call.recipient : call.caller) : null;

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("detailTitle")} detail={call ? `${translatedValue(t, "direction", call.direction)} · ${translatedValue(t, "status", call.status)}` : t("detailDescription")} action={<Link to="/history"><Button variant="secondary"><ArrowLeft size={15} aria-hidden="true" />{t("actions.back")}</Button></Link>} />
    <ResourceMessage loading={resource.loading} error={resource.error ? t("errors.loadDetail", { detail: resource.error }) : null} empty={!resource.loading && !resource.error && !call} emptyTitle={t("empty.detailTitle")} emptyDetail={t("empty.detailDescription")}>
      {call && <Card className="max-w-2xl p-5 sm:p-7"><dl className="grid gap-5 sm:grid-cols-2">
        <div><dt className="text-xs text-neutral-500">{t("fields.participant")}</dt><dd className="mt-1 text-sm">{participant || t("unknownParticipant")}</dd></div>
        <div><dt className="text-xs text-neutral-500">{t("fields.direction")}</dt><dd className="mt-1 text-sm">{translatedValue(t, "direction", call.direction)}</dd></div>
        <div><dt className="text-xs text-neutral-500">{t("fields.status")}</dt><dd className="mt-1 text-sm"><StatusPill tone={statusTone(call.status)}>{translatedValue(t, "status", call.status)}</StatusPill></dd></div>
        <div><dt className="text-xs text-neutral-500">{t("fields.duration")}</dt><dd className="mt-1 text-sm">{call.durationSeconds != null ? formatDuration(call.durationSeconds) : t("notAvailable")}</dd></div>
        <div><dt className="text-xs text-neutral-500">{t("fields.started")}</dt><dd className="mt-1 text-sm">{formatDate(call.startedAt, i18n.language)}</dd></div>
        <div><dt className="text-xs text-neutral-500">{t("fields.ended")}</dt><dd className="mt-1 text-sm">{formatDate(call.endedAt, i18n.language)}</dd></div>
      </dl><div className="mt-6 flex flex-wrap gap-2"><Link to={`/call?number=${encodeURIComponent(call.direction === "outgoing" ? call.recipient || "" : call.caller || "")}`}><Button><PhoneCall size={15} aria-hidden="true" />{t("actions.callAgain")}</Button></Link><Link to={`/records?callId=${encodeURIComponent(call.id)}`}><Button variant="secondary"><FilePlus2 size={15} aria-hidden="true" />{t("actions.createRecord")}</Button></Link></div><p className="mt-4 text-xs leading-5 text-neutral-500">{t("privacyNote")}</p></Card>}
    </ResourceMessage>
  </>;
}
