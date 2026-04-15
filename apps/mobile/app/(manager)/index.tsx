/**
 * Manager KPI Dashboard.
 * Polls couriers + orders every 15s. Shows:
 *  - On-shift count with breakdown (in-ride / free / not started)
 *  - Pending unassigned orders (most urgent)
 *  - Active deliveries in progress
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '@/api/client';
import { useAuthStore } from '@/store/auth';
import type { ManagerCourier, ManagerOrder, ManagerKpi } from '@/types';

const POLL_INTERVAL = 15_000;

function computeKpi(couriers: ManagerCourier[], orders: ManagerOrder[]): ManagerKpi {
  const onShift = couriers.filter((c) => c.active && c.active_shift);
  const inRide = onShift.filter((c) => c.active_delivery);
  const free = onShift.filter((c) => !c.active_delivery);
  const notStarted = couriers.filter((c) => c.active && !c.active_shift);
  const pending = orders.filter((o) => o.status === 'pending');
  const active = orders.filter((o) => o.status === 'assigned' || o.status === 'in_progress');

  return {
    onShiftCount: onShift.length,
    pendingOrdersCount: pending.length,
    activeDeliveriesCount: active.length,
    notStartedCount: notStarted.length,
    inRideCount: inRide.length,
    freeCount: free.length,
  };
}

interface KpiCardProps {
  label: string;
  value: number;
  sub?: string;
  urgent?: boolean;
}

function KpiCard({ label, value, sub, urgent }: KpiCardProps) {
  return (
    <View style={[styles.card, urgent && value > 0 && styles.cardUrgent]}>
      {urgent && value > 0 && <View style={styles.urgentBar} />}
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
      {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
    </View>
  );
}

export default function ManagerDashboard() {
  const { user } = useAuthStore();
  const [kpi, setKpi] = useState<ManagerKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [couriers, orders] = await Promise.all([
        apiGet<ManagerCourier[]>('/api/v1/couriers'),
        apiGet<ManagerOrder[]>('/api/v1/orders?status=pending,assigned,in_progress'),
      ]);
      setKpi(computeKpi(couriers, orders));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Дашборд</Text>
        {user?.name ? <Text style={styles.headerSub}>{user.name}</Text> : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#78776e"
          />
        }
      >
        {loading && !kpi ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#78776e" />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Ionicons name="warning-outline" size={32} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
              <Text style={styles.retryText}>Повторити</Text>
            </TouchableOpacity>
          </View>
        ) : kpi ? (
          <>
            <Text style={styles.sectionLabel}>ЗАМОВЛЕННЯ</Text>
            <View style={styles.row}>
              <KpiCard
                label="Очікують призначення"
                value={kpi.pendingOrdersCount}
                urgent
              />
              <KpiCard
                label="В дорозі"
                value={kpi.activeDeliveriesCount}
              />
            </View>

            <Text style={styles.sectionLabel}>КУРЄРИ</Text>
            <View style={styles.row}>
              <KpiCard
                label="На зміні"
                value={kpi.onShiftCount}
                sub={`${kpi.inRideCount} їдуть · ${kpi.freeCount} вільні`}
              />
              <KpiCard
                label="Не вийшли"
                value={kpi.notStartedCount}
                urgent
              />
            </View>

            <Text style={styles.hint}>
              Оновлюється кожні 15 сек · потягніть для ручного оновлення
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0c0b09',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_700Bold' : undefined,
    fontWeight: '700',
    color: '#faf9f6',
  },
  headerSub: {
    fontSize: 13,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    marginTop: 2,
  },
  scroll: {
    padding: 16,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.05,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    marginTop: 8,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  card: {
    flex: 1,
    backgroundColor: '#1a1917',
    borderRadius: 8,
    padding: 14,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    overflow: 'hidden',
  },
  cardUrgent: {
    // Subtle left border for urgent items — added via urgentBar overlay
  },
  urgentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#ef4444',
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  cardValue: {
    fontSize: 32,
    fontFamily: 'JetBrainsMono_500Medium',
    color: '#faf9f6',
    lineHeight: 36,
  },
  cardLabel: {
    fontSize: 12,
    color: '#9c9b96',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  cardSub: {
    fontSize: 11,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  errorText: {
    color: '#9c9b96',
    fontSize: 14,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1917',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  retryText: {
    color: '#faf9f6',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
  hint: {
    fontSize: 11,
    color: '#78776e',
    textAlign: 'center',
    marginTop: 16,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
});
