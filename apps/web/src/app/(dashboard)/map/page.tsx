import { apiFetch } from '@/lib/api';
import { CourierWithStatus, Establishment } from '@/types';
import { LiveMap } from './live-map';

export default async function MapPage() {
  const [couriers, establishment] = await Promise.all([
    apiFetch<CourierWithStatus[]>('/api/v1/couriers/status'),
    apiFetch<Establishment>('/api/v1/establishments/me'),
  ]);

  const initialCenter: [number, number] | undefined =
    establishment.lat != null && establishment.lng != null
      ? [establishment.lat, establishment.lng]
      : undefined;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--t1)] mb-6">Карта</h1>
      <div
        className="bg-[var(--sf)] rounded-lg border border-[var(--br)] overflow-hidden"
        style={{ height: 'calc(100vh - 160px)' }}
      >
        <LiveMap couriers={couriers} initialCenter={initialCenter} />
      </div>
    </div>
  );
}
