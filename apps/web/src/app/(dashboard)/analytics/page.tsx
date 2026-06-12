import { apiFetch } from '@/lib/api';
import { AnalyticsSummary, CourierAnalytics } from '@/types';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';

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
      {sub && <p className="text-xs text-[var(--t3)] mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function AnalyticsPage() {
  const locale = await getLocale();
  const { summary, perCourier } = await fetchAnalytics();

  const { totals, metrics } = summary;
  const completionPct = metrics.completion_rate != null ? `${metrics.completion_rate}%` : '—';
  const avgMin =
    metrics.avg_delivery_minutes != null
      ? `${Math.round(metrics.avg_delivery_minutes)} ${t('хв', locale)}`
      : '—';

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--t1)] mb-6">{t('Аналітика', locale)}</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label={t('Доставок за 30 днів', locale)} value={totals.total} />
        <StatCard
          label={t('Виконано', locale)}
          value={completionPct}
          sub={`${totals.completed} ${t('з', locale)} ${totals.total}`}
        />
        <StatCard
          label={t('Середній час', locale)}
          value={avgMin}
          sub={t('від старту до завершення', locale)}
        />
        <StatCard
          label={t('Провалено / Скасовано', locale)}
          value={totals.failed + totals.cancelled}
          sub={`${totals.failed} ${t('провалено', locale)} · ${totals.cancelled} ${t('скасовано', locale)}`}
        />
      </div>

      {/* Per-courier table */}
      <div className="bg-[var(--sf)] rounded-lg border border-[var(--br)] overflow-hidden card-shine">
        <div className="px-5 py-3.5 border-b border-[var(--br)]">
          <h2 className="text-sm font-semibold text-[var(--t1)]">{t('По курʼєрах', locale)}</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--br)]">
            <tr>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">{t('Курʼєр', locale)}</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">{t('Всього', locale)}</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">{t('Виконано', locale)}</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">{t('Провалено', locale)}</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">{t('Сер. час', locale)}</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--t4)]">{t('% успіху', locale)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--br)]">
            {perCourier.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--t3)] text-sm">
                  {t('Немає даних за обраний період', locale)}
                </td>
              </tr>
            )}
            {perCourier.map((row) => (
              <tr key={row.courier_id} className="hover:bg-[var(--s2)] transition-colors">
                <td className="px-3 py-2.5 font-medium text-[var(--t1)]">{row.courier_name}</td>
                <td className="px-3 py-2.5 text-right text-[var(--t2)] mono">{row.total}</td>
                <td className="px-3 py-2.5 text-right text-[var(--t2)] mono">{row.completed}</td>
                <td className="px-3 py-2.5 text-right text-[var(--t2)] mono">{row.failed}</td>
                <td className="px-3 py-2.5 text-right text-[var(--t3)] mono">
                  {row.avg_delivery_minutes != null
                    ? `${Math.round(row.avg_delivery_minutes)} ${t('хв', locale)}`
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
