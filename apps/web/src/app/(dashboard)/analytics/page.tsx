import { apiFetch } from '@/lib/api';
import { AnalyticsSummary, CourierAnalytics } from '@/types';

async function fetchAnalytics() {
  const [summary, perCourier] = await Promise.all([
    apiFetch<AnalyticsSummary>('/api/v1/analytics/summary'),
    apiFetch<CourierAnalytics[]>('/api/v1/analytics/couriers'),
  ]);
  return { summary, perCourier };
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function AnalyticsPage() {
  const { summary, perCourier } = await fetchAnalytics();

  const completionPct = Math.round(summary.completion_rate * 100);
  const avgMin =
    summary.avg_delivery_minutes != null ? `${Math.round(summary.avg_delivery_minutes)} хв` : '—';

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Аналітика</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Доставок за 30 днів"
          value={summary.total_deliveries}
        />
        <StatCard
          label="Виконано"
          value={`${completionPct}%`}
          sub={`${summary.completed} з ${summary.total_deliveries}`}
        />
        <StatCard
          label="Середній час"
          value={avgMin}
          sub="від призначення до завершення"
        />
        <StatCard
          label="Провалено / Скасовано"
          value={summary.failed + summary.cancelled}
          sub={`${summary.failed} провалено, ${summary.cancelled} скасовано`}
        />
      </div>

      {/* Per-courier table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">По курʼєрах</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Курʼєр</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Всього</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Виконано</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Провалено</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Сер. час</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {perCourier.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Немає даних
                </td>
              </tr>
            )}
            {perCourier.map((row) => (
              <tr key={row.courier_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{row.courier_name}</td>
                <td className="px-4 py-3 text-right text-gray-700">{row.total}</td>
                <td className="px-4 py-3 text-right text-green-700">{row.completed}</td>
                <td className="px-4 py-3 text-right text-red-600">{row.failed}</td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {row.avg_minutes != null ? `${Math.round(row.avg_minutes)} хв` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
