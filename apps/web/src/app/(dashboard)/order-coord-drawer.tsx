'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Order } from '@/types';
import { apiPatch } from '@/lib/api-client';
import { useRouter } from 'next/navigation';

// ── Geo helpers ───────────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(m: number): string {
  if (m < 50) return 'менше 50 м';
  if (m < 1000) return `~${Math.round(m / 50) * 50} м`;
  return `~${(m / 1000).toFixed(1)} км`;
}

// Dynamic import: Leaflet requires browser APIs (window, document)
const CoordMap = dynamic(
  () => import('./coord-map').then((m) => m.CoordMap),
  { ssr: false, loading: () => <div style={{ height: 260, background: 'var(--s2)', borderRadius: 6, border: '1px solid var(--br)' }} /> },
);

interface Props {
  order: Order | null;
  onClose: () => void;
  /** Called after successful coordinate save so the parent can update in-place */
  onSaved?: (orderId: string, lat: number, lng: number) => void;
}

const DEFAULT_LAT = 50.45; // Kyiv fallback when order has no coords yet
const DEFAULT_LNG = 30.52;

export function OrderCoordDrawer({ order, onClose, onSaved }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lat, setLat] = useState(order?.lat ?? DEFAULT_LAT);
  const [lng, setLng] = useState(order?.lng ?? DEFAULT_LNG);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  // Sync coords when the order prop changes (different order opened, or WS update)
  useEffect(() => {
    if (!order) return;
    setLat(order.lat ?? DEFAULT_LAT);
    setLng(order.lng ?? DEFAULT_LNG);
    setSaveError('');
    setSaved(false);
  }, [order?.id, order?.lat, order?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMarkerDrag = useCallback((newLat: number, newLng: number) => {
    setLat(newLat);
    setLng(newLng);
    setSaved(false);
  }, []);

  async function handleSave() {
    if (!order) return;
    setSaveError('');
    try {
      await apiPatch(`/api/v1/orders/${order.id}/coordinates`, { lat, lng });
      setSaved(true);
      onSaved?.(order.id, lat, lng);
      startTransition(() => router.refresh());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Помилка збереження');
    }
  }

  const hasCoords = order?.lat != null && order?.lng != null;
  const coordsChanged =
    order != null &&
    (Math.abs((order.lat ?? DEFAULT_LAT) - lat) > 0.000001 ||
      Math.abs((order.lng ?? DEFAULT_LNG) - lng) > 0.000001);

  // ── Displacement hint ─────────────────────────────────────────────────────
  // Shown as soon as the manager drags the pin, giving context before they save.
  const displacementHint: { text: string; level: 'info' | 'warn' | 'danger' } | null =
    (() => {
      if (!order || !coordsChanged) return null;

      // Order had no auto-geocoded coordinates — this is a fresh manual placement
      if (!hasCoords) {
        return {
          text: `Координати встановлюються вручну. Переконайтесь, що шпилька стоїть точно на адресі доставки.`,
          level: 'info',
        };
      }

      // Order already had coordinates — show how far the new pin is from the original
      const dist = haversineM(order.lat!, order.lng!, lat, lng);
      const distText = formatDist(dist);

      if (dist < 50) {
        return {
          text: `Невелике уточнення позиції (${distText} від розрахованої точки).`,
          level: 'info',
        };
      }
      if (dist < 500) {
        return {
          text: `Зміщення від розрахованої точки: ${distText}. Переконайтесь, що шпилька стоїть на правильній будівлі.`,
          level: 'info',
        };
      }
      if (dist < 5000) {
        return {
          text: `Нова точка на ${distText} від розрахованої. Впевнені, що це правильна адреса?`,
          level: 'warn',
        };
      }
      return {
        text: `Нова точка на ${distText} від розрахованої — значне відхилення. Ще раз перевірте адресу «${order.address}» перед збереженням.`,
        level: 'danger',
      };
    })();

  if (!order) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
        style={{
          width: '420px',
          background: 'var(--sf)',
          borderLeft: '1px solid var(--br2)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--br)' }}
        >
          <div>
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.01em' }}>
              Координати замовлення
            </p>
            <p
              className="truncate mt-0.5"
              style={{ fontSize: '12px', color: 'var(--t3)', maxWidth: '320px' }}
            >
              {order.address}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              color: 'var(--t3)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 18,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--t1)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--t3)'; }}
            aria-label="Закрити"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Geo status badge */}
          {!hasCoords && (
            <div
              className="px-3 py-2.5 rounded-md text-sm"
              style={{
                background: 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.25)',
                borderLeft: '3px solid var(--warn)',
                color: 'var(--t2)',
                fontSize: '13px',
              }}
            >
              Координати ще не визначені — геокодування в процесі. Ви можете поставити шпильку вручну.
            </div>
          )}

          {/* Map */}
          <CoordMap
            lat={lat}
            lng={lng}
            onChange={handleMarkerDrag}
            readonly={isPending}
          />

          {/* Coordinate display */}
          <div
            className="flex gap-3"
            style={{ fontSize: '12px' }}
          >
            <div className="flex-1">
              <p style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Широта
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--t2)' }}>
                {lat.toFixed(6)}
              </p>
            </div>
            <div className="flex-1">
              <p style={{ color: 'var(--t4)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Довгота
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--t2)' }}>
                {lng.toFixed(6)}
              </p>
            </div>
          </div>

          {/* Displacement hint — appears as soon as pin moves */}
          {displacementHint && (() => {
            const colors = {
              info:   { bg: 'rgba(255,255,255,0.04)', border: 'var(--br)', left: 'var(--t4)', text: 'var(--t3)' },
              warn:   { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)', left: 'var(--warn)', text: 'var(--t2)' },
              danger: { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',  left: 'var(--bad)',  text: 'var(--t2)' },
            }[displacementHint.level];
            return (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderLeft: `3px solid ${colors.left}`,
                  fontSize: '12px',
                  color: colors.text,
                  lineHeight: 1.5,
                }}
              >
                {displacementHint.text}
              </div>
            );
          })()}

          <p style={{ fontSize: '12px', color: 'var(--t4)' }}>
            Перетягніть шпильку на карті, щоб скоригувати точку доставки.
          </p>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-4 shrink-0 flex flex-col gap-2"
          style={{ borderTop: '1px solid var(--br)' }}
        >
          {saveError && (
            <p style={{ fontSize: '13px', color: 'var(--bad)' }}>{saveError}</p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              style={{
                padding: '7px 16px',
                fontSize: '13px',
                borderRadius: '6px',
                background: 'var(--s2)',
                color: 'var(--t3)',
                border: '1px solid var(--br)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.background = 'var(--s3)';
                el.style.color = 'var(--t1)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.background = 'var(--s2)';
                el.style.color = 'var(--t3)';
              }}
            >
              Закрити
            </button>
            <button
              onClick={handleSave}
              disabled={isPending || saved || !coordsChanged}
              style={{
                padding: '7px 16px',
                fontSize: '13px',
                fontWeight: 500,
                borderRadius: '6px',
                background: saved ? 'var(--acm-m)' : 'var(--acm)',
                color: 'var(--t1)',
                border: `1px solid ${saved ? 'var(--acm-b)' : 'var(--acm-b)'}`,
                cursor: isPending || !coordsChanged ? 'not-allowed' : 'pointer',
                opacity: isPending || (!coordsChanged && !saved) ? 0.5 : 1,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--acm-h)';
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = saved ? 'var(--acm-m)' : 'var(--acm)';
              }}
            >
              {isPending ? 'Збереження…' : saved ? '✓ Збережено' : 'Зберегти'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
