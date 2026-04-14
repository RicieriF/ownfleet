import { Suspense } from 'react';
import { apiFetch } from '@/lib/api';
import { Order, CourierWithStatus, Establishment } from '@/types';
import { OrdersTable } from './orders-table';
import { SmartAssignmentPanel } from '@/components/smart-assignment-panel';
import { AlertCard } from './alert-card';
import { CourierStatusPanel } from './courier-status-panel';

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

  const busyCourierIds = new Set(
    orders
      .filter((o) => (o.status === 'assigned' || o.status === 'in_progress') && o.delivery?.courier_id)
      .map((o) => o.delivery!.courier_id),
  );

  const inProgress = onShift.filter((c) => busyCourierIds.has(c.id)).length;
  const free = onShift.filter((c) => !busyCourierIds.has(c.id)).length;
  const notStarted = activeCouriers.filter((c) => !c.on_shift).length;
  const pending = orders.filter((o) => o.status === 'pending').length;

  return {
    onShift: onShift.length,
    total: activeCouriers.length,
    inProgress,
    free,
    notStarted,
    pending,
  };
}

interface KpiCardProps {
  value: string | number;
  label: string;
  sub?: string;
}

function KpiCard({ value, label, sub }: KpiCardProps) {
  return (
    <div
      style={{
        background: 'var(--sf)',
        border: '1px solid var(--br)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow-edge)',
        padding: '16px',
        minWidth: 0,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'var(--t1)',
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          marginBottom: '4px',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 400,
          color: 'var(--t3)',
          lineHeight: 1.4,
        }}
      >
        {label}
      </div>
      {sub && (
        <div
          style={{
            fontSize: '11px',
            color: 'var(--t3)',
            marginTop: '4px',
            lineHeight: 1.4,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export default async function OrdersPage() {
  const { orders, couriers, establishment } = await fetchData();
  const fleet = computeFleetKpi(orders, couriers);

  // Alert: not_responding couriers with an active in_progress delivery
  const notRespondingAlerts = couriers
    .filter((c) => c.status === 'not_responding')
    .flatMap((c) => {
      const activeOrder = orders.find(
        (o) => o.delivery?.courier_id === c.id && o.status === 'in_progress',
      );
      return activeOrder ? [{ courier: c, order: activeOrder }] : [];
    });

  // Alert: active orders (pending / assigned / in_progress) with no coordinates.
  // These orders cannot be auto-dispatched and require manual coordinate entry.
  const noCoordOrders = orders.filter(
    (o) =>
      (o.status === 'pending' || o.status === 'assigned' || o.status === 'in_progress') &&
      o.lat == null,
  );

  return (
    <div>
      {/* KPI cards row */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}
      >
        <KpiCard
          value={`${fleet.onShift}/${fleet.total}`}
          label="На зміні"
          sub={
            fleet.onShift > 0
              ? `${fleet.inProgress} в дорозі · ${fleet.free} вільних`
              : undefined
          }
        />
        <KpiCard value={fleet.inProgress} label="У дорозі" />
        <KpiCard value={fleet.free} label="Вільних" />
        <KpiCard value={fleet.notStarted} label="Не вийшли" />
        <KpiCard value={fleet.pending} label="Очікують" sub="без курʼєра" />
      </div>

      {/* Smart assignment panel — only in recommend mode */}
      {establishment.dispatch_mode === 'recommend' && <SmartAssignmentPanel />}

      {/* Alert cards — not_responding couriers with active delivery */}
      {notRespondingAlerts.map(({ courier, order }) => (
        <AlertCard key={courier.id} courier={courier} order={order} />
      ))}

      {/* Alert: orders without coordinates — cannot be dispatched, require manual fix */}
      {noCoordOrders.length > 0 && (
        <div
          className="flex items-start gap-3 mb-3 px-4 py-3 rounded-md"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            borderLeft: '3px solid var(--warn)',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--warn)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginTop: '1px' }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--t1)' }}>
              {noCoordOrders.length === 1
                ? '1 замовлення без координат'
                : `${noCoordOrders.length} замовлень без координат`}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '2px' }}>
              {noCoordOrders.map((o) => o.address).join(' · ')}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--t4)', marginTop: '4px' }}>
              Натисніть «Карта» навпроти замовлення щоб встановити координати вручну
            </div>
          </div>
        </div>
      )}

      {/* Two-column layout: orders (flex-1) + courier status panel (300px) */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Suspense
            fallback={
              <div
                style={{
                  background: 'var(--sf)',
                  border: '1px solid var(--br)',
                  borderRadius: '8px',
                  padding: '32px',
                  textAlign: 'center',
                  fontSize: '13px',
                  color: 'var(--t4)',
                }}
              >
                Завантаження…
              </div>
            }
          >
            <OrdersTable
              orders={orders}
              couriers={couriers}
              hostedTrackingEnabled={establishment.hosted_tracking_enabled ?? false}
              showSlaOnDashboard={establishment.settings?.show_sla_on_dashboard ?? false}
              stuckThresholdMinutes={establishment.settings?.dispatch_no_courier_escalation_minutes ?? 5}
            />
          </Suspense>
        </div>

        <div style={{ width: '300px', flexShrink: 0 }}>
          <CourierStatusPanel couriers={couriers} />
        </div>
      </div>
    </div>
  );
}
