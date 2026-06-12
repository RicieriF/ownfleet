'use client';

import { useState, useMemo } from 'react';
import { Order, OrderStatus, OrderSource } from '@/types';
import { cn } from '@/lib/utils';
import { isAfter, subDays } from 'date-fns';
import { ProofDrawer } from './proof-drawer';
import { CheckCircle2, MinusCircle } from 'lucide-react';
import { useT, useLocale } from '@/lib/i18n/client';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string, tag: string): string {
  return new Date(iso).toLocaleString(tag, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(startIso: string, endIso: string, hUnit: string, mUnit: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms <= 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}${hUnit} ${String(m).padStart(2, '0')}${mUnit}` : `${m}${mUnit}`;
}

type StatusFilter = 'all' | 'completed' | 'failed' | 'cancelled';
type DateFilter = 'today' | '7d' | '30d';

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Очікує',
  assigned: 'Призначено',
  in_progress: 'У дорозі',
  completed: 'Виконано',
  failed: 'Провалено',
  cancelled: 'Скасовано',
};

const SOURCE_LABELS: Record<OrderSource, string> = {
  manual: 'Вручну',
  poster: 'Poster',
  iiko: 'iiko',
};

function StatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    completed: {
      bg: 'rgba(34,197,94,0.1)',
      color: 'var(--ok)',
      border: 'rgba(34,197,94,0.2)',
    },
    failed: {
      bg: 'rgba(239,68,68,0.1)',
      color: 'var(--bad)',
      border: 'rgba(239,68,68,0.2)',
    },
    cancelled: {
      bg: 'rgba(120,119,110,0.15)',
      color: 'var(--t3)',
      border: 'rgba(120,119,110,0.25)',
    },
  };

  const s = styles[status] ?? styles.cancelled;

  return (
    <span
      className="text-xs font-medium"
      style={{
        padding: '1px 7px',
        borderRadius: '4px',
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {label}
    </span>
  );
}

function SourceBadge({ source }: { source: OrderSource }) {
  if (source === 'manual') return null;
  return (
    <span
      className="text-xs"
      style={{
        padding: '1px 6px',
        borderRadius: '4px',
        background: 'var(--s3)',
        color: 'var(--t4)',
        border: '1px solid var(--br)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {source}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  orders: Order[];
}

function ProofCell({ order, t }: { order: Order; t: (s: string) => string }) {
  if (order.status !== 'completed') {
    return <span style={{ color: 'var(--t4)' }}>—</span>;
  }
  if (!order.delivery) {
    return <MinusCircle size={14} strokeWidth={1.75} style={{ color: 'var(--t4)' }} />;
  }
  // We show a static indicator; actual geo_match fetched on drawer open
  return (
    <span
      className="inline-flex items-center gap-1 text-xs"
      style={{ color: 'var(--t3)' }}
      title={t('Натисніть рядок для перегляду пруфу')}
    >
      <CheckCircle2 size={14} strokeWidth={1.75} />
      {t('Переглянути')}
    </span>
  );
}

export function HistoryTable({ orders }: Props) {
  const t = useT();
  const localeTag = useLocale() === 'uk' ? 'uk-UA' : 'en-GB';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('7d');
  const [proofDeliveryId, setProofDeliveryId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const now = new Date();
    const cutoff =
      dateFilter === 'today'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : dateFilter === '7d'
          ? subDays(now, 7)
          : subDays(now, 30);

    return orders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      const createdAt = new Date(o.created_at);
      return isAfter(createdAt, cutoff);
    });
  }, [orders, statusFilter, dateFilter]);

  const counts = useMemo(() => {
    const now = new Date();
    const cutoff =
      dateFilter === 'today'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : dateFilter === '7d'
          ? subDays(now, 7)
          : subDays(now, 30);

    const inRange = orders.filter((o) => isAfter(new Date(o.created_at), cutoff));
    return {
      all: inRange.length,
      completed: inRange.filter((o) => o.status === 'completed').length,
      failed: inRange.filter((o) => o.status === 'failed').length,
      cancelled: inRange.filter((o) => o.status === 'cancelled').length,
    };
  }, [orders, dateFilter]);

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: `${t('Всі')} (${counts.all})` },
    { key: 'completed', label: `${t('Виконані')} (${counts.completed})` },
    { key: 'failed', label: `${t('Провалені')} (${counts.failed})` },
    { key: 'cancelled', label: `${t('Скасовані')} (${counts.cancelled})` },
  ];

  const DATE_TABS: { key: DateFilter; label: string }[] = [
    { key: 'today', label: t('Сьогодні') },
    { key: '7d', label: t('7 днів') },
    { key: '30d', label: t('30 днів') },
  ];

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {/* Status tabs */}
        <div
          className="flex items-center gap-0.5 rounded-md p-0.5"
          style={{ background: 'var(--s2)', border: '1px solid var(--br)' }}
        >
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded transition-colors',
                statusFilter === key
                  ? 'bg-[var(--s3)] text-[var(--t1)]'
                  : 'text-[var(--t3)] hover:text-[var(--t2)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date tabs */}
        <div
          className="flex items-center gap-0.5 rounded-md p-0.5"
          style={{ background: 'var(--s2)', border: '1px solid var(--br)' }}
        >
          {DATE_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setDateFilter(key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded transition-colors',
                dateFilter === key
                  ? 'bg-[var(--s3)] text-[var(--t1)]'
                  : 'text-[var(--t3)] hover:text-[var(--t2)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--br)', background: 'var(--sf)' }}
      >
        <table className="w-full text-sm">
          <thead style={{ borderBottom: '1px solid var(--br)' }}>
            <tr>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                {t('Замовлення')}
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                {t('Адреса')}
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                {t('Статус')}
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                {t('Курʼєр')}
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                {t('Прийнято')}
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                {t('Завершено')}
              </th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                {t('Тривалість')}
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">
                {t('Пруф')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--br)]">
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-sm text-[var(--t3)]"
                >
                  {t('Замовлень за обраний період немає')}
                </td>
              </tr>
            )}
            {filtered.map((order) => {
              const completedAt = order.delivery?.completed_at;
              const startedAt = order.delivery?.started_at;
              const duration =
                startedAt && completedAt && order.status === 'completed'
                  ? formatDuration(startedAt, completedAt, t('г'), t('хв'))
                  : '—';
              const isClickable = order.status === 'completed' && !!order.delivery;

              return (
                <tr
                  key={order.id}
                  className="hover:bg-[var(--s2)] transition-colors"
                  style={{ cursor: isClickable ? 'pointer' : undefined }}
                  onClick={isClickable ? () => setProofDeliveryId(order.delivery!.id) : undefined}
                >
                  {/* Order ID */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="mono text-xs text-[var(--t3)]">
                        {order.external_id
                          ? `#${order.external_id}`
                          : order.id.slice(0, 8)}
                      </span>
                      <SourceBadge source={order.source} />
                    </div>
                  </td>

                  {/* Address */}
                  <td
                    className="px-3 py-2.5 text-[var(--t2)] max-w-[240px]"
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={order.address}
                  >
                    {order.address}
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2.5">
                    <StatusBadge status={order.status} label={t(STATUS_LABELS[order.status] ?? order.status)} />
                  </td>

                  {/* Courier */}
                  <td className="px-3 py-2.5 text-[var(--t2)]">
                    {order.delivery?.courier?.name ?? (
                      <span className="text-[var(--t4)]">—</span>
                    )}
                  </td>

                  {/* Created at */}
                  <td className="px-3 py-2.5 mono text-xs text-[var(--t4)]">
                    {formatTime(order.created_at, localeTag)}
                  </td>

                  {/* Completed at */}
                  <td className="px-3 py-2.5 mono text-xs text-[var(--t4)]">
                    {completedAt ? formatTime(completedAt, localeTag) : '—'}
                  </td>

                  {/* Duration */}
                  <td className="px-3 py-2.5 text-right mono text-xs text-[var(--t3)]">
                    {duration}
                  </td>

                  {/* Proof */}
                  <td className="px-3 py-2.5">
                    <ProofCell order={order} t={t} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-[var(--t4)] mt-3 text-right mono">
          {filtered.length} {t('замовлень')}
        </p>
      )}

      <ProofDrawer
        deliveryId={proofDeliveryId}
        onClose={() => setProofDeliveryId(null)}
      />
    </div>
  );
}
