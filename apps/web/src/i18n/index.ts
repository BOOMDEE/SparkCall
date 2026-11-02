import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export type SupportedLanguage = "en" | "zh";

const LANGUAGE_KEY = "sparkcall.language";
const resources: Record<string, Record<string, unknown>> = {};
const modules = import.meta.glob("./locales/*/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

for (const [path, value] of Object.entries(modules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, language, namespace] = match;
  resources[language] ??= {};
  resources[language][namespace] = value;
}

function detectLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(LANGUAGE_KEY);
  if (stored === "zh" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function applyLanguage(language: SupportedLanguage) {
  if (typeof document !== "undefined") document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_KEY, language);
}

const initialLanguage = detectLanguage();

void i18n
  .use(initReactI18next)
  .init({
    resources: resources as never,
    lng: initialLanguage,
    fallbackLng: "en",
    defaultNS: "common",
    ns: Object.keys(resources.en ?? {}),
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

applyLanguage(initialLanguage);
i18n.on("languageChanged", (language) => {
  const normalized: SupportedLanguage = language.toLowerCase().startsWith("zh") ? "zh" : "en";
  applyLanguage(normalized);
});

export { LANGUAGE_KEY };
export default i18n;
