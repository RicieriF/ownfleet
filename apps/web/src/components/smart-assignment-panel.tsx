'use client';

/**
 * SmartAssignmentPanel
 *
 * Shown on the main dashboard when dispatch_mode = 'recommend'.
 * Listens for `order:recommendation` WS events and shows pending orders
 * with the system-recommended courier, allowing the manager to confirm
 * or ignore with a single click.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socket';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Order } from '@/types';

type TransportMode = 'car' | 'moto_gas' | 'moto_electric' | 'bicycle' | 'walking';

interface Recommendation {
  order_id: string;
  courier_id: string;
  courier_name: string;
  eta_seconds: number;
  distance_meters: number;
  transport_mode: TransportMode;
}

interface PanelEntry {
  order: Order;
  recommendation: Recommendation | null;
  /** ISO timestamp when the entry was added to the panel */
  addedAt: string;
  dismissed: boolean;
}

const TRANSPORT_LABELS: Record<TransportMode, string> = {
  car: 'авто',
  moto_gas: 'мото',
  moto_electric: 'мото',
  bicycle: 'велосипед',
  walking: 'пішки',
};


function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function zoneLabel(distanceMeters: number): string {
  if (distanceMeters < 150) return 'Zone 1';
  if (distanceMeters < 1000) return 'Zone 2';
  return 'Zone 3';
}

function etaMinutes(etaSeconds: number): number {
  return Math.round(etaSeconds / 60);
}

// Countdown to next retry attempt (60s cycle matching the dispatch processor)
function RetryCountdown({ addedAt }: { addedAt: string }) {
  const [secsLeft, setSecsLeft] = useState<number>(() => {
    const elapsed = (Date.now() - new Date(addedAt).getTime()) / 1000;
    return Math.max(0, 60 - (elapsed % 60));
  });

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = (Date.now() - new Date(addedAt).getTime()) / 1000;
      setSecsLeft(Math.max(0, 60 - (elapsed % 60)));
    }, 1000);
    return () => clearInterval(id);
  }, [addedAt]);

  return (
    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t3)', fontSize: '12px' }}>
      {secsLeft}с
    </span>
  );
}

