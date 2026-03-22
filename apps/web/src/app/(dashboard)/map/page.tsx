import { apiFetch } from '@/lib/api';
import { CourierWithStatus } from '@/types';
import { LiveMap } from './live-map';

export default async function MapPage() {
  const couriers = await apiFetch<CourierWithStatus[]>('/api/v1/couriers/status');

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--t1)] mb-6">Карта</h1>
      <div
        className="bg-[var(--sf)] rounded-lg border border-[var(--br)] overflow-hidden"
        style={{ height: 'calc(100vh - 160px)' }}
      >
        <LiveMap couriers={couriers} />
      </div>
    </div>
  );
}
