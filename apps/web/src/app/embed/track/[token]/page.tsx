/**
 * Server component: fetches the initial snapshot from the public API.
 * The heavy lifting (WebSocket, real-time updates, state machine) happens
 * inside TrackWidget (client component).
 */
import { TrackWidget } from '@/embed/TrackWidget';
import type { TrackSnapshot } from '@/embed/types';
import { t } from '@/embed/i18n/translations';
import type { Locale } from '@/embed/i18n/translations';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

async function getSnapshot(token: string): Promise<TrackSnapshot | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/public/track/${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as TrackSnapshot;
  } catch {
    return null;
  }
}

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function EmbedTrackPage({ params }: PageProps) {
  const { token } = await params;
  const snapshot = await getSnapshot(token);
  const locale = (snapshot?.locale as Locale | undefined) ?? 'uk';

  // Token not found or expired on initial load — show static message
  if (!snapshot) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-base font-semibold text-gray-700">
            {t('orderNotFound', locale)}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {t('orderNotFoundNote', locale)}
          </p>
        </div>
      </main>
    );
  }

  // Detect standalone mode (hosted page, not iframe) at runtime — passed to widget via data attr
  // The actual detection happens client-side via window.self !== window.top inside TrackWidget.
  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col">
      {/* Establishment header — standalone only (shown by TrackWidget header) */}
      <TrackWidget token={token} initialSnapshot={snapshot} />
    </main>
  );
}
