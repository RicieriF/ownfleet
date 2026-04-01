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

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={manrope.variable}>
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
