/**
 * Statistics screen — courier's performance metrics.
 *
 * Period selector: Тиждень (7d) / Місяць (30d) — client-side filter.
 * Data:
 *   GET /api/v1/deliveries/my-history — last 50 deliveries
 *   GET /api/v1/shifts/my-history    — last 60 completed shifts
 *
 * Hero card: completed deliveries | active time | distance
 * Trend: shown only when history covers both current + previous periods.
 * Recent deliveries: last 5, filtered by completed_at.
 * By day: delivery counts from deliveries (completed_at), distance from shifts (started_at).
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
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '@/api/client';
import { DeliveryHistoryItem, ShiftHistoryItem } from '@/types';
import { TabBar } from '@/components/tab-bar';

// ── Types ──────────────────────────────────────────────────────────────────

type Period = '7d' | '30d';

interface DayStat {
  date: string;       // YYYY-MM-DD
  completed: number;
  failed: number;
  km: number;
}

interface PeriodStats {
  completed: number;
  failed: number;
  activeMinutes: number;
  km: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function periodDays(p: Period): number {
  return p === '7d' ? 7 : 30;
}

function periodStart(p: Period): Date {
  return new Date(Date.now() - periodDays(p) * 24 * 60 * 60 * 1000);
}

/** Delivery's effective date: completed_at if available, else assigned_at */
function deliveryDate(d: DeliveryHistoryItem): Date {
  return new Date(d.completed_at ?? d.assigned_at);
}

function computeStats(
  deliveries: DeliveryHistoryItem[],
  shifts: ShiftHistoryItem[],
  from: Date,
): PeriodStats {
  const periodDeliveries = deliveries.filter((d) => deliveryDate(d) >= from);
  const completed = periodDeliveries.filter((d) => d.status === 'completed').length;
  const failed = periodDeliveries.filter((d) => d.status === 'failed').length;

  const periodShifts = shifts.filter((s) => new Date(s.started_at) >= from);

  const activeMinutes = periodShifts.reduce((acc, s) => {
    const ms = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
    return acc + ms / 60_000;
  }, 0);

  const km = periodShifts.reduce((acc, s) => {
    return acc + parseFloat(s.total_distance_km || '0');
  }, 0);

  return { completed, failed, activeMinutes: Math.round(activeMinutes), km };
}

/**
 * "По днях" — delivery counts from deliveries.completed_at (accurate),
 * distance from shifts.started_at (approximate, no per-delivery distance in API).
 */
function buildDayStats(
  deliveries: DeliveryHistoryItem[],
  shifts: ShiftHistoryItem[],
  days: number,
): DayStat[] {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const map: Record<string, DayStat> = {};

  for (const d of deliveries) {
    const dt = deliveryDate(d);
    if (dt.getTime() < cutoffMs) continue;
    const dateStr = dt.toISOString().split('T')[0];
    if (!map[dateStr]) map[dateStr] = { date: dateStr, completed: 0, failed: 0, km: 0 };
    if (d.status === 'completed') map[dateStr].completed += 1;
    else if (d.status === 'failed') map[dateStr].failed += 1;
  }

  for (const s of shifts) {
    if (new Date(s.started_at).getTime() < cutoffMs) continue;
    const dateStr = s.started_at.split('T')[0];
    if (!map[dateStr]) map[dateStr] = { date: dateStr, completed: 0, failed: 0, km: 0 };
    map[dateStr].km += parseFloat(s.total_distance_km || '0');
  }

  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date));
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
  return `${Math.round(km * 10) / 10} км`;
}

function trendLabel(current: number, previous: number): string | null {
  if (previous === 0 && current === 0) return null;
  const diff = current - previous;
  if (diff === 0) return 'як минулого';
  return `${diff > 0 ? '↑ +' : '↓ '}${diff} від минулого`;
}

