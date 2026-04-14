/**
 * Statistics screen — courier's performance metrics.
 *
 * Period selector: 7 днів / 30 днів (client-side filter).
 * Data:
 *   GET /api/v1/deliveries/my-history — last 50 deliveries
 *   GET /api/v1/shifts/my-history    — last 60 completed shifts
 *
 * Hero card: deliveries | active time | distance
 * Trend: current period vs previous period of same length.
 * Recent deliveries: last 5 completed/failed.
 * By day: shifts grouped by date, last 14 days.
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '@/api/client';
import { DeliveryHistoryItem, ShiftHistoryItem } from '@/types';
import { TabBar } from '@/components/tab-bar';

// ── Types ──────────────────────────────────────────────────────────────────

type Period = '7d' | '30d';

interface DayStat {
  date: string;         // YYYY-MM-DD
  deliveries: number;
  km: number;
}

interface PeriodStats {
  deliveries: number;
  activeMinutes: number;
  km: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function periodStart(p: Period): Date {
  const days = p === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function computeStats(
  deliveries: DeliveryHistoryItem[],
  shifts: ShiftHistoryItem[],
  from: Date,
): PeriodStats {
  const completedDeliveries = deliveries.filter(
    (d) => d.status === 'completed' && new Date(d.assigned_at) >= from,
  );
  const periodShifts = shifts.filter((s) => new Date(s.started_at) >= from);

  const activeMinutes = periodShifts.reduce((acc, s) => {
    const ms = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
    return acc + ms / 60_000;
  }, 0);

  const km = periodShifts.reduce((acc, s) => {
    return acc + parseFloat(s.total_distance_km || '0');
  }, 0);

  return {
    deliveries: completedDeliveries.length,
    activeMinutes: Math.round(activeMinutes),
    km,
  };
}

function formatActiveTime(minutes: number): string {
  if (minutes < 1) return '0 хв';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h}г ${m}хв`;
}

function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 10) / 10} км`;
  return `${Math.round(km * 10) / 10} км`;
}

function trendLabel(current: number, previous: number): string | null {
  if (previous === 0 && current === 0) return null;
  const diff = current - previous;
  if (diff === 0) return 'як минулого';
  const arrow = diff > 0 ? '↑' : '↓';
  const abs = Math.abs(diff);
  return `${arrow} ${diff > 0 ? '+' : ''}${abs} від минулого`;
}

function buildDayStats(shifts: ShiftHistoryItem[], days: number): DayStat[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const map: Record<string, DayStat> = {};

  for (const s of shifts) {
    const date = s.started_at.split('T')[0];
    if (new Date(s.started_at) < cutoff) continue;
    if (!map[date]) map[date] = { date, deliveries: 0, km: 0 };
    map[date].deliveries += s.total_deliveries;
    map[date].km += parseFloat(s.total_distance_km || '0');
  }

  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date));
}

function formatDayLabel(dateStr: string): string {
  const todayStr = new Date().toISOString().split('T')[0];
  if (dateStr === todayStr) return 'Сьогодні';
  const date = new Date(dateStr + 'T12:00:00');
  const name = date.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} хв`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}г ${m}хв` : `${h} год`;
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('7d');
  const [deliveries, setDeliveries] = useState<DeliveryHistoryItem[]>([]);
  const [shifts, setShifts] = useState<ShiftHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError('');
    try {
      const [d, s] = await Promise.all([
        apiGet<DeliveryHistoryItem[]>('/api/v1/deliveries/my-history'),
        apiGet<ShiftHistoryItem[]>('/api/v1/shifts/my-history'),
      ]);
      setDeliveries(d);
      setShifts(s);
    } catch {
      setError('Не вдалося завантажити статистику');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derived stats ──────────────────────────────────────────────────────

  const days = period === '7d' ? 7 : 30;
  const from = periodStart(period);
  const prevFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);

  const current = computeStats(deliveries, shifts, from);
  const previous = computeStats(deliveries, shifts, prevFrom);
  // Previous period only counts what's between prevFrom and from
  const previousOnly: PeriodStats = {
    deliveries: previous.deliveries - current.deliveries,
    activeMinutes: previous.activeMinutes - current.activeMinutes,
    km: previous.km - current.km,
  };

  const recentDeliveries = deliveries
    .filter((d) => new Date(d.assigned_at) >= from)
    .slice(0, 5);

  const dayStats = buildDayStats(shifts, days);
  const todayStr = new Date().toISOString().split('T')[0];

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Статистика</Text>

        {/* Period selector */}
        <View style={styles.periodRow}>
          {(['7d', '30d'] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              onPress={() => setPeriod(p)}
              activeOpacity={0.7}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {p === '7d' ? '7 днів' : '30 днів'}
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
          <TouchableOpacity onPress={() => load()} style={styles.retryBtn} activeOpacity={0.7}>
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
              onRefresh={() => { setRefreshing(true); load(true); }}
              tintColor="#9c9b96"
            />
          }
        >
          {/* ── Hero card ────────────────────────────────────────────── */}
          <View style={styles.heroCard}>
            <HeroColumn
              value={String(current.deliveries)}
              label="доставок"
              trend={trendLabel(current.deliveries, previousOnly.deliveries)}
            />
            <View style={styles.heroDivider} />
            <HeroColumn
              value={formatActiveTime(current.activeMinutes)}
              label="у роботі"
              trend={trendLabel(current.activeMinutes, previousOnly.activeMinutes)}
              mono={false}
            />
            <View style={styles.heroDivider} />
            <HeroColumn
              value={formatKm(current.km)}
              label="відстань"
              trend={trendLabel(Math.round(current.km), Math.round(previousOnly.km))}
              mono={false}
            />
          </View>

          {/* ── Recent deliveries ─────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>ОСТАННІ ДОСТАВКИ</Text>
              <TouchableOpacity
                onPress={() => router.push('/(app)/history')}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionLink}>Всі →</Text>
              </TouchableOpacity>
            </View>

            {recentDeliveries.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>Доставок за цей період немає</Text>
              </View>
            ) : (
              <View style={styles.card}>
                {recentDeliveries.map((d, i) => (
                  <View key={d.id}>
                    <DeliveryRow delivery={d} />
                    {i < recentDeliveries.length - 1 && <View style={styles.divider} />}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* ── By day ──────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>ПО ДНЯХ</Text>
            </View>

            {dayStats.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>Змін за цей період немає</Text>
              </View>
            ) : (
              <View style={styles.card}>
                {dayStats.map((day, i) => {
                  const isToday = day.date === todayStr;
                  return (
                    <View key={day.date}>
                      <View style={[styles.dayRow, isToday && styles.dayRowToday]}>
                        <View style={styles.dayDot} />
                        <View style={styles.dayContent}>
                          <Text style={styles.dayName}>{formatDayLabel(day.date)}</Text>
                          <Text style={styles.daySub}>
                            <Text style={styles.daySubMono}>{day.deliveries}</Text>
                            <Text> доставок · </Text>
                            <Text style={styles.daySubMono}>{Math.round(day.km * 10) / 10}</Text>
                            <Text> км</Text>
                          </Text>
                        </View>
                      </View>
                      {i < dayStats.length - 1 && <View style={styles.divider} />}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <View style={{ height: 16 }} />
        </ScrollView>
      )}

      <TabBar />
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function HeroColumn({
  value,
  label,
  trend,
  mono = true,
}: {
  value: string;
  label: string;
  trend: string | null;
  mono?: boolean;
}) {
  return (
    <View style={styles.heroCol}>
      <Text style={mono ? styles.heroValueMono : styles.heroValue}>{value}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
      {trend !== null && <Text style={styles.heroTrend}>{trend}</Text>}
    </View>
  );
}

function DeliveryRow({ delivery }: { delivery: DeliveryHistoryItem }) {
  const isCompleted = delivery.status === 'completed';
  const duration = formatDuration(delivery.started_at, delivery.completed_at);
  const time = formatTime(delivery.completed_at ?? delivery.assigned_at);
  const orderLabel = delivery.order.external_id
    ? `№ ${delivery.order.external_id}`
    : delivery.order.address.split(',')[0];

  return (
    <View style={styles.deliveryRow}>
      <View style={styles.deliveryRowTop}>
        <View style={[styles.dot, isCompleted ? styles.dotOk : styles.dotFail]} />
        <Text style={styles.deliveryOrderId} numberOfLines={1}>
          {orderLabel}
        </Text>
        <Ionicons name="chevron-forward" size={14} color="#3a3935" style={{ marginLeft: 'auto' }} />
      </View>
      <Text style={styles.deliveryAddress} numberOfLines={1}>
        {delivery.order.address}
      </Text>
      <Text style={styles.deliverySub}>
        {time}
        {duration !== '—' ? ` · ${duration}` : ''}
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },

  // Header
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
  periodRow: {
    flexDirection: 'row',
    gap: 8,
  },
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
    fontFamily: 'Manrope_500Medium',
    color: '#78776e',
  },
  periodTextActive: {
    color: '#faf9f6',
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },

  // Error
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

  // Hero card
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
    fontFamily: 'Manrope_500Medium',
    color: '#78776e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroTrend: {
    fontSize: 11,
    fontFamily: 'Manrope_500Medium',
    color: '#78776e',
    textAlign: 'center',
  },

  // Sections
  section: { gap: 8 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Manrope_600SemiBold',
    color: '#78776e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionLink: {
    fontSize: 13,
    fontFamily: 'Manrope_500Medium',
    color: '#9c9b96',
  },

  // Cards
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

  // Delivery row
  deliveryRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
  deliveryRowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOk: { backgroundColor: '#22c55e' },
  dotFail: { backgroundColor: '#78776e' },
  deliveryOrderId: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#faf9f6',
    flex: 1,
  },
  deliveryAddress: {
    fontSize: 13,
    fontFamily: 'Manrope_400Regular',
    color: '#9c9b96',
    marginLeft: 14,
  },
  deliverySub: {
    fontSize: 11,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#78776e',
    marginLeft: 14,
    marginTop: 2,
  },

  // Day row
  dayRow: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dayRowToday: {
    borderLeftWidth: 2,
    borderLeftColor: '#3a3935',
    paddingLeft: 14,
  },
  dayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3a3935',
    marginTop: 5,
  },
  dayContent: { flex: 1, gap: 2 },
  dayName: {
    fontSize: 14,
    fontFamily: 'Manrope_500Medium',
    color: '#faf9f6',
  },
  daySub: {
    fontSize: 11,
    fontFamily: 'Manrope_400Regular',
    color: '#78776e',
  },
  daySubMono: {
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
