/**
 * Day Detail screen.
 *
 * Reached from Statistics screen → "По днях" row (tap).
 *
 * Shows deliveries for a specific date:
 *   - Day name + full date in header
 *   - Mini summary card: delivery count + active time
 *   - Delivery list → each row taps to delivery-detail
 *
 * Fetches GET /api/v1/deliveries/my-history (same as stats screen),
 * then filters client-side to the requested date.
 *
 * Params:
 *   date: string (YYYY-MM-DD)
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '@/api/client';
import type { DeliveryHistoryItem } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function deliveryDate(d: DeliveryHistoryItem): Date {
  return new Date(d.completed_at ?? d.assigned_at);
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(started: string | null | undefined, completed: string | null | undefined): string | null {
  if (!started || !completed) return null;
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return null;
  if (min < 60) return `${min} хв`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} год` : `${h}г ${m}хв`;
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('uk-UA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatActiveMinutes(minutes: number): string {
  if (minutes < 1) return '0 хв';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h}г ${m}хв`;
}

// ── Delivery row ───────────────────────────────────────────────────────────

function DeliveryRow({
  delivery,
  onPress,
}: {
  delivery: DeliveryHistoryItem;
  onPress: () => void;
}) {
  const isCompleted = delivery.status === 'completed';
  const orderLabel = delivery.order.external_id
    ? `№ ${delivery.order.external_id}`
    : delivery.order.address.split(',')[0];
  const time = formatTime(delivery.completed_at ?? delivery.assigned_at);
  const dur = formatDuration(delivery.started_at, delivery.completed_at);

  return (
    <TouchableOpacity style={styles.deliveryRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.deliveryTop}>
        <View style={[styles.dot, isCompleted ? styles.dotOk : styles.dotFail]} />
        <Text style={styles.deliveryId} numberOfLines={1}>{orderLabel}</Text>
        <Ionicons name="chevron-forward" size={14} color="#3a3935" style={styles.chevron} />
      </View>
      <Text style={styles.deliveryAddress} numberOfLines={1}>
        {delivery.order.address}
      </Text>
      <Text style={styles.deliverySub}>
        {time}{dur ? ` · ${dur}` : ''}
      </Text>
    </TouchableOpacity>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function DayDetailScreen() {
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date: string }>();

  const [deliveries, setDeliveries] = useState<DeliveryHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const all = await apiGet<DeliveryHistoryItem[]>('/api/v1/deliveries/my-history');
      const filtered = all.filter((d) => {
        const dDate = deliveryDate(d).toISOString().split('T')[0];
        return dDate === date;
      });
      setDeliveries(filtered);
    } catch {
      // Non-critical: show empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const completed = deliveries.filter((d) => d.status === 'completed').length;
  const failed = deliveries.filter((d) => d.status === 'failed').length;
  const totalMinutes = deliveries.reduce((acc, d) => {
    if (!d.started_at || !d.completed_at) return acc;
    return acc + (new Date(d.completed_at).getTime() - new Date(d.started_at).getTime()) / 60_000;
  }, 0);

  function handleDeliveryPress(d: DeliveryHistoryItem) {
    router.push({
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
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#9c9b96" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{formatFullDate(date)}</Text>
          {!loading && (
            <Text style={styles.headerSub}>
              {deliveries.length} {deliveries.length === 1 ? 'доставка' : deliveries.length < 5 ? 'доставки' : 'доставок'}
            </Text>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#78776e" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#78776e" />
          }
        >
          {/* Summary card */}
          {deliveries.length > 0 && (
            <View style={styles.summaryCard}>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryValue}>{completed}</Text>
                <Text style={styles.summaryLabel}>виконано</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryValue}>{failed}</Text>
                <Text style={styles.summaryLabel}>не доставлено</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryValue}>{formatActiveMinutes(Math.round(totalMinutes))}</Text>
                <Text style={styles.summaryLabel}>в роботі</Text>
              </View>
            </View>
          )}

          {/* Delivery list */}
          {deliveries.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={40} color="#3a3935" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyTitle}>Немає доставок</Text>
              <Text style={styles.emptySub}>За цей день доставок не знайдено</Text>
            </View>
          ) : (
            <View style={styles.listCard}>
              {deliveries.map((d, i) => (
                <View key={d.id}>
                  <DeliveryRow delivery={d} onPress={() => handleDeliveryPress(d)} />
                  {i < deliveries.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
    gap: 12,
  },
  backBtn: { padding: 2 },
  headerCenter: { flex: 1 },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    textTransform: 'capitalize',
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#78776e',
    marginTop: 2,
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  content: { padding: 20, gap: 16, flexGrow: 1 },

  summaryCard: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    gap: 4,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: 'rgba(250,249,246,0.06)',
    marginVertical: 12,
  },
  summaryValue: {
    fontSize: 22,
    fontFamily: 'JetBrainsMono_500Medium',
    color: '#faf9f6',
  },
  summaryLabel: {
    fontSize: 11,
    fontFamily: 'Manrope_500Medium',
    color: '#78776e',
    letterSpacing: 0.3,
  },

  listCard: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    overflow: 'hidden',
  },

  deliveryRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  deliveryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOk: { backgroundColor: '#22c55e' },
  dotFail: { backgroundColor: '#ef4444' },
  deliveryId: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#faf9f6',
  },
  chevron: { marginLeft: 4 },
  deliveryAddress: {
    fontSize: 13,
    fontFamily: 'Manrope_400Regular',
    color: '#9c9b96',
    marginBottom: 2,
  },
  deliverySub: {
    fontSize: 11,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#78776e',
  },

  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(250,249,246,0.06)',
    marginHorizontal: 16,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 14,
    fontFamily: 'Manrope_400Regular',
    color: '#78776e',
    textAlign: 'center',
  },
});
