import { useState, type FormEvent } from "react";
import { Ban, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useResource } from "../hooks/useResource";
import { formatDate } from "../lib/format";
import { PageHeader } from "../components/common";
import { Button, Card, Empty, Field, Notice } from "../components/ui";

type BlockedItem = { id: string; number: string; display_name: string; created_at: string };

export default function BlockedPage() {
  const { t, i18n } = useTranslation("blocked");
  const resource = useResource<BlockedItem[]>("/api/blocked");
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  async function block(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api("/api/blocked", { method: "POST", body: JSON.stringify({ number }) });
      setNumber("");
      setSuccess(t("notices.blocked"));
      resource.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("notices.blockFallback"));
    } finally {
      setSubmitting(false);
    }
  }

  async function unblock(item: BlockedItem) {
    setError(null);
    setSuccess(null);
    setUnblockingId(item.id);
    try {
      await api("/api/blocked", { method: "DELETE", body: JSON.stringify({ number: item.number }) });
      setSuccess(t("notices.unblocked"));
      resource.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("notices.unblockFallback"));
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} detail={t("description")} />

      <div className="mb-5">
        <Notice tone="neutral">{t("notices.security")}</Notice>
      </div>

      <Card className="mb-6 p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold">{t("form.title")}</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500">{t("form.detail")}</p>
        </div>
        <form onSubmit={(event) => void block(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full max-w-sm">
            <Field
              label={t("form.label")}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder={t("form.placeholder")}
              maxLength={32}
              required
              disabled={submitting}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={!number.trim() || submitting} aria-busy={submitting}>
            <Ban size={15} aria-hidden="true" />
            {submitting ? t("form.submitting") : t("form.submit")}
          </Button>
        </form>
      </Card>

      {error && (
        <div className="mb-4">
          <Notice>{error}</Notice>
        </div>
      )}
      {success && (
        <div className="mb-4">
          <Notice tone="success">{success}</Notice>
        </div>
      )}

      <section aria-labelledby="blocked-list-title">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="blocked-list-title" className="text-sm font-semibold">{t("list.title")}</h2>
          {resource.data && <span className="text-xs text-neutral-500">{t("list.count", { count: resource.data.length })}</span>}
        </div>

        {resource.loading && <div className="border-y border-neutral-200 py-8 text-sm text-neutral-500 dark:border-neutral-800" role="status" aria-live="polite">{t("states.loading")}</div>}
        {!resource.loading && resource.error && <Notice>{resource.error || t("states.loadError")}</Notice>}
        {!resource.loading && !resource.error && !resource.data?.length && <Empty title={t("empty.title")} detail={t("empty.detail")} />}
        {!resource.loading && !resource.error && !!resource.data?.length && (
          <Card>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-900">
              {resource.data.map((item) => {
                const name = item.display_name || item.number;
                const isUnblocking = unblockingId === item.id;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        <span>{item.number}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{t("list.blockedOn", { date: formatDate(item.created_at, i18n.language) })}</span>
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="shrink-0"
                      onClick={() => void unblock(item)}
                      disabled={unblockingId !== null}
                      aria-label={t("list.unblockLabel", { name })}
                      aria-busy={isUnblocking}
                    >
                      <ShieldCheck size={15} aria-hidden="true" />
                      {isUnblocking ? t("list.unblocking") : t("list.unblock")}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </section>
    </>
  );
}
