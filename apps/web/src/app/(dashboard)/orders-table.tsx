'use client';

import { useState, useTransition, useEffect } from 'react';
import { Order, OrderStatus, CourierWithStatus } from '@/types';
import { apiPost, apiPatch } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { uk, enUS } from 'date-fns/locale';
import { OrderCoordDrawer } from './order-coord-drawer';
import { getSocket } from '@/lib/socket';
import { useT, useLocale } from '@/lib/i18n/client';

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
  const t = useT();
  const dateLocale = useLocale() === 'uk' ? uk : enUS;
  const [isPending, startTransition] = useTransition();
  const [assignModalOrder, setAssignModalOrder] = useState<Order | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [actionError, setActionError] = useState('');
  // orderId → tracking token (lazy, generated on first click)
  const [trackingTokens, setTrackingTokens] = useState<Record<string, string>>({});
  const [copiedTrackingId, setCopiedTrackingId] = useState<string | null>(null);
  const [tokenLoadingId, setTokenLoadingId] = useState<string | null>(null);
  // Coordinate drawer
  const [coordDrawerOrder, setCoordDrawerOrder] = useState<Order | null>(null);
  // Local coord overrides (set after manual save so we don't wait for router.refresh)
  const [localCoords, setLocalCoords] = useState<Record<string, { lat: number; lng: number }>>({});

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
      setActionError(e instanceof Error ? e.message : t('Помилка призначення'));
    }
  }

  async function handleCancel(orderId: string) {
    setActionError('');
    try {
      await apiPatch(`/api/v1/orders/${orderId}/cancel`);
      startTransition(() => router.refresh());
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('Помилка скасування'));
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
        setActionError(t('Не вдалось отримати посилання'));
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
      setActionError(t('Не вдалось скопіювати посилання'));
    });
  }

  function openAssignModal(order: Order) {
    setAssignModalOrder(order);
    setSelectedCourierId('');
    setActionError('');
  }

  function openCoordDrawer(order: Order, e: React.MouseEvent) {
    e.stopPropagation();
    const override = localCoords[order.id];
    setCoordDrawerOrder(
      override ? { ...order, lat: override.lat, lng: override.lng } : order,
    );
  }

  function handleCoordSaved(orderId: string, lat: number, lng: number) {
    setLocalCoords((prev) => ({ ...prev, [orderId]: { lat, lng } }));
    setCoordDrawerOrder((prev) => (prev?.id === orderId ? { ...prev, lat, lng } : prev));
  }

  // Real-time geocoding updates via WebSocket.
  // order:coords_ready — geocoding succeeded: update local coords so the «Карта» button
  //   stops showing the "no coords" warning badge and the drawer shows the correct pin.
  // order:geocode_failed — geocoding permanently failed: trigger a full router.refresh()
  //   so the server-rendered alert in page.tsx picks up the correct no-coord order list.
  useEffect(() => {
    const socket = getSocket();

    const onCoordsReady = ({ order_id, lat, lng }: { order_id: string; lat: number; lng: number }) => {
      setLocalCoords((prev) => ({ ...prev, [order_id]: { lat, lng } }));
      setCoordDrawerOrder((prev) =>
        prev?.id === order_id ? { ...prev, lat, lng } : prev,
      );
      // Refresh server state so the no-coord alert in page.tsx disappears
      startTransition(() => router.refresh());
    };

    const onGeocodeFailed = () => {
      // Refresh so the no-coord alert in page.tsx reflects the latest state
      startTransition(() => router.refresh());
    };

    socket.on('order:coords_ready', onCoordsReady);
    socket.on('order:geocode_failed', onGeocodeFailed);

    return () => {
      socket.off('order:coords_ready', onCoordsReady);
      socket.off('order:geocode_failed', onGeocodeFailed);
    };
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingOrders = orders.filter((o) => o.status === 'pending');
  const activeOrders = orders.filter((o) => o.status !== 'pending');

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

      {/* ── Pending assignments ───────────────────────────────────── */}
      {pendingOrders.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--t4)',
              }}
            >
              {t('Очікують призначення')}
            </span>
            <span className="mono" style={{ fontSize: '12px', color: 'var(--t3)' }}>
              {pendingOrders.length}
            </span>
          </div>

          <div
            style={{
              background: 'var(--sf)',
              border: '1px solid var(--br)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-edge)',
              overflow: 'hidden',
            }}
          >
            {pendingOrders.map((order, i) => (
              <div
                key={order.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderTop: i > 0 ? '1px solid var(--br)' : undefined,
                  background: isStuck(order) ? 'var(--bad-tint)' : undefined,
                }}
              >
                {/* Order id */}
                <span
                  className="mono"
                  style={{ fontSize: '12px', color: 'var(--t3)', flexShrink: 0, minWidth: '52px' }}
                >
                  {order.external_id ? `#${order.external_id}` : '—'}
                </span>

                {/* Address */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontSize: '13px',
                        color: 'var(--t1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {order.address}
                    </span>
                    {(localCoords[order.id] == null && order.lat == null) && (
                      <button
                        title={t('Координати не визначені — натисніть щоб виправити')}
                        onClick={(e) => openCoordDrawer(order, e)}
                        style={{
                          flexShrink: 0,
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: 'rgba(245,158,11,0.15)',
                          color: 'var(--warn)',
                          border: '1px solid rgba(245,158,11,0.3)',
                          cursor: 'pointer',
                          lineHeight: '16px',
                        }}
                      >
                        {t('! Гео')}
                      </button>
                    )}
                  </div>
                  {order.notes && (
                    <span style={{ fontSize: '11px', color: 'var(--t3)' }}>{order.notes}</span>
                  )}
                </div>

                {/* Age */}
                <span
                  className="mono"
                  style={{ fontSize: '11px', color: isStuck(order) ? 'var(--bad)' : 'var(--t4)', flexShrink: 0 }}
                >
                  {formatDistanceToNow(new Date(order.ready_at ?? order.created_at), {
                    addSuffix: false,
                    locale: dateLocale,
                  })}
                </span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    onClick={() => openAssignModal(order)}
                    disabled={isPending}
                    className="transition-colors disabled:opacity-40"
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
                      fontWeight: 500,
                      borderRadius: '6px',
                      background: 'var(--acm)',
                      color: 'var(--t1)',
                      border: '1px solid var(--acm-b)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'var(--acm-h)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'var(--acm)';
                    }}
                  >
                    {t('Призначити')}
                  </button>
                  <button
                    onClick={() => handleCancel(order.id)}
                    disabled={isPending}
                    className="transition-colors disabled:opacity-40"
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
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
                    {t('Скасувати')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Active deliveries table ───────────────────────────────── */}
      <div className="flex items-center justify-between mb-2">
        <span
          style={{
            fontSize: '11px',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--t4)',
          }}
        >
          {t('Активні доставки')}
        </span>
        <span className="mono" style={{ fontSize: '12px', color: 'var(--t3)' }}>
          {activeOrders.length}
        </span>
      </div>

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
              {[t('Адреса'), t('Статус'), t('Курʼєр'), showSlaOnDashboard ? t('Вік · ETA') : t('Вік'), ...(hostedTrackingEnabled ? [t('Клієнт')] : []), t('Дії')].map((h) => (
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
            {activeOrders.length === 0 && (
              <tr>
                <td
                  colSpan={hostedTrackingEnabled ? 6 : 5}
                  className="px-4 py-10 text-center text-sm"
                  style={{ color: 'var(--t3)' }}
                >
                  {t('Активних доставок немає')}
                </td>
              </tr>
            )}
            {activeOrders.map((order, i) => (
              <tr
                key={order.id}
                className="transition-colors"
                style={{
                  borderTop: i > 0 ? '1px solid var(--br)' : undefined,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = 'var(--s2)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = '';
                }}
              >
                {/* Address */}
                <td className="px-3 py-2.5 max-w-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate" style={{ color: 'var(--t1)' }}>
                      {order.address}
                    </span>
                    {order.notes && (
                      <span className="text-xs shrink-0" style={{ color: 'var(--t3)' }}>
                        ({order.notes})
                      </span>
                    )}
                    {(localCoords[order.id] == null && order.lat == null) && (
                      <button
                        title={t('Координати не визначені — натисніть щоб виправити')}
                        onClick={(e) => openCoordDrawer(order, e)}
                        style={{
                          flexShrink: 0,
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: 'rgba(245,158,11,0.15)',
                          color: 'var(--warn)',
                          border: '1px solid rgba(245,158,11,0.3)',
                          cursor: 'pointer',
                          lineHeight: '16px',
                        }}
                      >
                        {t('! Гео')}
                      </button>
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
                      {t(STATUS_LABELS[order.status])}
                    </span>
                  </div>
                </td>

                {/* Courier */}
                <td className="px-3 py-2.5" style={{ color: 'var(--t2)' }}>
                  {order.delivery?.courier?.name ?? (
                    <span style={{ color: 'var(--t4)' }}>—</span>
                  )}
                </td>

                {/* Age + ETA */}
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--t4)' }}>
                      {formatDistanceToNow(new Date(order.created_at), {
                        addSuffix: true,
                        locale: dateLocale,
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
                        title={t('Копіювати посилання клієнту')}
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
                            ? t('✓ Скопійовано')
                            : t('Посилання')}
                      </button>
                    )}
                  </td>
                )}

                {/* Actions */}
                <td className="px-3 py-2.5">
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => openCoordDrawer(order, e)}
                      className="transition-colors"
                      title={t('Переглянути / виправити координати')}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
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
                      {t('Карта')}
                    </button>
                    {(order.status === 'assigned') && (
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
                        {t('Скасувати')}
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
              {t('Призначити курʼєра')}
            </h2>
            <p
              className="mb-4 truncate"
              style={{ fontSize: '13px', color: 'var(--t3)' }}
            >
              {assignModalOrder.address}
            </p>

            {activeCouriers.length === 0 ? (
              <p className="text-sm mb-4" style={{ color: 'var(--t3)' }}>
                {t('Немає курʼєрів на зміні')}
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
                <option value="">{t('Оберіть курʼєра')}</option>
                {activeCouriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.status === 'online' ? t('Онлайн') : t('Фон')}
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
                {t('Відмінити')}
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
                {t('Призначити')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Coordinate drawer */}
      <OrderCoordDrawer
        order={coordDrawerOrder}
        onClose={() => setCoordDrawerOrder(null)}
        onSaved={handleCoordSaved}
      />
    </>
  );
}
