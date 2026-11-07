import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type Me } from "../lib/api";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { BrandLink } from "../components/BrandLink";
import { SiteFooter } from "../components/SiteFooter";
import { Button, Field, Notice } from "../components/ui";
import { SkipLink } from "../components/common";
import { useSiteConfiguration } from "../contexts/SiteConfiguration";

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { t } = useTranslation("auth");
  const siteConfiguration = useSiteConfiguration();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLogin = mode === "login";
  const copy = isLogin ? "login" : "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<Me>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ username, password, ...(isLogin ? {} : { displayName: displayName || username }) }),
      });
      navigate(destination, { replace: true });
    } catch (cause) {
      const detail = cause instanceof Error && cause.message ? cause.message : t("errors.unknown");
      setError(t(`errors.${isLogin ? "login" : "register"}`, {
        detail: t("errors.serverContext", { detail }),
      }));
      setBusy(false);
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="sc-auth flex min-h-screen flex-col bg-white text-neutral-950 dark:bg-black dark:text-neutral-100">
      <SkipLink />
      <header className="sc-public-header border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <BrandLink to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight" markClassName="grid h-6 w-6 place-items-center rounded-md bg-neutral-900 text-white dark:bg-white dark:text-black" iconSize={13} filled />
          <LanguageSwitcher />
        </div>
      </header>

      <div className="flex flex-1 items-center px-4 py-10 sm:px-6 sm:py-14">
        <div className="mx-auto grid w-full max-w-[960px] gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center lg:gap-24">
          <section className="max-w-xl">
            <Link to="/" className="inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-neutral-950 dark:hover:text-white">
              <ArrowLeft size={15} aria-hidden="true" />
              {t("navigation.backToSparkCall")}
            </Link>
            <p className="mt-10 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
              <span aria-hidden="true" className="h-px w-6 bg-neutral-400 dark:bg-neutral-600" />
              {t("eyebrow")}
            </p>
            <h1 className="sc-auth-title mt-5 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{t(`${copy}.title`)}</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-neutral-500 dark:text-neutral-400">{t(`${copy}.detail`)}</p>

            <section className="sc-auth-card mt-8 rounded-md border border-neutral-200 p-5 dark:border-neutral-800 sm:p-6" aria-labelledby="auth-form-title">
              <h2 id="auth-form-title" className="sr-only">{t(`${copy}.title`)}</h2>
              {error && <div className="mb-5"><Notice>{error}</Notice></div>}
              <form onSubmit={(event) => void submit(event)} className="space-y-4">
                <Field
                  label={t("fields.username")}
                  aria-label={t("fields.username")}
                  spellCheck={false}
                  placeholder={t("fields.usernamePlaceholder")}
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={32}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                {!isLogin && (
                  <Field
                    label={t("fields.displayName")}
                    aria-label={t("fields.displayName")}
                    autoComplete="nickname"
                    maxLength={80}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder={t("fields.displayNamePlaceholder")}
                  />
                )}
                <Field
                  label={t("fields.password")}
                  aria-label={t("fields.password")}
                  placeholder={t("fields.passwordPlaceholder")}
                  type="password"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                  minLength={isLogin ? 1 : 12}
                  maxLength={200}
                  value={password}
                  aria-describedby={!isLogin ? "password-hint" : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {!isLogin && <p id="password-hint" className="-mt-2 text-xs leading-5 text-neutral-500">{t("fields.passwordHint")}</p>}
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? t("actions.waiting") : t(`${copy}.submit`)}
                  {!busy && <ArrowRight size={15} aria-hidden="true" />}
                </Button>
              </form>
              <p className="mt-5 border-t border-neutral-200 pt-5 text-center text-sm text-neutral-500 dark:border-neutral-800">
                {t(`${copy}.switchPrompt`)}{" "}
                <Link className="font-medium text-neutral-950 underline underline-offset-4 hover:no-underline dark:text-white" to={isLogin ? "/register" : "/login"} aria-label={t(`${copy}.switchLabel`)}>
                  {t(`${copy}.switchAction`)}
                </Link>
              </p>
            </section>
          </section>

          {siteConfiguration.temporaryAccounts.enabled && <aside className="border-t border-neutral-200 pt-5 dark:border-neutral-800 lg:border-l lg:border-t-0 lg:pl-8" aria-labelledby="temporary-title">
            <h2 id="temporary-title" className="text-sm font-medium">{t("temporary.title")}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">{t("temporary.detail", { lifetimeHours: siteConfiguration.temporaryAccounts.lifetimeHours })}</p>
            <Link to="/" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-neutral-950 underline underline-offset-4 hover:no-underline dark:text-white" aria-label={t("temporary.action")}>
              {t("actions.tryTemporary")}
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </aside>}
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
