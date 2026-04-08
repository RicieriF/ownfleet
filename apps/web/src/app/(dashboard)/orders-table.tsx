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
  // Only use semantic color when overdue or nearly overdue — timer as data, not signal
  const color =
    remaining <= 0
      ? 'var(--bad)'
      : pct <= 0.2
        ? 'var(--warn)'
        : 'var(--t2)';

  const abs = Math.abs(remaining);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const label = remaining <= 0
    ? `+${m}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  return (
    <span style={{ fontFamily: 'var(--font-mono)', color, fontSize: '13px', fontWeight: 500 }}>
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

// Dot colors per order status — semantic minimum: tiny 6px circle only
const STATUS_DOT: Record<OrderStatus, string> = {
  pending:     '#eab308',  // amber — waiting
  assigned:    '#22c55e',  // green — courier assigned
  in_progress: '#22c55e',  // green — active delivery
  completed:   '#6b6a66',  // muted — done
  cancelled:   '#6b6a66',  // muted — cancelled
  failed:      '#ef4444',  // red — failed
};

interface Props {
  orders: Order[];
  couriers: CourierWithStatus[];
  hostedTrackingEnabled: boolean;
  showSlaOnDashboard: boolean;
  stuckThresholdMinutes?: number;
}

export function OrdersTable({ orders, couriers, hostedTrackingEnabled, showSlaOnDashboard, stuckThresholdMinutes = 5 }: Props) {
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

  // An order is "stuck" when: pending + ready_at set + waiting > threshold (per-establishment setting).
  const STUCK_THRESHOLD_MS = stuckThresholdMinutes * 60 * 1000;
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
        <div
          className="mb-4 px-4 py-2.5 rounded-md text-sm"
          style={{
            background: 'var(--bad-tint)',
            border: '1px solid var(--bad-border)',
            borderLeft: '3px solid var(--bad)',
            color: 'var(--t2)',
          }}
        >
          {actionError}
        </div>
      )}

      <div
        className="rounded-md overflow-hidden"
        style={{
          background: 'var(--sf)',
          border: '1px solid var(--br)',
          boxShadow: 'var(--shadow-edge)',
        }}
      >
        <table className="w-full text-sm">
          <thead style={{ borderBottom: '1px solid var(--br)' }}>
            <tr>
              {['Адреса', 'Статус', 'Курʼєр', showSlaOnDashboard ? 'Вік · ETA' : 'Вік', ...(hostedTrackingEnabled ? ['Клієнт'] : []), 'Дії'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2.5 text-left"
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--t4)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td
                  colSpan={hostedTrackingEnabled ? 6 : 5}
                  className="px-4 py-10 text-center text-sm"
                  style={{ color: 'var(--t4)' }}
                >
                  Активних замовлень немає
                </td>
              </tr>
            )}
            {orders.map((order, i) => (
              <tr
                key={order.id}
                className="transition-colors"
                style={{
                  borderTop: i > 0 ? '1px solid var(--br)' : undefined,
                  background: isStuck(order) ? 'var(--bad-tint)' : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!isStuck(order)) {
                    (e.currentTarget as HTMLTableRowElement).style.background = 'var(--s2)';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = isStuck(order) ? 'var(--bad-tint)' : '';
                }}
              >
                {/* Address */}
                <td className="px-3 py-2.5 max-w-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate" style={{ color: 'var(--t1)' }}>
                      {order.address}
                    </span>
                    {order.notes && (
                      <span className="text-xs shrink-0" style={{ color: 'var(--t4)' }}>
                        ({order.notes})
                      </span>
                    )}
                    {order.ready_at && (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded-sm"
                        style={{
                          fontSize: '10px',
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          background: 'var(--s2)',
                          color: 'var(--t3)',
                          border: '1px solid var(--br)',
                        }}
                      >
                        Готово
                      </span>
                    )}
                  </div>
                </td>

                {/* Status — dot + neutral text, no colored badges */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full shrink-0"
                      style={{
                        width: 6,
                        height: 6,
                        background: STATUS_DOT[order.status],
                      }}
                    />
                    <span style={{ color: 'var(--t3)', fontSize: '13px' }}>
                      {STATUS_LABELS[order.status]}
                    </span>
                    {isStuck(order) && (
                      <span
                        className="mono"
                        style={{ fontSize: '11px', color: 'var(--t4)', letterSpacing: '0.03em' }}
                        title="Автодиспетчер не зміг знайти курʼєра. Призначте вручну."
                      >
                        — немає курʼєра
                      </span>
                    )}
                  </div>
                </td>

                {/* Courier */}
                <td className="px-3 py-2.5" style={{ color: 'var(--t2)' }}>
                  {order.delivery?.courier?.name ?? (
                    <span style={{ color: 'var(--t4)' }}>—</span>
                  )}
                </td>

                {/* Age + ETA — always show creation age; ETA countdown shown alongside when enabled */}
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--t4)' }}>
                      {formatDistanceToNow(new Date(order.created_at), {
                        addSuffix: true,
                        locale: uk,
                      })}
                    </span>
                    {showSlaOnDashboard && order.delivery?.eta_seconds && order.delivery?.eta_started_at && (
                      <EtaTimer
                        etaSeconds={order.delivery.eta_seconds}
                        etaStartedAt={order.delivery.eta_started_at}
                      />
                    )}
                  </div>
                </td>

                {/* Tracking link — hosted tracking only */}
                {hostedTrackingEnabled && (
                  <td className="px-3 py-2.5">
                    {(order.status === 'assigned' || order.status === 'in_progress') && (
                      <button
                        onClick={() => handleCopyTrackingLink(order.id)}
                        disabled={tokenLoadingId === order.id || isPending}
                        title="Копіювати посилання клієнту"
                        className="px-2 py-1 rounded transition-colors disabled:opacity-40"
                        style={{
                          fontSize: '12px',
                          borderRadius: '6px',
                          background: copiedTrackingId === order.id ? 'var(--acm-m)' : 'var(--s2)',
                          color: copiedTrackingId === order.id ? 'var(--t2)' : 'var(--t3)',
                          border: `1px solid ${copiedTrackingId === order.id ? 'var(--acm-b)' : 'var(--br)'}`,
                        }}
                      >
                        {tokenLoadingId === order.id
                          ? '…'
                          : copiedTrackingId === order.id
                            ? '✓ Скопійовано'
                            : 'Посилання'}
                      </button>
                    )}
                  </td>
                )}

                {/* Actions */}
                <td className="px-3 py-2.5">
                  <div className="flex gap-2">
                    {order.status === 'pending' && (
                      <button
                        onClick={() => {
                          setAssignModalOrder(order);
                          setSelectedCourierId('');
                          setActionError('');
                        }}
                        className="transition-colors disabled:opacity-40"
                        style={{
                          padding: '4px 10px',
                          fontSize: '12px',
                          fontWeight: 500,
                          borderRadius: '6px',
                          background: 'var(--acm)',
                          color: 'var(--t1)',
                          border: '1px solid var(--acm-b)',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--acm-h)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--acm)';
                        }}
                        disabled={isPending}
                      >
                        Призначити
                      </button>
                    )}
                    {(order.status === 'pending' || order.status === 'assigned') && (
                      <button
                        onClick={() => handleCancel(order.id)}
                        className="transition-colors disabled:opacity-40"
                        style={{
                          padding: '4px 10px',
                          fontSize: '12px',
                          borderRadius: '6px',
                          background: 'var(--s2)',
                          color: 'var(--t3)',
                          border: '1px solid var(--br)',
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
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-[4px]"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={(e) => e.target === e.currentTarget && setAssignModalOrder(null)}
        >
          <div
            className="p-6 w-full max-w-sm"
            style={{
              background: 'var(--sf)',
              border: '1px solid var(--br2)',
              borderRadius: '12px',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <h2
              className="mb-1"
              style={{ fontSize: '15px', fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.01em' }}
            >
              Призначити курʼєра
            </h2>
            <p
              className="mb-4 truncate"
              style={{ fontSize: '13px', color: 'var(--t3)' }}
            >
              {assignModalOrder.address}
            </p>

            {activeCouriers.length === 0 ? (
              <p className="text-sm mb-4" style={{ color: 'var(--t3)' }}>
                Немає курʼєрів на зміні
              </p>
            ) : (
              <select
                value={selectedCourierId}
                onChange={(e) => setSelectedCourierId(e.target.value)}
                className="w-full px-3 py-2 mb-4 text-sm transition-colors"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--br2)',
                  borderRadius: '6px',
                  color: 'var(--t1)',
                  outline: 'none',
                }}
              >
                <option value="">Оберіть курʼєра</option>
                {activeCouriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.status === 'online' ? 'Онлайн' : 'Фон'}
                  </option>
                ))}
              </select>
            )}

            {actionError && (
              <p className="text-sm mb-3" style={{ color: 'var(--bad)' }}>
                {actionError}
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAssignModalOrder(null)}
                className="px-4 py-2 text-sm transition-colors"
                style={{ color: 'var(--t3)', borderRadius: '6px' }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--t1)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--t3)';
                }}
              >
                Відмінити
              </button>
              <button
                onClick={handleAssign}
                disabled={!selectedCourierId || isPending}
                className="px-4 py-2 text-sm transition-colors disabled:opacity-40"
                style={{
                  fontWeight: 500,
                  borderRadius: '6px',
                  background: 'var(--acm)',
                  color: 'var(--t1)',
                  border: '1px solid var(--acm-b)',
                }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--acm-h)';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--acm)';
                }}
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
