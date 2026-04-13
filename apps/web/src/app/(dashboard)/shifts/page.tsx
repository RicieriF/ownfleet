import { apiFetch } from '@/lib/api';
import { CourierWithStatus, Establishment } from '@/types';
import { ShiftsManager } from './shifts-manager';

interface ActiveShift {
  id: string;
  courier_id: string;
  establishment_id: string;
  started_at: string;
  ended_at: string | null;
  ended_by: 'courier' | 'manager' | 'auto' | null;
  planned_end_at: string | null;
  total_deliveries: number;
  total_distance_km: number | null;
  courier: { id: string; name: string; phone: string };
}

async function fetchData() {
  const [shifts, couriers, establishment] = await Promise.all([
    apiFetch<ActiveShift[]>('/api/v1/shifts/active'),
    apiFetch<CourierWithStatus[]>('/api/v1/couriers/status'),
    apiFetch<Establishment>('/api/v1/establishments/me'),
  ]);
  return { shifts, couriers, establishment };
}

export default async function ShiftsPage() {
  const { shifts, couriers, establishment } = await fetchData();

  const activeCouriers = couriers.filter((c) => c.active);
  const notOnShift = activeCouriers.filter((c) => !c.on_shift);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--t1)]">Зміни</h1>
        <p className="text-sm text-[var(--t3)] mt-1">
          Активні зміни курʼєрів · оновлюється в реальному часі
        </p>
      </div>

      <ShiftsManager
        initialShifts={shifts}
        couriers={activeCouriers}
        notOnShift={notOnShift}
        timezone={establishment.timezone ?? 'Europe/Kyiv'}
      />
    </div>
  );
}
