'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { LOCALE_COOKIE, t, type Locale } from './index';

/**
 * Locale context for client components.
 *
 * The value is read from the of_locale cookie ON THE SERVER (root layout)
 * and passed down through this provider. Client components must NOT read
 * document.cookie directly: during SSR of client components `document` is
 * undefined, which would force a 'uk' fallback and cause hydration
 * mismatches whenever the cookie says 'en'.
 */
const LocaleContext = createContext<Locale>('uk');

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Convenience hook: returns a bound translate function. */
export function useT(): (s: string) => string {
  const locale = useLocale();
  return (s: string) => t(s, locale);
}

export function setLocale(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  // Full reload so server components re-render with the new cookie.
  window.location.reload();
}

/** Compact UK/EN toggle for the sidebar footer. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const other: Locale = locale === 'uk' ? 'en' : 'uk';
  return (
    <button
      type="button"
      onClick={() => setLocale(other)}
      className="text-[11px] font-semibold tracking-[0.05em] uppercase text-[var(--t4)] hover:text-[var(--t2)] transition-colors"
      title={locale === 'uk' ? 'Switch to English' : 'Перемкнути на українську'}
    >
      {locale === 'uk' ? 'EN' : 'UK'}
    </button>
  );
}
