import { apiFetch } from '@/lib/api';
import { PlatformPanel } from './platform-panel';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  trial_ends_at: string | null;
  paid_until: string | null;
  onboarding_status: string;
  created_at: string;
  couriers_count: number;
  orders_total: number;
  orders_last_30d: number;
  access_status: 'trial' | 'active' | 'grace' | 'expired';
  overdue_days: number | null;
}

interface EstablishmentsPage {
  data: TenantRow[];
  total: number;
  limit: number;
  offset: number;
}

export default async function PlatformPage() {
  const page = await apiFetch<EstablishmentsPage>('/api/v1/platform/establishments');

  return <PlatformPanel initialTenants={page.data} />;
}
