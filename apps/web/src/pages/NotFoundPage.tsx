import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ButtonLink } from "../components/ui";
import { SiteFooter } from "../components/SiteFooter";
import { SkipLink } from "../components/common";

export default function NotFoundPage() {
  const { t } = useTranslation("common");
  return <div className="flex min-h-screen flex-col bg-white text-neutral-900 dark:bg-black dark:text-white">
    <SkipLink />
    <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center px-5">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">{t("notFound.eyebrow")}</p>
        <h1 className="mt-3 text-2xl font-semibold">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm text-neutral-500">{t("notFound.detail")}</p>
        <ButtonLink className="mt-5" variant="secondary" to="/"><ArrowLeft size={15} aria-hidden="true" /> {t("notFound.home")}</ButtonLink>
      </div>
    </main>
    <SiteFooter />
  </div>;
}
