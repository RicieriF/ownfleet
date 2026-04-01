'use client';

import { useEffect, useRef, useState } from 'react';
import { t, type Locale } from './i18n/translations';

interface Props {
  etaSeconds: number;      // remaining seconds (server-computed)
  slaDeadline: string | null;
  locale: Locale;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function EtaBar({ etaSeconds: initialEta, slaDeadline, locale }: Props) {
  const [remaining, setRemaining] = useState(initialEta);
  // Track baseline per-session for the progress bar fill
  const baselineRef = useRef(initialEta);

  // Sync when server pushes a new etaSeconds (via WS delivery:eta)
  useEffect(() => {
    setRemaining(initialEta);
    // Only update baseline if server sends a higher value (fresh assignment)
    if (initialEta > baselineRef.current) {
      baselineRef.current = initialEta;
    }
  }, [initialEta]);

  // Client-side countdown between WS sync events — single interval for component lifetime
  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const etaMin = Math.ceil(remaining / 60);
  const progress =
    baselineRef.current > 0
      ? Math.min(1, (baselineRef.current - remaining) / baselineRef.current)
      : 0;

  return (
    <div className="flex flex-col gap-1">
      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${progress * 100}%`, backgroundColor: '#3d7a5a' }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          {remaining > 0 ? (
            <>
              <span className="text-sm font-semibold text-gray-800">
                {t('estimatedTime', locale)}: {t('minutes', locale)(etaMin)}
              </span>
              <p className="text-xs text-gray-400 mt-0.5">
                {t('estimatedTimeNote', locale)}
              </p>
            </>
          ) : (
            // etaSeconds hit 0 — don't show a number, keep map
            <span className="text-sm text-gray-500">{t('estimatedTimeNote', locale)}</span>
          )}
        </div>

        {slaDeadline && (
          <p className="text-sm text-gray-600 shrink-0">
            {t('deliveryDeadline', locale)}: <strong>{formatTime(slaDeadline)}</strong>
          </p>
        )}
      </div>
    </div>
  );
}
