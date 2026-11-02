import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Clock3, Mic, Phone } from "lucide-react";
import { api, type Me } from "../lib/api";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { SiteFooter } from "../components/SiteFooter";
import { Button, Notice } from "../components/ui";

export default function LandingPage() {
  const { t } = useTranslation("landing");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tryAsGuest() {
    setBusy(true);
    setError(null);
    try {
      await api<Me>("/api/auth/guest", { method: "POST" });
      navigate("/dashboard");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : undefined;
      setError(t("errors.temporaryAccount", { detail: detail || t("errors.unknown") }));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-neutral-950 dark:bg-black dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label={t("brand.homeLabel")} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-md bg-neutral-900 text-white dark:bg-white dark:text-black">
              <Phone size={14} strokeWidth={1.8} />
            </span>
            SparkCall
          </Link>
          <div className="flex items-center gap-3 sm:gap-5">
            <LanguageSwitcher />
            <nav aria-label={t("navigation.label")} className="flex items-center gap-1">
              <Link to="/login">
                <Button variant="ghost">{t("navigation.signIn")}</Button>
              </Link>
              <Link to="/register">
                <Button>
                  {t("navigation.createAccount")}
                  <ArrowRight size={15} aria-hidden="true" />
                </Button>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1200px] px-4 pb-20 pt-20 sm:px-6 sm:pb-28 sm:pt-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end lg:gap-24">
          <div>
            <p className="mb-6 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
              <span aria-hidden="true" className="h-px w-6 bg-neutral-400 dark:bg-neutral-600" />
              {t("eyebrow")}
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-6xl sm:leading-[1.05]">{t("title")}</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-neutral-500 dark:text-neutral-400">{t("description")}</p>

            {error && (
              <div className="mt-6 max-w-xl">
                <Notice>{error}</Notice>
              </div>
            )}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/register" className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto">
                  {t("actions.createAccount")}
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </Link>
              <Button variant="secondary" disabled={busy} onClick={() => void tryAsGuest()} className="w-full sm:w-auto">
                {busy ? t("actions.starting") : t("actions.temporaryAccount")}
              </Button>
            </div>
          </div>

          <aside aria-labelledby="landing-details-title" className="border-t border-neutral-200 pt-5 dark:border-neutral-800">
            <h2 id="landing-details-title" className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">{t("details.label")}</h2>
            <dl className="mt-5 divide-y divide-neutral-200 dark:divide-neutral-800">
              <div className="flex gap-3 py-4 first:pt-0">
                <Mic size={17} className="mt-0.5 shrink-0 text-neutral-500" aria-hidden="true" />
                <div>
                  <dt className="text-sm font-medium">{t("details.browser.title")}</dt>
                  <dd className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">{t("details.browser.detail")}</dd>
                </div>
              </div>
              <div className="flex gap-3 py-4">
                <Clock3 size={17} className="mt-0.5 shrink-0 text-neutral-500" aria-hidden="true" />
                <div>
                  <dt className="text-sm font-medium">{t("details.temporary.title")}</dt>
                  <dd className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">{t("details.temporary.detail")}</dd>
                </div>
              </div>
            </dl>
          </aside>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
