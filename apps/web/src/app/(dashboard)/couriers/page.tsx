import { apiFetch } from '@/lib/api';
import { CourierWithStatus, InviteToken } from '@/types';
import { CouriersList } from './couriers-list';
import { InvitePanel } from './invite-panel';

export default async function CouriersPage() {
  const [couriers, invites] = await Promise.all([
    apiFetch<CourierWithStatus[]>('/api/v1/couriers/status'),
    apiFetch<InviteToken[]>('/api/v1/onboarding/invites'),
  ]);

  const onShift = couriers.filter((c) => c.on_shift).length;
  const activeCouriers = couriers.filter((c) => c.active);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--t1)]">Курʼєри</h1>
        <span className="text-sm text-[var(--t3)]">
          {onShift} на зміні з {couriers.length}
        </span>
      </div>
      <CouriersList couriers={couriers} />
      <InvitePanel
        couriers={activeCouriers.map((c) => ({ id: c.id, name: c.name }))}
        initialInvites={invites}
      />
    </div>
  );
}
