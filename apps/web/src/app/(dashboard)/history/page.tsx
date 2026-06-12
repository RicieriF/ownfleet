import { apiFetch } from '@/lib/api';
import { Order } from '@/types';
import { HistoryTable } from './history-table';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

async function fetchHistory(): Promise<Order[]> {
  return apiFetch<Order[]>('/api/v1/orders?status=completed,failed,cancelled');
}

export default async function HistoryPage() {
  const orders = await fetchHistory();
  const locale = await getLocale();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--t1)]">{t('Історія', locale)}</h1>
        <p className="text-sm text-[var(--t3)] mt-1">
          {t('Завершені, провалені та скасовані замовлення', locale)}
        </p>
      </div>

      <HistoryTable orders={orders} />
    </div>
  );
}
