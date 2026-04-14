/**
 * Route tab — shows current active delivery info.
 *
 * States:
 *  - No active shift / no delivery → empty state (idle)
 *  - Delivery assigned             → order details + [Прийняти]
 *  - Delivery in_progress          → order details + [Навігація] + [Завершити]
 *
 * Note: full map view (Leaflet) is a planned enhancement.
 * For now the tab shows delivery card with navigation launcher.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiGet, apiPatch } from '@/api/client';
import { useShiftStore } from '@/store/shift';
import { ActiveDelivery } from '@/types';
import { TabBar } from '@/components/tab-bar';

export default function RouteScreen() {
  const router = useRouter();
  const { shift } = useShiftStore();
  const [delivery, setDelivery] = useState<ActiveDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDelivery = useCallback(async () => {
    try {
      const d = await apiGet<ActiveDelivery | null>('/api/v1/deliveries/active');
      setDelivery(d);
    } catch {
      // Non-critical: tab shows stale/empty state
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh when tab comes into focus
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchDelivery();
    }, [fetchDelivery]),
  );

  async function handleAccept() {
    if (!delivery) return;
    setActionLoading(true);
    try {
      const updated = await apiPatch<ActiveDelivery>(`/api/v1/deliveries/${delivery.id}/start`);
      setDelivery(updated);
    } catch {
      Alert.alert('Помилка', 'Не вдалося прийняти доставку. Спробуйте ще раз.');
    } finally {
      setActionLoading(false);
    }
  }

  function handleNavigate() {
    if (!delivery) return;
    router.push({
      pathname: '/(app)/navigate',
      params: {
        deliveryId: delivery.id,
        address: delivery.order.address,
        lat: delivery.order.lat ?? '',
        lng: delivery.order.lng ?? '',
        notes: delivery.order.notes ?? '',
        externalId: delivery.order.external_id ?? '',
        startedAt: delivery.started_at ?? '',
      },
    });
  }

  function handleComplete() {
    if (!delivery) return;
    router.push({ pathname: '/(app)/proof', params: { deliveryId: delivery.id } });
  }

  function handleFail() {
    if (!delivery) return;
    router.push({
      pathname: '/(app)/fail',
      params: {
        deliveryId: delivery.id,
        address: delivery.order.address,
        externalId: delivery.order.external_id ?? '',
      },
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Маршрут</Text>
        {delivery?.status === 'in_progress' && (
          <View style={styles.gpsRow}>
            <View style={styles.gpsDot} />
            <Text style={styles.gpsText}>GPS активний</Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color="#9c9b96" />
        ) : !shift ? (
          <EmptyState
            icon="time-outline"
            title="Ви не на зміні"
            subtitle="Почніть зміну на екрані «Доставки», щоб бачити маршрут"
          />
        ) : !delivery ? (
          <EmptyState
            icon="hourglass-outline"
            title="Немає активної доставки"
            subtitle="Коли менеджер призначить замовлення, маршрут зʼявиться тут"
          />
        ) : delivery.status === 'assigned' ? (
          <AssignedCard
            delivery={delivery}
            onAccept={handleAccept}
            actionLoading={actionLoading}
          />
        ) : (
          <InProgressCard
            delivery={delivery}
            onNavigate={handleNavigate}
            onComplete={handleComplete}
            onFail={handleFail}
          />
        )}
      </View>

      <TabBar />
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon} size={48} color="#3a3935" style={{ marginBottom: 16 }} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

function AssignedCard({
  delivery,
  onAccept,
  actionLoading,
}: {
  delivery: ActiveDelivery;
  onAccept: () => void;
  actionLoading: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>Нове замовлення</Text>
      </View>
      <Text style={styles.address}>{delivery.order.address}</Text>
      {delivery.order.notes ? (
        <Text style={styles.notes}>{delivery.order.notes}</Text>
      ) : null}
      {delivery.order.external_id ? (
        <Text style={styles.externalId}>№ {delivery.order.external_id}</Text>
      ) : null}
      <TouchableOpacity
        style={[styles.btn, styles.btnAccept, actionLoading && styles.btnDisabled]}
        onPress={onAccept}
        disabled={actionLoading}
        activeOpacity={0.8}
      >
        {actionLoading ? (
          <ActivityIndicator color="#faf9f6" />
        ) : (
          <Text style={styles.btnText}>Прийняти доставку</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function InProgressCard({
  delivery,
  onNavigate,
  onComplete,
  onFail,
}: {
  delivery: ActiveDelivery;
  onNavigate: () => void;
  onComplete: () => void;
  onFail: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <View style={styles.statusDotActive} />
        <Text style={styles.statusText}>Доставка активна</Text>
      </View>
      <Text style={styles.address}>{delivery.order.address}</Text>
      {delivery.order.notes ? (
        <Text style={styles.notes}>{delivery.order.notes}</Text>
      ) : null}
      {delivery.order.external_id ? (
        <Text style={styles.externalId}>№ {delivery.order.external_id}</Text>
      ) : null}
      <TouchableOpacity
        style={[styles.btn, styles.btnNavigate]}
        onPress={onNavigate}
        activeOpacity={0.8}
      >
        <Ionicons name="navigate-outline" size={18} color="#faf9f6" style={{ marginRight: 6 }} />
        <Text style={styles.btnText}>Відкрити навігацію</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, styles.btnComplete]}
        onPress={onComplete}
        activeOpacity={0.8}
      >
        <Text style={styles.btnText}>Підтвердити доставку</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.failLink} onPress={onFail} activeOpacity={0.7}>
        <Text style={styles.failLinkText}>Не вдалося доставити</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
  },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gpsDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  gpsText: { fontSize: 12, color: '#9c9b96', fontFamily: 'Manrope_400Regular' },

  content: { flex: 1, padding: 20, justifyContent: 'center' },

  // Empty states
  emptyState: { alignItems: 'center', paddingHorizontal: 32 },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    fontFamily: 'Manrope_400Regular',
    color: '#78776e',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Delivery card
  card: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9c9b96' },
  statusDotActive: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  statusText: { color: '#9c9b96', fontSize: 13, fontFamily: 'Manrope_500Medium' },
  address: {
    fontSize: 20,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    lineHeight: 28,
    marginBottom: 6,
  },
  notes: { fontSize: 14, color: '#9c9b96', marginBottom: 6 },
  externalId: {
    fontSize: 13,
    color: '#78776e',
    marginBottom: 20,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  btn: {
    borderRadius: 6,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btnAccept: {
    backgroundColor: '#3a3935',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
  },
  btnNavigate: {
    backgroundColor: '#252420',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.10)',
  },
  btnComplete: {
    backgroundColor: '#3a3935',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#faf9f6', fontSize: 17, fontFamily: 'Manrope_600SemiBold' },
  failLink: { alignItems: 'center', paddingTop: 14, marginTop: 4 },
  failLinkText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: '#78776e',
    textDecorationLine: 'underline',
    textDecorationColor: 'rgba(120,119,110,0.5)',
  },
});
