import { Suspense } from 'react';
import { apiFetch } from '@/lib/api';
import { Order, CourierWithStatus } from '@/types';
import { OrdersTable } from './orders-table';

async function fetchData() {
  const [orders, couriers] = await Promise.all([
    apiFetch<Order[]>('/api/v1/orders?status=pending,assigned,in_progress'),
    apiFetch<CourierWithStatus[]>('/api/v1/couriers/status'),
  ]);
  return { orders, couriers };
}

export default async function OrdersPage() {
  const { orders, couriers } = await fetchData();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Замовлення</h1>
        <span className="text-sm text-gray-500">{orders.length} активних</span>
      </div>

      <Suspense fallback={<div className="text-gray-400 text-sm">Завантаження...</div>}>
        <OrdersTable orders={orders} couriers={couriers} />
      </Suspense>
    </div>
  );
}
