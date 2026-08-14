import en from "./locales/en.json";
import uk from "./locales/uk.json";
import pl from "./locales/pl.json";
import ru from "./locales/ru.json";

export type LocaleDict = Record<string, string>;
const locales: Record<string, LocaleDict> = { en, uk, pl, ru };
// Adding a language = drop a json here and register it. No component changes needed.

export function t(lang: string, key: string, vars: Record<string, string> = {}): string {
  const dict = locales[lang] ?? locales.en;
  const s = dict[key] ?? locales.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export const availableLanguages = Object.keys(locales);