export function SmartAssignmentPanel() {
  const router = useRouter();
  const [entries, setEntries] = useState<Map<string, PanelEntry>>(new Map());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch pending orders to keep the panel's order list up to date
  const fetchPendingOrders = useCallback(async () => {
    try {
      const orders = await apiGet<Order[]>('/api/v1/orders?status=pending');
      setEntries((prev) => {
        const next = new Map(prev);

        // Remove dismissed entries and entries for orders no longer pending
        const pendingIds = new Set(orders.map((o) => o.id));
        for (const [id, entry] of next) {
          if (entry.dismissed || !pendingIds.has(id)) {
            next.delete(id);
          }
        }

        // Add new pending orders not yet tracked
        for (const order of orders) {
          if (!next.has(order.id)) {
            next.set(order.id, {
              order,
              recommendation: null,
              addedAt: new Date().toISOString(),
              dismissed: false,
            });
          } else {
            // Update order data (address may have changed, etc.)
            const existing = next.get(order.id)!;
            next.set(order.id, { ...existing, order });
          }
        }

        return next;
      });
    } catch {
      // Silently ignore poll failures
    }
  }, []);

  // Poll every 15s
  useEffect(() => {
    fetchPendingOrders();
    pollRef.current = setInterval(fetchPendingOrders, 15_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchPendingOrders]);

  // Listen for WS recommendation events
  useEffect(() => {
    const socket = getSocket();

    const handleRecommendation = (data: Recommendation) => {
      setEntries((prev) => {
        const next = new Map(prev);
        const existing = next.get(data.order_id);
        if (existing && !existing.dismissed) {
          next.set(data.order_id, { ...existing, recommendation: data });
        }
        return next;
      });
    };

    const handleOrderAssigned = (data: { order_id: string }) => {
      // Remove from panel if order was assigned (auto or by another manager)
      setEntries((prev) => {
        const next = new Map(prev);
        next.delete(data.order_id);
        return next;
      });
    };

    socket.on('order:recommendation', handleRecommendation);
    socket.on('order:assigned', handleOrderAssigned);

    return () => {
      socket.off('order:recommendation', handleRecommendation);
      socket.off('order:assigned', handleOrderAssigned);
    };
  }, []);

  async function handleConfirm(orderId: string, courierId: string) {
    setConfirming(orderId);
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(orderId);
      return next;
    });
    try {
      await apiPost(`/api/v1/orders/${orderId}/assign-recommended`, { courier_id: courierId });
      setEntries((prev) => {
        const next = new Map(prev);
        next.delete(orderId);
        return next;
      });
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Помилка призначення';
      setErrors((prev) => {
        const next = new Map(prev);
        next.set(orderId, msg);
        return next;
      });
    } finally {
      setConfirming(null);
    }
  }

  function handleDismiss(orderId: string) {
    setEntries((prev) => {
      const next = new Map(prev);
      const existing = next.get(orderId);
      if (existing) {
        next.set(orderId, { ...existing, dismissed: true });
      }
      return next;
    });
    // Clean up dismissed entries
    setTimeout(() => {
      setEntries((prev) => {
        const next = new Map(prev);
        next.delete(orderId);
        return next;
      });
    }, 300);
  }

  // ready_at orders first (kitchen ready = urgent), then by creation time (oldest first)
  const visibleEntries = Array.from(entries.values())
    .filter((e) => !e.dismissed)
    .sort((a, b) => {
      const aReady = a.order.ready_at != null ? 0 : 1;
      const bReady = b.order.ready_at != null ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return new Date(a.order.created_at).getTime() - new Date(b.order.created_at).getTime();
    });

  // Empty state
  if (visibleEntries.length === 0) {
    return (
      <div
        className="rounded-lg mb-4 px-5 py-4"
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex items-center justify-between mb-1">
          <p
            style={{
              color: 'var(--t4)',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Призначення
          </p>
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.05em]"
            style={{
              background: 'var(--s3)',
              color: 'var(--t3)',
              border: '1px solid var(--br)',
            }}
          >
            Рекомендація
          </span>
        </div>
        <p className="text-sm" style={{ color: 'var(--t3)' }}>
          Немає замовлень на призначення
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg mb-4 overflow-hidden"
      style={{
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Header */}
      <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--br)' }}>
        <div className="flex items-center gap-2">
          <p
            style={{
              color: 'var(--t4)',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Призначення
          </p>
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{
              fontFamily: 'var(--font-mono)',
              background: 'var(--s3)',
              color: 'var(--t3)',
            }}
          >
            {visibleEntries.length}
          </span>
        </div>
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.05em]"
          style={{
            background: 'var(--s3)',
            color: 'var(--t3)',
            border: '1px solid var(--br)',
          }}
        >
          Рекомендація
        </span>
      </div>

      {/* Entries */}
      <div className="divide-y" style={{ borderColor: 'var(--br)' }}>
        {visibleEntries.map((entry) => {
          const { order, recommendation, addedAt } = entry;
          const isConfirming = confirming === order.id;
          const entryError = errors.get(order.id);
          const hasRec = recommendation !== null;

          return (
            <div key={order.id} className="px-5 py-3.5">
              {/* Order row */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="text-sm font-medium truncate"
                    style={{ color: 'var(--t1)' }}
                  >
                    {order.address}
                  </span>
                  {order.ready_at && (
                    <span
                      className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.04em]"
                      style={{
                        background: 'var(--s2)',
                        color: 'var(--t3)',
                        border: '1px solid var(--br)',
                      }}
                    >
                      Готово
                    </span>
                  )}
                </div>
                <span
                  className="flex-shrink-0 text-xs"
                  style={{ fontFamily: 'var(--font-mono)', color: 'var(--t4)' }}
                >
                  {formatTime(order.created_at)}
                </span>
              </div>

              {/* Recommendation or waiting state */}
              {hasRec ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm" style={{ color: 'var(--t2)' }}>
                        Рекомендовано:{' '}
                        <span className="font-medium" style={{ color: 'var(--t1)' }}>
                          {recommendation.courier_name}
                        </span>
                      </span>
                      <span className="text-xs" style={{ color: 'var(--t3)' }}>
                        ETA ~{etaMinutes(recommendation.eta_seconds)} хв
                        {' · '}
                        {zoneLabel(recommendation.distance_meters)}{' '}
                        ({Math.round(recommendation.distance_meters)}м)
                        {' '}
                        {TRANSPORT_LABELS[recommendation.transport_mode]}
                      </span>
                    </div>
                  </div>

                  {entryError && (
                    <p className="text-xs mb-2" style={{ color: 'var(--bad)' }}>{entryError}</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirm(order.id, recommendation.courier_id)}
                      disabled={isConfirming}
                      className="px-3 py-1.5 text-xs font-medium rounded-[6px] transition-opacity disabled:opacity-40"
                      style={{
                        background: 'var(--acm)',
                        color: 'var(--t1)',
                      }}
                    >
                      {isConfirming ? 'Призначаємо…' : 'Призначити'}
                    </button>
                    <button
                      onClick={() => handleDismiss(order.id)}
                      disabled={isConfirming}
                      className="px-3 py-1.5 text-xs rounded-[6px] transition-colors disabled:opacity-40"
                      style={{
                        background: 'var(--s3)',
                        color: 'var(--t3)',
                      }}
                    >
                      Ігнорувати
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--t3)' }}>
                    Очікування курʼєра…
                  </span>
                  <span className="text-xs" style={{ color: 'var(--t3)' }}>
                    Наступна спроба через <RetryCountdown addedAt={addedAt} />
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
