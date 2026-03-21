'use client';

import { useState, useTransition } from 'react';
import { Order, OrderStatus, CourierWithStatus } from '@/types';
import { apiPost, apiPatch } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Очікує',
  assigned: 'Призначено',
  in_progress: 'У дорозі',
  completed: 'Виконано',
  cancelled: 'Скасовано',
  failed: 'Провалено',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  assigned: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-800',
};

interface Props {
  orders: Order[];
  couriers: CourierWithStatus[];
}

export function OrdersTable({ orders, couriers }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [assignModalOrder, setAssignModalOrder] = useState<Order | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [actionError, setActionError] = useState('');

  const activeCouriers = couriers.filter(
    (c) => c.active && (c.status === 'online' || c.status === 'background'),
  );

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

  return (
    <>
      {actionError && (
        <div className="mb-4 px-4 py-2 bg-red-50 text-red-700 text-sm rounded-lg">
          {actionError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Адреса</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Статус</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Курʼєр</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Час</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Дії</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Активних замовлень немає
                </td>
              </tr>
            )}
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                  {order.address}
                  {order.notes && (
                    <span className="ml-2 text-xs text-gray-400">({order.notes})</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium',
                      STATUS_COLORS[order.status],
                    )}
                  >
                    {STATUS_LABELS[order.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {order.delivery?.courier?.name ?? <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {formatDistanceToNow(new Date(order.created_at), {
                    addSuffix: true,
                    locale: uk,
                  })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {order.status === 'pending' && (
                      <button
                        onClick={() => {
                          setAssignModalOrder(order);
                          setSelectedCourierId('');
                          setActionError('');
                        }}
                        className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        disabled={isPending}
                      >
                        Призначити
                      </button>
                    )}
                    {(order.status === 'pending' || order.status === 'assigned') && (
                      <button
                        onClick={() => handleCancel(order.id)}
                        className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Призначити курʼєра</h2>
            <p className="text-sm text-gray-500 mb-4 truncate">{assignModalOrder.address}</p>

            {activeCouriers.length === 0 ? (
              <p className="text-sm text-amber-600 mb-4">
                Немає доступних курʼєрів онлайн
              </p>
            ) : (
              <select
                value={selectedCourierId}
                onChange={(e) => setSelectedCourierId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Оберіть курʼєра</option>
                {activeCouriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.status === 'online' ? '🟢 Онлайн' : '🟡 Фон'}
                  </option>
                ))}
              </select>
            )}

            {actionError && (
              <p className="text-sm text-red-600 mb-3">{actionError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAssignModalOrder(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Відмінити
              </button>
              <button
                onClick={handleAssign}
                disabled={!selectedCourierId}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
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
