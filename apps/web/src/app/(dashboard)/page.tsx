import { Suspense } from 'react';
import { apiFetch } from '@/lib/api';
import { Order, CourierWithStatus, Establishment } from '@/types';
import { OrdersTable } from './orders-table';
import { SmartAssignmentPanel } from '@/components/smart-assignment-panel';

async function fetchData() {
  const [orders, couriers, establishment] = await Promise.all([
    apiFetch<Order[]>('/api/v1/orders?status=pending,assigned,in_progress'),
    apiFetch<CourierWithStatus[]>('/api/v1/couriers/status'),
    apiFetch<Establishment>('/api/v1/establishments/me'),
  ]);
  return { orders, couriers, establishment };
}

function computeFleetKpi(orders: Order[], couriers: CourierWithStatus[]) {
  const activeCouriers = couriers.filter((c) => c.active);
  const onShift = activeCouriers.filter((c) => c.on_shift);

  // Courier IDs that have an active delivery right now
  const busyCourierIds = new Set(
    orders
      .filter((o) => (o.status === 'assigned' || o.status === 'in_progress') && o.delivery?.courier_id)
      .map((o) => o.delivery!.courier_id),
  );

  const inProgress = onShift.filter((c) => busyCourierIds.has(c.id)).length;
  const free = onShift.filter((c) => !busyCourierIds.has(c.id)).length;
  const notStarted = activeCouriers.filter((c) => !c.on_shift).length;

  return {
    onShift: onShift.length,
    total: activeCouriers.length,
    inProgress,
    free,
    notStarted,
  };
}

export default async function OrdersPage() {
  const { orders, couriers, establishment } = await fetchData();
  const fleet = computeFleetKpi(orders, couriers);

  return (
    <div>
      {/* Fleet KPI bar */}
      <div
        className="rounded-lg mb-6 px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3"
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Primary KPI */}
        <div className="flex items-baseline gap-2 min-w-[120px]">
          <span
            className="text-2xl leading-none"
            style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--t1)' }}
          >
            {fleet.onShift}
            <span style={{ color: 'var(--t4)', fontWeight: 400 }}>/{fleet.total}</span>
          </span>
          <span className="text-sm" style={{ color: 'var(--t3)' }}>
            На зміні
          </span>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px h-8 bg-[var(--br)]" />

        {/* Secondary stats */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ color: 'var(--t3)' }}>
          <span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t2)' }}>
              {fleet.inProgress}
            </span>{' '}
            в дорозі
          </span>
          <span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t2)' }}>
              {fleet.free}
            </span>{' '}
            вільних
          </span>
          <span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t2)' }}>
              {fleet.notStarted}
            </span>{' '}
            не вийшли
          </span>
        </div>
      </div>

      {/* Smart assignment panel — only in recommend mode */}
      {establishment.dispatch_mode === 'recommend' && (
        <SmartAssignmentPanel />
      )}

      {/* Orders section */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[var(--t1)]">Замовлення</h1>
        <span className="text-sm text-[var(--t3)]">{orders.length} активних</span>
      </div>

      <Suspense fallback={<div className="text-sm text-[var(--t4)]">Завантаження...</div>}>
        <OrdersTable orders={orders} couriers={couriers} />
      </Suspense>
    </div>
  );
}
