import { apiFetch } from '@/lib/api';
import { ActiveShiftWithCourier } from '@/types';
import { ShiftsTable } from './shifts-table';

export default async function ShiftsPage() {
  const [shifts, settings] = await Promise.all([
    apiFetch<ActiveShiftWithCourier[]>('/api/v1/shifts/active'),
    apiFetch<{ timezone: string }>('/api/v1/establishments/me/settings'),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t1)]">Зміни</h1>
          <p className="text-sm text-[var(--t3)] mt-0.5">Активні зміни курʼєрів</p>
        </div>
        <span className="text-sm text-[var(--t3)] mono">
          {shifts.length} активних
        </span>
      </div>

      <ShiftsTable shifts={shifts} timezone={settings.timezone} />
    </div>
  );
}
