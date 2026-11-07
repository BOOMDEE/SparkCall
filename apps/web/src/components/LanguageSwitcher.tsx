import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { applyLanguage, type SupportedLanguage } from "../i18n";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { i18n, t } = useTranslation("common");
  const language: SupportedLanguage = i18n.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  const label = t("languageLabel");
  function change(next: SupportedLanguage) {
    applyLanguage(next);
    void i18n.changeLanguage(next);
  }
  return <label className={`inline-flex items-center gap-1.5 text-xs text-neutral-500 ${className}`}>
    <Languages size={14} aria-hidden="true" />
    <span className="sr-only">{label}</span>
    <select name="language" autoComplete="off" aria-label={label} value={language} onChange={(event) => change(event.target.value as SupportedLanguage)} className="sc-language-select focus-ring cursor-pointer bg-transparent outline-none">
      <option value="en">EN</option><option value="zh">中文</option>
    </select>
  </label>;
}
