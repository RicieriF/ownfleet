/**
 * Embed track layout — light theme.
 * Intentionally outside (dashboard) group: no sidebar, no dark theme,
 * no auth requirement. CSP headers set in middleware.ts.
 */
import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';

const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Відстеження замовлення',
};

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

/** Lightweight locale-only fetch — only reads locale field from snapshot. */
async function getSnapshotLocale(token: string): Promise<string> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/public/track/${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return 'uk';
    const data = (await res.json()) as { locale?: string } | null;
    return data?.locale ?? 'uk';
  } catch {
    return 'uk';
  }
}

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}

export default async function EmbedLayout({ children, params }: LayoutProps) {
  const { token } = await params;
  const lang = await getSnapshotLocale(token);

  return (
    <html lang={lang} className={manrope.variable}>
      <body
        style={{
          margin: 0,
          padding: 0,
          background: '#ffffff',
          fontFamily: 'var(--font-manrope), system-ui, sans-serif',
          fontSize: '14px',
          lineHeight: '1.5',
          WebkitFontSmoothing: 'antialiased',
          // Explicit light mode — no dark-mode class from root layout
          colorScheme: 'light',
        }}
      >
        {children}
      </body>
    </html>
  );
}
