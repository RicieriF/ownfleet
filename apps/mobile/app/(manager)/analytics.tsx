/**
 * Manager Analytics screen.
 *
 * Period selector: Тиждень (7d) / Місяць (30d).
 * Data:
 *   GET /api/v1/analytics/summary?from=&to=  — summary metrics
 *   GET /api/v1/analytics/couriers?from=&to= — courier leaderboard
 *
 * Hero card: total | completed | completion_rate
 * Metrics row: avg delivery time | geo_match_rate | failed
 * Courier leaderboard: sorted by completed desc
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '@/api/client';
import { ManagerTabBar } from '@/components/manager-tab-bar';
import type { AnalyticsSummary, AnalyticsCourierStat } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────

type Period = '7d' | '30d';

// ── Helpers ────────────────────────────────────────────────────────────────

function periodDates(p: Period): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - (p === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

function formatRate(rate: number): string {
  return `${Math.round(rate)}%`;
}

function formatMinutes(min: number | null): string {
  if (min === null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h}г ${m}хв`;
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const [period, setPeriod] = useState<Period>('7d');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [couriers, setCouriers] = useState<AnalyticsCourierStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (p: Period, isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError('');
    const { from, to } = periodDates(p);
    try {
      const [s, c] = await Promise.all([
        apiGet<AnalyticsSummary>(`/api/v1/analytics/summary?from=${from}&to=${to}`),
        apiGet<AnalyticsCourierStat[]>(`/api/v1/analytics/couriers?from=${from}&to=${to}`),
      ]);
      setSummary(s);
      setCouriers(c.sort((a, b) => b.completed - a.completed));
    } catch {
      setError('Не вдалося завантажити аналітику');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  function handlePeriod(p: Period) {
    setPeriod(p);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Аналітика</Text>
          <View style={styles.periodRow}>
            {(['7d', '30d'] as Period[]).map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.periodBtn, period === p && styles.periodBtnActive]}
                onPress={() => handlePeriod(p)}
                activeOpacity={0.7}
              >
                <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                  {p === '7d' ? 'Тиждень' : 'Місяць'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color="#9c9b96" style={{ marginTop: 60 }} />
        ) : error ? (
          <View style={styles.errorWrap}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              onPress={() => load(period)}
              style={styles.retryBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.retryText}>Повторити</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(period, true); }}
                tintColor="#9c9b96"
              />
            }
          >
            {summary && (
              <>
                {/* ── Hero card ─────────────────────────────────────────── */}
                <View style={styles.heroCard}>
                  <HeroColumn
                    value={String(summary.totals.total)}
                    label="всього"
                  />
                  <View style={styles.heroDivider} />
                  <HeroColumn
                    value={String(summary.totals.completed)}
                    label="виконано"
                    accent="green"
                  />
                  <View style={styles.heroDivider} />
                  <HeroColumn
                    value={formatRate(summary.metrics.completion_rate)}
                    label="% виконання"
                    mono={false}
                    accent={summary.metrics.completion_rate >= 85 ? 'green' : summary.metrics.completion_rate >= 70 ? 'amber' : 'red'}
                  />
                </View>

                {/* ── Metrics row ───────────────────────────────────────── */}
                <View style={styles.metricsRow}>
                  <MetricCard
                    icon="time-outline"
                    label="Середній час"
                    value={formatMinutes(summary.metrics.avg_delivery_minutes)}
                  />
                  <MetricCard
                    icon="location-outline"
                    label="Геопідтвердження"
                    value={formatRate(summary.metrics.geo_match_rate)}
                  />
                  <MetricCard
                    icon="close-circle-outline"
                    label="Провалено"
                    value={String(summary.totals.failed)}
                    valueColor={summary.totals.failed > 0 ? '#ef4444' : '#9c9b96'}
                  />
                </View>

                {/* ── Failed / cancelled breakdown ─────────────────────── */}
                {(summary.totals.failed > 0 || summary.totals.cancelled > 0) && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionTitle}>СТАТУСИ</Text>
                    </View>
                    <View style={styles.card}>
                      <StatusRow
                        label="Виконано"
                        count={summary.totals.completed}
                        total={summary.totals.total}
                        color="#22c55e"
                      />
                      <View style={styles.divider} />
                      <StatusRow
                        label="Провалено"
                        count={summary.totals.failed}
                        total={summary.totals.total}
                        color="#ef4444"
                      />
                      <View style={styles.divider} />
                      <StatusRow
                        label="Скасовано"
                        count={summary.totals.cancelled}
                        total={summary.totals.total}
                        color="#78776e"
                      />
                    </View>
                  </View>
                )}

                {/* ── Courier leaderboard ───────────────────────────────── */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>КУРЄРИ</Text>
                  </View>

                  {couriers.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Text style={styles.emptyText}>Немає даних за цей період</Text>
                    </View>
                  ) : (
                    <View style={styles.card}>
                      {couriers.map((courier, i) => (
                        <View key={courier.courier_id}>
                          <CourierRow courier={courier} rank={i + 1} />
                          {i < couriers.length - 1 && <View style={styles.divider} />}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </>
            )}

            <View style={{ height: 16 }} />
          </ScrollView>
        )}

        <ManagerTabBar />
      </SafeAreaView>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function HeroColumn({
  value,
  label,
  mono = true,
  accent,
}: {
  value: string;
  label: string;
  mono?: boolean;
  accent?: 'green' | 'amber' | 'red';
}) {
  const accentColor = accent === 'green' ? '#22c55e' : accent === 'amber' ? '#f59e0b' : accent === 'red' ? '#ef4444' : '#faf9f6';
  return (
    <View style={styles.heroCol}>
      <Text style={[mono ? styles.heroValueMono : styles.heroValue, accent ? { color: accentColor } : null]}>
        {value}
      </Text>
      <Text style={styles.heroLabel}>{label}</Text>
    </View>
  );
}

function MetricCard({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={18} color="#78776e" />
      <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StatusRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={styles.statusBarWrap}>
        <View style={[styles.statusBar, { width: `${pct}%`, backgroundColor: color, opacity: 0.3 }]} />
      </View>
      <Text style={styles.statusCount}>{count}</Text>
      <Text style={styles.statusPct}>{pct}%</Text>
    </View>
  );
}

function CourierRow({
  courier,
  rank,
}: {
  courier: AnalyticsCourierStat;
  rank: number;
}) {
  const avgTime = formatMinutes(courier.avg_delivery_minutes);
  const rate = formatRate(courier.completion_rate);

  return (
    <View style={styles.courierRow}>
      <Text style={styles.courierRank}>{rank}</Text>
      <View style={styles.courierInfo}>
        <Text style={styles.courierName} numberOfLines={1}>{courier.courier_name}</Text>
        <Text style={styles.courierSub}>
          <Text style={styles.courierMono}>{courier.completed}</Text>
          <Text> виконано · </Text>
          <Text style={styles.courierMono}>{avgTime}</Text>
          <Text> серед. · </Text>
          <Text style={styles.courierMono}>{rate}</Text>
        </Text>
        {courier.failed > 0 && (
          <Text style={styles.courierFailed}>{courier.failed} провалено</Text>
        )}
      </View>
      <Text style={styles.courierTotal}>{courier.total}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    marginBottom: 12,
  },
  periodRow: { flexDirection: 'row', gap: 8 },
  periodBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1a1917',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.06)',
  },
  periodBtnActive: {
    backgroundColor: '#3a3935',
    borderColor: 'rgba(250,249,246,0.16)',
  },
  periodText: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    color: '#78776e',
  },
  periodTextActive: { color: '#faf9f6' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },

  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 15, color: '#78776e', fontFamily: 'Manrope_400Regular' },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#1a1917',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  retryText: { fontSize: 14, color: '#9c9b96', fontFamily: 'Manrope_500Medium' },

  // Hero
  heroCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    overflow: 'hidden',
  },
  heroCol: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 4,
    gap: 4,
  },
  heroDivider: {
    width: 1,
    backgroundColor: 'rgba(250,249,246,0.08)',
    marginVertical: 12,
  },
  heroValueMono: {
    fontSize: 24,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#faf9f6',
  },
  heroValue: {
    fontSize: 20,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    textAlign: 'center',
  },
  heroLabel: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    color: '#78776e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Metrics row
  metricsRow: { flexDirection: 'row', gap: 8 },
  metricCard: {
    flex: 1,
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  metricValue: {
    fontSize: 15,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#faf9f6',
    textAlign: 'center',
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    color: '#78776e',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  // Sections
  section: { gap: 8 },
  sectionHeader: { paddingHorizontal: 2 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Manrope_600SemiBold',
    color: '#78776e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    overflow: 'hidden',
  },
  emptyCard: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { fontSize: 14, color: '#78776e', fontFamily: 'Manrope_400Regular' },
  divider: { height: 1, backgroundColor: 'rgba(250,249,246,0.06)', marginHorizontal: 16 },

  // Status rows
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  statusLabel: { fontSize: 13, fontFamily: 'Manrope_500Medium', color: '#faf9f6', width: 78 },
  statusBarWrap: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(250,249,246,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  statusBar: { height: 4, borderRadius: 2 },
  statusCount: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#faf9f6',
    minWidth: 28,
    textAlign: 'right',
  },
  statusPct: {
    fontSize: 11,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#78776e',
    minWidth: 34,
    textAlign: 'right',
  },

  // Courier rows
  courierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  courierRank: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#78776e',
    width: 18,
    textAlign: 'center',
  },
  courierInfo: { flex: 1, gap: 2 },
  courierName: { fontSize: 14, fontFamily: 'Manrope_600SemiBold', color: '#faf9f6' },
  courierSub: { fontSize: 11, fontFamily: 'Manrope_400Regular', color: '#78776e' },
  courierMono: { fontFamily: 'JetBrainsMono_400Regular' },
  courierFailed: { fontSize: 11, fontFamily: 'Manrope_400Regular', color: '#ef4444' },
  courierTotal: {
    fontSize: 18,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#9c9b96',
  },
});
