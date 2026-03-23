/**
 * Main delivery screen.
 *
 * States:
 *  - No active delivery → "Очікуємо замовлення" idle state
 *  - Delivery assigned  → show address + [Прийняти] button
 *  - Delivery in_progress → show address + [Здати замовлення] button + GPS active
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { apiGet, apiPost, apiPatch } from '@/api/client';
import { ActiveDelivery } from '@/types';
import {
  requestLocationPermissions,
  startBackgroundLocationTask,
  stopBackgroundLocationTask,
  startForegroundPingInterval,
} from '@/services/location';
import {
  showDeliveryNotification,
  dismissDeliveryNotification,
} from '@/services/notifications';
import { requestBatteryOptimizationExemption } from '@/services/battery';

const POLL_INTERVAL_MS = 10_000; // poll for new assignments every 10s

export default function MainScreen() {
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const [delivery, setDelivery] = useState<ActiveDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const pingCleanupRef = useRef<(() => void) | null>(null);
  const notificationIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch active delivery ─────────────────────────────────────────────────
  const fetchDelivery = useCallback(async () => {
    try {
      const data = await apiGet<ActiveDelivery | null>('/api/v1/deliveries/active');
      setDelivery(data);
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        clearAuth();
      }
    } finally {
      setLoading(false);
    }
  }, [clearAuth]);

  // ── Polling when delivery not in_progress ─────────────────────────────────
  const scheduleNextPoll = useCallback(() => {
    pollTimerRef.current = setTimeout(async () => {
      await fetchDelivery();
      scheduleNextPoll();
    }, POLL_INTERVAL_MS);
  }, [fetchDelivery]);

  useEffect(() => {
    fetchDelivery().then(scheduleNextPoll);

    // Request battery optimization exemption for Chinese OEMs (fire-and-forget)
    requestBatteryOptimizationExemption().catch(() => {});

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start GPS when delivery becomes in_progress ───────────────────────────
  useEffect(() => {
    if (delivery?.status === 'in_progress') {
      startGps();
    } else {
      stopGps();
    }
  }, [delivery?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startGps() {
    const granted = await requestLocationPermissions();
    if (!granted) {
      Alert.alert(
        'Доступ до геолокації',
        'Для відстеження доставки потрібен доступ до геолокації. Відкрийте налаштування та надайте дозвіл.',
      );
      return;
    }
    await startBackgroundLocationTask();
    pingCleanupRef.current = startForegroundPingInterval();

    // Show persistent notification (Android)
    if (Platform.OS === 'android' && delivery) {
      const id = await showDeliveryNotification(delivery.order.address);
      notificationIdRef.current = id;
    }
  }

  async function stopGps() {
    pingCleanupRef.current?.();
    pingCleanupRef.current = null;
    await stopBackgroundLocationTask();

    if (notificationIdRef.current) {
      await dismissDeliveryNotification(notificationIdRef.current);
      notificationIdRef.current = null;
    }
  }

  // ── Accept delivery (assigned → in_progress) ─────────────────────────────
  async function handleAccept() {
    if (!delivery) return;
    setActionLoading(true);
    try {
      const updated = await apiPatch<ActiveDelivery>(
        `/api/v1/deliveries/${delivery.id}/start`,
      );
      setDelivery(updated);
    } catch {
      Alert.alert('Помилка', 'Не вдалося прийняти доставку. Спробуйте ще раз.');
    } finally {
      setActionLoading(false);
    }
  }

  // ── Navigate to proof screen ──────────────────────────────────────────────
  function handleCompleteDelivery() {
    if (!delivery) return;
    router.push({ pathname: '/(app)/proof', params: { deliveryId: delivery.id } });
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  async function handleLogout() {
    Alert.alert('Вийти?', 'Ви впевнені, що хочете вийти?', [
      { text: 'Відміна', style: 'cancel' },
      {
        text: 'Вийти',
        style: 'destructive',
        onPress: async () => {
          await stopGps();
          await clearAuth();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color="#6aaa84" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerName}>👋 {user?.name}</Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logoutBtn}>Вийти</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {!delivery && <IdleState />}

        {delivery?.status === 'assigned' && (
          <AssignedState
            delivery={delivery}
            onAccept={handleAccept}
            actionLoading={actionLoading}
          />
        )}

        {delivery?.status === 'in_progress' && (
          <InProgressState
            delivery={delivery}
            onComplete={handleCompleteDelivery}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function IdleState() {
  return (
    <View style={styles.idle}>
      <Text style={styles.idleEmoji}>⏳</Text>
      <Text style={styles.idleTitle}>Очікуємо замовлення</Text>
      <Text style={styles.idleSub}>Коли менеджер призначить доставку — ви побачите її тут</Text>
    </View>
  );
}

function AssignedState({
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
      <View style={styles.statusBadge}>
        <Text style={styles.statusText}>Нова доставка</Text>
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
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Прийняти доставку</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function InProgressState({
  delivery,
  onComplete,
}: {
  delivery: ActiveDelivery;
  onComplete: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={[styles.statusBadge, styles.statusBadgeActive]}>
        <Text style={styles.statusText}>Доставка активна</Text>
      </View>
      <Text style={styles.gpsLabel}>GPS відстеження увімкнено</Text>
      <Text style={styles.address}>{delivery.order.address}</Text>
      {delivery.order.notes ? (
        <Text style={styles.notes}>{delivery.order.notes}</Text>
      ) : null}
      {delivery.order.external_id ? (
        <Text style={styles.externalId}>№ {delivery.order.external_id}</Text>
      ) : null}
      <TouchableOpacity
        style={[styles.btn, styles.btnComplete]}
        onPress={onComplete}
        activeOpacity={0.8}
      >
        <Text style={styles.btnText}>Здати замовлення</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09090b' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  headerName: { fontSize: 16, color: '#fafafa', fontFamily: 'Manrope_500Medium' },
  logoutBtn: { fontSize: 14, color: '#71717a' },
  content: { flex: 1, padding: 20, justifyContent: 'center' },
  idle: { alignItems: 'center', paddingHorizontal: 32 },
  idleEmoji: { fontSize: 56, marginBottom: 16 },
  idleTitle: { fontSize: 22, fontFamily: 'Manrope_700Bold', color: '#fafafa', marginBottom: 8 },
  idleSub: { fontSize: 15, color: '#71717a', textAlign: 'center', lineHeight: 22 },
  card: {
    backgroundColor: '#18181b',
    borderRadius: 8,
    padding: 24,
  },
  statusBadge: {
    backgroundColor: '#6aaa84',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  statusBadgeActive: { backgroundColor: '#5c9973' },
  statusText: { color: '#fff', fontSize: 13, fontFamily: 'Manrope_600SemiBold' },
  gpsLabel: { fontSize: 12, color: '#22c55e', marginBottom: 12 },
  address: { fontSize: 20, fontFamily: 'Manrope_700Bold', color: '#fafafa', lineHeight: 28, marginBottom: 8 },
  notes: { fontSize: 14, color: '#a1a1aa', marginBottom: 6 },
  externalId: { fontSize: 13, color: '#71717a', marginBottom: 20 },
  btn: {
    borderRadius: 6,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  btnAccept: { backgroundColor: '#6aaa84' },
  btnComplete: { backgroundColor: '#6aaa84' },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 17, fontFamily: 'Manrope_700Bold' },
});
