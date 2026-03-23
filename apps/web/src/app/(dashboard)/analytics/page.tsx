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
    <div className="bg-[var(--sf)] rounded-lg border border-[var(--br)] px-5 py-4 card-shine">
      <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">{label}</p>
      <p className="text-3xl font-bold text-[var(--t1)] mt-1.5 mono">{value}</p>
      {sub && <p className="text-xs text-[var(--t4)] mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function AnalyticsPage() {
  const { summary, perCourier } = await fetchAnalytics();

  const { totals, metrics } = summary;
  const completionPct = metrics.completion_rate != null ? `${metrics.completion_rate}%` : '—';
  const avgMin =
    metrics.avg_delivery_minutes != null
      ? `${Math.round(metrics.avg_delivery_minutes)} хв`
      : '—';

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--t1)] mb-6">Аналітика</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Доставок за 30 днів" value={totals.total} />
        <StatCard
          label="Виконано"
          value={completionPct}
          sub={`${totals.completed} з ${totals.total}`}
        />
        <StatCard
          label="Середній час"
          value={avgMin}
          sub="від старту до завершення"
        />
        <StatCard
          label="Провалено / Скасовано"
          value={totals.failed + totals.cancelled}
          sub={`${totals.failed} провалено · ${totals.cancelled} скасовано`}
        />
      </div>

      {/* Per-courier table */}
      <div className="bg-[var(--sf)] rounded-lg border border-[var(--br)] overflow-hidden card-shine">
        <div className="px-5 py-3.5 border-b border-[var(--br)]">
          <h2 className="text-sm font-semibold text-[var(--t1)]">По курʼєрах</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--br)]">
            <tr>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Курʼєр</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Всього</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Виконано</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Провалено</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">Сер. час</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">% успіху</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--br)]">
            {perCourier.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--t4)] text-sm">
                  Немає даних за обраний період
                </td>
              </tr>
            )}
            {perCourier.map((row) => (
              <tr key={row.courier_id} className="hover:bg-[var(--s2)] transition-colors">
                <td className="px-3 py-2.5 font-medium text-[var(--t1)]">{row.courier_name}</td>
                <td className="px-3 py-2.5 text-right text-[var(--t2)] mono">{row.total}</td>
                <td className="px-3 py-2.5 text-right text-[var(--ok)] mono">{row.completed}</td>
                <td className="px-3 py-2.5 text-right text-[var(--bad)] mono">{row.failed}</td>
                <td className="px-3 py-2.5 text-right text-[var(--t3)] mono">
                  {row.avg_delivery_minutes != null
                    ? `${Math.round(row.avg_delivery_minutes)} хв`
                    : '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-[var(--t2)] mono">
                  {row.completion_rate != null ? `${row.completion_rate}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
