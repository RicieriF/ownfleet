/**
 * Dashboard i18n — same zero-dependency approach as the embed widget
 * (src/embed/i18n/translations.ts), adapted for a larger surface.
 *
 * Ukrainian strings ARE the keys. The `en` dictionary maps them to English.
 * A string missing from the dictionary falls back to the key itself, so an
 * untranslated label renders in Ukrainian instead of breaking the UI.
 *
 * Locale is stored in the `of_locale` cookie:
 *  - server components read it via getLocale() (src/lib/i18n/server.ts)
 *  - client components read it via useLocale() (src/lib/i18n/client.tsx)
 */
import { en } from './dict';

export type Locale = 'uk' | 'en';

export const LOCALE_COOKIE = 'of_locale';

export function t(s: string, locale: Locale): string {
  if (locale === 'uk') return s;
  return en[s] ?? s;
}

export function normalizeLocale(value: string | undefined): Locale {
  return value === 'en' ? 'en' : 'uk';
}
