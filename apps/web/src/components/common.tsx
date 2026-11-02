import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Empty, Notice } from "./ui";

export function PageHeader({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div>{eyebrow && <p className="mb-2 text-xs font-medium uppercase tracking-widest text-neutral-500">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {detail && <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">{detail}</p>}
    </div>{action}
  </div>;
}

export function ResourceState({ loading, error, empty, children, emptyTitle = "Nothing here yet", emptyDetail = "Data will appear once there is activity." }: {
  loading: boolean; error: string | null; empty?: boolean; children: ReactNode; emptyTitle?: string; emptyDetail?: string;
}) {
  if (loading) return <div className="py-8 text-sm text-neutral-500" role="status">Loading…</div>;
  if (error) return <Notice>{error}</Notice>;
  if (empty) return <Empty title={emptyTitle} detail={emptyDetail} />;
  return <>{children}</>;
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "error" }) {
  const tones = {
    neutral: "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400",
    success: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400",
    warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400",
    error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

export function AuthPrompt() {
  return <div className="space-y-4"><Notice>Your session is not authenticated.</Notice><Link to="/login"><Button>Sign in</Button></Link></div>;
}
