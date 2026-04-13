import { apiFetch } from '@/lib/api';
import { Order } from '@/types';
import { HistoryTable } from './history-table';

async function fetchHistory(): Promise<Order[]> {
  return apiFetch<Order[]>('/api/v1/orders?status=completed,failed,cancelled');
}

export default async function HistoryPage() {
  const orders = await fetchHistory();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--t1)]">Історія</h1>
        <p className="text-sm text-[var(--t3)] mt-1">
          Завершені, провалені та скасовані замовлення
        </p>
      </div>

      <HistoryTable orders={orders} />
    </div>
  );
}
