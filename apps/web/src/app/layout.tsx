import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'Weego CMI — Управління доставкою',
  description: 'Платформа управління курʼєрами для закладів доставки',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
