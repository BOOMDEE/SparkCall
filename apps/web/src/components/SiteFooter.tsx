import { useTranslation } from "react-i18next";

export function SiteFooter({ className = "" }: { className?: string }) {
  const { t } = useTranslation("common");
  return <footer className={`border-t border-neutral-200 px-4 py-5 text-xs text-neutral-500 dark:border-neutral-800 ${className}`}>
    <div className="mx-auto flex max-w-[1200px] flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <span>{t("footer.license")}</span>
      <span>{t("footer.attribution")}</span>
    </div>
  </footer>;
}
