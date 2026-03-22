import { apiFetch } from '@/lib/api';
import { CourierWithStatus } from '@/types';
import { CouriersList } from './couriers-list';

export default async function CouriersPage() {
  const couriers = await apiFetch<CourierWithStatus[]>('/api/v1/couriers/status');
  const onShift = couriers.filter((c) => c.on_shift).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--t1)]">Курʼєри</h1>
        <span className="text-sm text-[var(--t3)]">
          {onShift} на зміні з {couriers.length}
        </span>
      </div>
      <CouriersList couriers={couriers} />
    </div>
  );
}
