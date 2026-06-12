import en from './en.json';
import es from './es.json';

/** i18n con cadenas externalizadas (UI-05): añadir un idioma = añadir un JSON. */

const locales: Record<string, Record<string, string>> = { es, en };

let strings: Record<string, string> = es;
let currentLocale = 'es';

export function initI18n(locale: string): void {
  const lang = locale.split('-')[0] ?? 'en';
  strings = locales[lang] ?? locales['en']!;
  currentLocale = locale;
}

export function t(key: string, params?: Record<string, string | number>): string {
  let out = strings[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) out = out.replace(`{${k}}`, String(v));
  }
  return out;
}

export function locale(): string {
  return currentLocale;
}
