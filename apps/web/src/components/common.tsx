import type { ReactNode } from "react";
import { ButtonLink, Empty, Notice } from "./ui";
import { useTranslation } from "react-i18next";

export function SkipLink({ targetId = "main-content" }: { targetId?: string }) {
  const { t } = useTranslation("common");
  return <a className="sc-skip-link" href={`#${targetId}`}>{t("actions.skipToMain")}</a>;
}

export function PageHeader({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="sc-page-header mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div className="min-w-0">{eyebrow && <p className="mb-2 text-xs font-medium uppercase tracking-[.14em] text-neutral-500">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.8rem]">{title}</h1>
      {detail && <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">{detail}</p>}
    </div>{action}
  </div>;
}

export function ContentContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1200px] ${className}`}>{children}</div>;
}

export function ResourceState({ loading, error, empty, children, emptyTitle, emptyDetail }: {
  loading: boolean; error: string | null; empty?: boolean; children: ReactNode; emptyTitle?: string; emptyDetail?: string;
}) {
  const { t } = useTranslation("common");
  if (loading) return <div className="py-8 text-sm text-neutral-500" role="status" aria-live="polite">{t("resource.loading")}</div>;
  if (error) return <Notice>{error}</Notice>;
  if (empty) return <Empty title={emptyTitle || t("resource.emptyTitle")} detail={emptyDetail || t("resource.emptyDetail")} />;
  return <>{children}</>;
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "error" }) {
  const tones = {
    neutral: "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400",
    success: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400",
    warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400",
    error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400",
  };
  return <span className={`sc-status-pill inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

export function AuthPrompt() {
  const { t } = useTranslation("common");
  return <div className="space-y-4"><Notice>{t("authPrompt.notAuthenticated")}</Notice><ButtonLink to="/login">{t("authPrompt.signIn")}</ButtonLink></div>;
}
