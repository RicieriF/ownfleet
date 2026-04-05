'use client';

import { useState, useTransition, useEffect } from 'react';
import { Order, OrderStatus, CourierWithStatus } from '@/types';
import { apiPost, apiPatch } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';

function EtaTimer({ etaSeconds, etaStartedAt }: { etaSeconds: number; etaStartedAt: string }) {
  const [remaining, setRemaining] = useState<number>(() => {
    const elapsed = (Date.now() - new Date(etaStartedAt).getTime()) / 1000;
    return Math.round(etaSeconds - elapsed);
  });

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = (Date.now() - new Date(etaStartedAt).getTime()) / 1000;
      setRemaining(Math.round(etaSeconds - elapsed));
    }, 1000);
    return () => clearInterval(id);
  }, [etaSeconds, etaStartedAt]);

  const pct = remaining / etaSeconds;
  const color = remaining <= 0 ? 'var(--bad)' : pct <= 0.2 ? 'var(--warn)' : 'var(--ok)';

  const abs = Math.abs(remaining);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const label = remaining <= 0
    ? `+${m}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  return (
    <span style={{ fontFamily: 'var(--font-mono)', color, fontSize: '12px', fontWeight: 600 }}>
      {label}
    </span>
  );
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending:     'Очікує',
  assigned:    'Призначено',
  in_progress: 'У дорозі',
  completed:   'Виконано',
  cancelled:   'Скасовано',
  failed:      'Провалено',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending:     'bg-[rgba(245,158,11,0.12)] text-[var(--warn)]  border border-[rgba(245,158,11,0.25)]',
  assigned:    'bg-[var(--acm-m)]          text-[var(--acm)]   border border-[var(--acm-b)]',
  in_progress: 'bg-[var(--acm-m)]          text-[var(--acm)]   border border-[var(--acm-b)]',
  completed:   'bg-[rgba(34,197,94,0.12)]  text-[var(--ok)]    border border-[rgba(34,197,94,0.25)]',
  cancelled:   'bg-[var(--s2)]             text-[var(--t4)]    border border-[var(--br)]',
  failed:      'bg-[rgba(239,68,68,0.12)]  text-[var(--bad)]   border border-[rgba(239,68,68,0.25)]',
};

interface Props {
  orders: Order[];
  couriers: CourierWithStatus[];
  hostedTrackingEnabled: boolean;
}

export function OrdersTable({ orders, couriers, hostedTrackingEnabled }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [assignModalOrder, setAssignModalOrder] = useState<Order | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [actionError, setActionError] = useState('');
  // orderId → tracking token (lazy, generated on first click)
  const [trackingTokens, setTrackingTokens] = useState<Record<string, string>>({});
  const [copiedTrackingId, setCopiedTrackingId] = useState<string | null>(null);
  const [tokenLoadingId, setTokenLoadingId] = useState<string | null>(null);

  const activeCouriers = couriers.filter((c) => c.active && c.on_shift);

  // An order is "courier-stuck" when: pending + ready_at set + waiting > 5 min.
  // Mirrors the dispatch processor's early-alert threshold (attempt 5 = ~5 min).
  const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
  function isStuck(order: Order): boolean {
    return (
      order.status === 'pending' &&
      order.ready_at != null &&
      Date.now() - new Date(order.ready_at).getTime() > STUCK_THRESHOLD_MS
    );
  }

  async function handleAssign() {
    if (!assignModalOrder || !selectedCourierId) return;
    setActionError('');
    try {
      await apiPost(`/api/v1/orders/${assignModalOrder.id}/assign`, {
        courier_id: selectedCourierId,
      });
      setAssignModalOrder(null);
      startTransition(() => router.refresh());
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Помилка призначення');
    }
  }

  async function handleCancel(orderId: string) {
    setActionError('');
    try {
      await apiPatch(`/api/v1/orders/${orderId}/cancel`);
      startTransition(() => router.refresh());
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Помилка скасування');
    }
  }

  async function handleCopyTrackingLink(orderId: string) {
    // Use cached token if already fetched
    let token = trackingTokens[orderId];
    if (!token) {
      setTokenLoadingId(orderId);
      try {
        const res = await apiPost<{ token: string }>(
          `/api/v1/orders/${orderId}/tracking-token`,
          {},
        );
        token = res.token;
        setTrackingTokens((prev) => ({ ...prev, [orderId]: token! }));
      } catch {
        setActionError('Не вдалось отримати посилання');
        setTokenLoadingId(null);
        return;
      }
      setTokenLoadingId(null);
    }

    const url = `${window.location.origin}/t/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedTrackingId(orderId);
      setTimeout(() => setCopiedTrackingId(null), 2000);
    }).catch(() => {
      setActionError('Не вдалось скопіювати посилання');
    });
  }

  return (
    <>
      {actionError && (
        <div className="mb-4 px-4 py-2 bg-[rgba(239,68,68,0.1)] text-[var(--bad)] text-sm rounded-md border border-[rgba(239,68,68,0.25)]">
          {actionError}
        </div>
      )}

      <div className="bg-[var(--sf)] rounded-lg border border-[var(--br)] overflow-hidden card-shine">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--br)]">
            <tr>
              {['Адреса', 'Статус', 'Курʼєр', 'Час', ...(hostedTrackingEnabled ? ['Клієнт'] : []), 'Дії'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--br)]">
            {orders.length === 0 && (
              <tr>
                <td colSpan={hostedTrackingEnabled ? 6 : 5} className="px-4 py-8 text-center text-[var(--t4)] text-sm">
                  Активних замовлень немає
                </td>
              </tr>
            )}
            {orders.map((order) => (
              <tr
                key={order.id}
                className={cn(
                  'transition-colors',
                  isStuck(order)
                    ? 'bg-[rgba(239,68,68,0.06)] hover:bg-[rgba(239,68,68,0.10)]'
                    : 'hover:bg-[var(--s2)]',
                )}
              >
                <td className="px-3 py-2.5 max-w-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--t1)] truncate">{order.address}</span>
                    {order.notes && (
                      <span className="text-xs text-[var(--t4)] shrink-0">({order.notes})</span>
                    )}
                    {order.ready_at && (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.04em]"
                        style={{
                          background: 'rgba(34,197,94,0.10)',
                          color: 'var(--ok)',
                          border: '1px solid rgba(34,197,94,0.2)',
                        }}
                      >
                        Готово
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium',
                        STATUS_COLORS[order.status],
                      )}
                    >
                      {STATUS_LABELS[order.status]}
                    </span>
                    {isStuck(order) && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.04em]"
                        style={{
                          background: 'rgba(239,68,68,0.15)',
                          color: 'var(--bad)',
                          border: '1px solid rgba(239,68,68,0.3)',
                        }}
                        title="Автодиспетчер не зміг знайти курʼєра. Призначте вручну."
                      >
                        Немає курʼєра
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-[var(--t2)]">
                  {order.delivery?.courier?.name ?? (
                    <span className="text-[var(--t4)]">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[var(--t4)] text-xs mono">
                  {order.delivery?.eta_seconds && order.delivery?.eta_started_at ? (
                    <EtaTimer
                      etaSeconds={order.delivery.eta_seconds}
                      etaStartedAt={order.delivery.eta_started_at}
                    />
                  ) : (
                    formatDistanceToNow(new Date(order.created_at), {
                      addSuffix: true,
                      locale: uk,
                    })
                  )}
                </td>
                {hostedTrackingEnabled && (
                  <td className="px-3 py-2.5">
                    {(order.status === 'assigned' || order.status === 'in_progress') && (
                      <button
                        onClick={() => handleCopyTrackingLink(order.id)}
                        disabled={tokenLoadingId === order.id || isPending}
                        title="Копіювати посилання клієнту"
                        className="px-2 py-1 text-xs rounded-[6px] transition-all disabled:opacity-40"
                        style={{
                          background: copiedTrackingId === order.id
                            ? 'rgba(106,170,132,0.15)'
                            : 'var(--s2)',
                          color: copiedTrackingId === order.id ? 'var(--acm)' : 'var(--t3)',
                          border: `1px solid ${copiedTrackingId === order.id ? 'rgba(106,170,132,0.3)' : 'var(--br)'}`,
                        }}
                      >
                        {tokenLoadingId === order.id
                          ? '…'
                          : copiedTrackingId === order.id
                            ? '✓ Скопійовано'
                            : '📋 Посилання'}
                      </button>
                    )}
                  </td>
                )}
                <td className="px-3 py-2.5">
                  <div className="flex gap-2">
                    {order.status === 'pending' && (
                      <button
                        onClick={() => {
                          setAssignModalOrder(order);
                          setSelectedCourierId('');
                          setActionError('');
                        }}
                        className="px-2.5 py-1 text-xs bg-[var(--acm)] text-[var(--bg)] font-medium rounded-[6px] hover:bg-[var(--acm-h)] transition-colors disabled:opacity-40"
                        disabled={isPending}
                      >
                        Призначити
                      </button>
                    )}
                    {(order.status === 'pending' || order.status === 'assigned') && (
                      <button
                        onClick={() => handleCancel(order.id)}
                        className="px-2.5 py-1 text-xs bg-[var(--s2)] text-[var(--t3)] rounded-[6px] hover:bg-[var(--s3)] hover:text-[var(--t1)] transition-colors disabled:opacity-40"
                        disabled={isPending}
                      >
                        Скасувати
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assign modal */}
      {assignModalOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[4px]"
          onClick={(e) => e.target === e.currentTarget && setAssignModalOrder(null)}
        >
          <div className="bg-[var(--sf)] rounded-lg border border-[var(--br2)] shadow-[var(--shadow-lg)] p-6 w-full max-w-sm card-shine">
            <h2 className="text-base font-semibold text-[var(--t1)] mb-1">Призначити курʼєра</h2>
            <p className="text-sm text-[var(--t3)] mb-4 truncate">{assignModalOrder.address}</p>

            {activeCouriers.length === 0 ? (
              <p className="text-sm text-[var(--warn)] mb-4">
                Немає курʼєрів на зміні
              </p>
            ) : (
              <select
                value={selectedCourierId}
                onChange={(e) => setSelectedCourierId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--br)] rounded-md text-sm text-[var(--t1)] mb-4 focus:outline-none focus:ring-1 focus:ring-[var(--acm)] focus:border-[var(--acm)] transition-colors"
              >
                <option value="">Оберіть курʼєра</option>
                {activeCouriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.status === 'online' ? 'На зміні' : 'Фон'}
                  </option>
                ))}
              </select>
            )}

            {actionError && (
              <p className="text-sm text-[var(--bad)] mb-3">{actionError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAssignModalOrder(null)}
                className="px-4 py-2 text-sm text-[var(--t3)] hover:text-[var(--t1)] transition-colors"
              >
                Відмінити
              </button>
              <button
                onClick={handleAssign}
                disabled={!selectedCourierId || isPending}
                className="px-4 py-2 text-sm bg-[var(--acm)] text-[var(--bg)] font-medium rounded-[6px] hover:bg-[var(--acm-h)] disabled:opacity-40 transition-colors"
              >
                Призначити
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
