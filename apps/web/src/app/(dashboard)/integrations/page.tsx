import { apiFetch } from '@/lib/api';
import { IntegrationsManager } from './integrations-manager';

interface Integration {
  id: string;
  type: 'poster' | 'iiko';
  active: boolean;
  config: Record<string, string>;
  updated_at: string;
}

export default async function IntegrationsPage() {
  const integrations = await apiFetch<Integration[]>('/api/v1/integrations');

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--t1)' }}>Інтеграції</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--t3)' }}>
          Підключіть POS-систему для автоматичного імпорту замовлень.
        </p>
      </div>
      <IntegrationsManager initialIntegrations={integrations} />
    </div>
  );
}
