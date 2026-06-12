import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale, type Locale } from './index';

/** Locale for server components, read from the of_locale cookie. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}
