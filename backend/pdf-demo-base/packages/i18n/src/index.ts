import en from "./locales/en.json";

export type LocaleDict = Record<string, string>;
const locales: Record<string, LocaleDict> = { en };
// Adding a language = drop ru.json here and register it. No component changes needed.

export function t(lang: string, key: string, vars: Record<string, string> = {}): string {
  const dict = locales[lang] ?? locales.en;
  const s = dict[key] ?? locales.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export const availableLanguages = Object.keys(locales);
