import { apiFetch } from '@/lib/api';
import { CourierWithStatus } from '@/types';
import { CouriersList } from './couriers-list';

export default async function CouriersPage() {
  const couriers = await apiFetch<CourierWithStatus[]>('/api/v1/couriers/status');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Курʼєри</h1>
        <span className="text-sm text-gray-500">
          {couriers.filter((c) => c.status === 'online').length} онлайн з {couriers.length}
        </span>
      </div>
      <CouriersList couriers={couriers} />
    </div>
  );
}