function formatDayLabel(dateStr: string): string {
  const todayStr = new Date().toISOString().split('T')[0];
  if (dateStr === todayStr) return 'Сьогодні';
  const date = new Date(dateStr + 'T12:00:00');
  const name = date.toLocaleDateString('uk-UA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '';
  const min = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000,
  );
  if (min < 1) return '';
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

  const days = periodDays(period);
  const from = periodStart(period);
  const prevFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);

  const current = computeStats(deliveries, shifts, from);
  const previous = computeStats(deliveries, shifts, prevFrom);
  const previousOnly: PeriodStats = {
    completed: previous.completed - current.completed,
    failed: previous.failed - current.failed,
    activeMinutes: previous.activeMinutes - current.activeMinutes,
    km: previous.km - current.km,
  };

  /**
   * Trend is reliable only when we have deliveries older than prevFrom.
   * If the API returned max 50 items and oldest is newer than prevFrom,
   * the previous-period bucket is incomplete → hide trend.
   */
  const oldestDeliveryMs = deliveries.length > 0
    ? Math.min(...deliveries.map((d) => deliveryDate(d).getTime()))
    : Date.now();
  const trendReliable = deliveries.length > 0 && oldestDeliveryMs <= prevFrom.getTime();

  const recentDeliveries = deliveries
    .filter((d) => deliveryDate(d) >= from)
    .slice(0, 5);

  const dayStats = buildDayStats(deliveries, shifts, days);
  const todayStr = new Date().toISOString().split('T')[0];

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* FIX #1: hide Stack navigator header — screen has own header */}
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Статистика</Text>

          {/* FIX #5: Тиждень / Місяць per DESIGN.md */}
          <View style={styles.periodRow}>
            {(['7d', '30d'] as Period[]).map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.periodBtn, period === p && styles.periodBtnActive]}
                onPress={() => setPeriod(p)}
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
            {/* FIX #4: failed count shown as sub-text in deliveries column */}
            <View style={styles.heroCard}>
              <HeroColumn
                value={String(current.completed)}
                label="виконано"
                subLabel={current.failed > 0 ? `${current.failed} провалено` : undefined}
                trend={trendReliable
                  ? trendLabel(current.completed, previousOnly.completed)
                  : null}
              />
              <View style={styles.heroDivider} />
              <HeroColumn
                value={formatActiveTime(current.activeMinutes)}
                label="у роботі"
                trend={trendReliable
                  ? trendLabel(current.activeMinutes, previousOnly.activeMinutes)
                  : null}
                mono={false}
              />
              <View style={styles.heroDivider} />
              <HeroColumn
                value={formatKm(current.km)}
                label="відстань"
                trend={trendReliable
                  ? trendLabel(Math.round(current.km), Math.round(previousOnly.km))
                  : null}
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
                      <DeliveryRow delivery={d} onPress={() => router.push({
                        pathname: '/(app)/delivery-detail',
                        params: {
                          deliveryId: d.id,
                          status: d.status,
                          address: d.order.address,
                          external_id: d.order.external_id ?? '',
                          assigned_at: d.assigned_at,
                          started_at: d.started_at ?? '',
                          completed_at: d.completed_at ?? '',
                        },
                      })} />
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
                  <Text style={styles.emptyText}>Активності за цей період немає</Text>
                </View>
              ) : (
                <View style={styles.card}>
                  {dayStats.map((day, i) => {
                    const isToday = day.date === todayStr;
                    return (
                      <View key={day.date}>
                        {/* FIX #6: TouchableOpacity + chevron per DESIGN.md */}
                        <TouchableOpacity
                          style={[styles.dayRow, isToday && styles.dayRowToday]}
                          activeOpacity={0.7}
                          onPress={() => router.push({ pathname: '/(app)/day-detail', params: { date: day.date } })}
                        >
                          <View style={styles.dayDot} />
                          <View style={styles.dayContent}>
                            <Text style={styles.dayName}>{formatDayLabel(day.date)}</Text>
                            <Text style={styles.daySub}>
                              <Text style={styles.daySubMono}>{day.completed}</Text>
                              <Text> доставок</Text>
                              {day.failed > 0 && (
                                <Text> · <Text style={styles.daySubMono}>{day.failed}</Text> провалено</Text>
                              )}
                              {day.km > 0 && (
                                <Text> · <Text style={styles.daySubMono}>{Math.round(day.km * 10) / 10}</Text> км</Text>
                              )}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={14} color="#3a3935" />
                        </TouchableOpacity>
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
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function HeroColumn({
  value,
  label,
  subLabel,
  trend,
  mono = true,
}: {
  value: string;
  label: string;
  subLabel?: string;
  trend: string | null;
  mono?: boolean;
}) {
  return (
    <View style={styles.heroCol}>
      <Text style={mono ? styles.heroValueMono : styles.heroValue}>{value}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
      {subLabel !== undefined && (
        <Text style={styles.heroSubLabel}>{subLabel}</Text>
      )}
      {trend !== null && <Text style={styles.heroTrend}>{trend}</Text>}
    </View>
  );
}

function DeliveryRow({ delivery, onPress }: { delivery: DeliveryHistoryItem; onPress: () => void }) {
  const isCompleted = delivery.status === 'completed';
  // FIX #2: use completed_at for time display
  const time = formatTime(delivery.completed_at ?? delivery.assigned_at);
  const duration = formatDuration(delivery.started_at, delivery.completed_at);
  const orderLabel = delivery.order.external_id
    ? `№ ${delivery.order.external_id}`
    : delivery.order.address.split(',')[0];

  return (
    <TouchableOpacity style={styles.deliveryRow} onPress={onPress} activeOpacity={0.7}>
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
        {time}{duration ? ` · ${duration}` : ''}
      </Text>
    </TouchableOpacity>
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
  periodText: { fontSize: 13, fontFamily: 'Manrope_500Medium', color: '#78776e' },
  periodTextActive: { color: '#faf9f6' },

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
  heroSubLabel: {
    fontSize: 10,
    fontFamily: 'Manrope_400Regular',
    color: '#78776e',
    textAlign: 'center',
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
  sectionLink: { fontSize: 13, fontFamily: 'Manrope_500Medium', color: '#9c9b96' },

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
  dayRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
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
    flexShrink: 0,
  },
  dayContent: { flex: 1, gap: 2 },
  dayName: { fontSize: 14, fontFamily: 'Manrope_500Medium', color: '#faf9f6' },
  daySub: { fontSize: 11, fontFamily: 'Manrope_400Regular', color: '#78776e' },
  daySubMono: { fontFamily: 'JetBrainsMono_400Regular' },
});
