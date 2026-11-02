// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import i18n, { LANGUAGE_KEY } from "./index";

const namespaces = (language: "en" | "zh") => Object.keys(i18n.getDataByLanguage(language) ?? {}).sort();

afterEach(async () => {
  window.localStorage.removeItem(LANGUAGE_KEY);
  await i18n.changeLanguage("en");
});

describe("i18n contract", () => {
  it("keeps namespace keys in parity between supported languages", () => {
    expect(namespaces("zh")).toEqual(namespaces("en"));
    expect(namespaces("en")).toContain("common");
  });

  it("persists language changes and updates the document language", async () => {
    await i18n.changeLanguage("zh");
    expect(window.localStorage.getItem(LANGUAGE_KEY)).toBe("zh");
    expect(document.documentElement.lang).toBe("zh-CN");
    await i18n.changeLanguage("en");
    expect(window.localStorage.getItem(LANGUAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
