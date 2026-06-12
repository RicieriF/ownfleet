import type { Metadata } from 'next';
import { Manrope, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { LocaleProvider } from '@/lib/i18n/client';

const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: t('OwnFleet — Управління доставкою', locale),
    description: t('Платформа управління курʼєрами для закладів доставки', locale),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
