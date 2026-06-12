'use client';

import { useEffect, useState, useCallback } from 'react';
import { DeliveryProof, GeoFlags } from '@/types';
import { apiGet } from '@/lib/api-client';
import { X, CheckCircle2, XCircle, MinusCircle, MapPin, Camera, AlertTriangle } from 'lucide-react';
import { useT, useLocale } from '@/lib/i18n/client';

interface Props {
  deliveryId: string | null;
  onClose: () => void;
}

function formatTs(iso: string, tag: string): string {
  return new Date(iso).toLocaleString(tag, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function GeoMatchBadge({ match, flags, t }: { match: boolean; flags: GeoFlags; t: (s: string) => string }) {
  if (flags.force_closed) {
    return (
      <div className="flex items-center gap-2" style={{ color: 'var(--warn)' }}>
        <AlertTriangle size={20} strokeWidth={1.75} />
        <span className="text-sm font-medium">{t('Закрито менеджером (без гео-підтвердження)')}</span>
      </div>
    );
  }
  if (flags.no_destination_coords) {
    return (
      <div className="flex items-center gap-2" style={{ color: 'var(--t3)' }}>
        <MinusCircle size={20} strokeWidth={1.75} />
        <span className="text-sm font-medium">{t('Неможливо перевірити (адреса без координат)')}</span>
      </div>
    );
  }
  return match ? (
    <div className="flex items-center gap-2" style={{ color: 'var(--ok)' }}>
      <CheckCircle2 size={20} strokeWidth={1.75} />
      <span className="text-sm font-medium">{t('Геопозиція підтверджена (≤ 300 м)')}</span>
    </div>
  ) : (
    <div className="flex items-center gap-2" style={{ color: 'var(--bad)' }}>
      <XCircle size={20} strokeWidth={1.75} />
      <span className="text-sm font-medium">{t('Геопозиція не співпала (> 300 м)')}</span>
    </div>
  );
}

function AnomalyFlags({ flags, t }: { flags: GeoFlags; t: (s: string) => string }) {
  const items: string[] = [];
  if (flags.proof_after_close) items.push(t('Пруф отримано після закриття замовлення в POS'));
  if (flags.low_accuracy) items.push(t('Низька точність GPS (> 100 м)'));

  if (items.length === 0) return null;

  return (
    <div
      className="rounded-md px-3 py-2.5"
      style={{
        background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.2)',
      }}
    >
      <p
        className="text-xs font-semibold uppercase tracking-[0.05em] mb-1.5"
        style={{ color: 'var(--warn)' }}
      >
        {t('Аномалії')}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item} className="text-xs" style={{ color: 'var(--warn)' }}>
            · {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProofDrawer({ deliveryId, onClose }: Props) {
  const t = useT();
  const localeTag = useLocale() === 'uk' ? 'uk-UA' : 'en-GB';
  const [proof, setProof] = useState<DeliveryProof | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const fetchProof = useCallback(async (id: string) => {
    setProof(undefined);
    setError(null);
    try {
      const data = await apiGet<DeliveryProof | null>(`/api/v1/deliveries/${id}/proof`);
      setProof(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Помилка завантаження'));
      setProof(null);
    }
  }, []);

  useEffect(() => {
    if (deliveryId) {
      void fetchProof(deliveryId);
    }
  }, [deliveryId, fetchProof]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!deliveryId) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.72)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
        style={{
          width: '420px',
          background: 'var(--sf)',
          borderLeft: '1px solid var(--br)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.40), 0 0 0 0.5px rgba(250,249,246,0.06)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--br)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>
            {t('Доказ доставки')}
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded transition-colors"
            style={{
              width: '28px',
              height: '28px',
              color: 'var(--t3)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--s2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Loading */}
          {proof === undefined && !error && (
            <div
              className="flex items-center justify-center py-12 text-sm"
              style={{ color: 'var(--t4)' }}
            >
              {t('Завантаження…')}
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="rounded-md px-4 py-3 text-sm"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: 'var(--bad)',
              }}
            >
              {error}
            </div>
          )}

          {/* No proof */}
          {proof === null && !error && (
            <div
              className="flex flex-col items-center justify-center py-12 text-sm gap-2"
              style={{ color: 'var(--t4)' }}
            >
              <MinusCircle size={24} strokeWidth={1.5} />
              <span>{t('Доказ доставки відсутній')}</span>
            </div>
          )}

          {/* Proof details */}
          {proof && (
            <>
              {/* Geo match status */}
              <div
                className="rounded-md px-4 py-3"
                style={{ background: 'var(--s2)', border: '1px solid var(--br)' }}
              >
                <GeoMatchBadge match={proof.geo_match} flags={proof.geo_flags} t={t} />
              </div>

              {/* Anomaly flags */}
              <AnomalyFlags flags={proof.geo_flags} t={t} />

              {/* Details grid */}
              <div
                className="rounded-md overflow-hidden"
                style={{ border: '1px solid var(--br)' }}
              >
                <Row
                  label={t('Зафіксовано')}
                  value={formatTs(proof.captured_at, localeTag)}
                  mono
                />
                <Row
                  label={t('Координати')}
                  value={`${proof.lat.toFixed(6)}, ${proof.lng.toFixed(6)}`}
                  mono
                />
                {proof.accuracy !== null && (
                  <Row
                    label={t('Точність GPS')}
                    value={`±${Math.round(proof.accuracy)} ${t('м')}`}
                    mono
                  />
                )}
              </div>

              {/* Open in maps */}
              {!proof.geo_flags.force_closed && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${proof.lat}&mlon=${proof.lng}&zoom=17`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm transition-colors"
                  style={{ color: 'var(--t3)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--t1)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--t3)')}
                >
                  <MapPin size={14} strokeWidth={1.75} />
                  {t('Відкрити на карті')}
                </a>
              )}

              {/* Photo */}
              {proof.photo_url ? (
                <div>
                  <p
                    className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.05em] mb-2"
                    style={{ color: 'var(--t4)' }}
                  >
                    <Camera size={12} strokeWidth={1.75} />
                    {t('Фото доставки')}
                  </p>
                  <a
                    href={proof.photo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-md overflow-hidden"
                    style={{ border: '1px solid var(--br)' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proof.photo_url}
                      alt={t('Фото доставки')}
                      className="w-full object-cover"
                      style={{ maxHeight: '300px' }}
                    />
                  </a>
                  <p className="text-xs mt-1" style={{ color: 'var(--t4)' }}>
                    {t('Посилання дійсне 5 хвилин')}
                  </p>
                </div>
              ) : (
                <div
                  className="flex items-center gap-2 rounded-md px-4 py-3 text-sm"
                  style={{
                    background: 'var(--s2)',
                    border: '1px solid var(--br)',
                    color: 'var(--t4)',
                  }}
                >
                  <Camera size={14} strokeWidth={1.75} />
                  {t('Фото не надане')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 border-b last:border-b-0"
      style={{ borderColor: 'var(--br)', background: 'var(--sf)' }}
    >
      <span
        style={{
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--t4)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: '13px',
          color: 'var(--t2)',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}
