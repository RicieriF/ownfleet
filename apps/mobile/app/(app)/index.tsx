/**
 * Main delivery screen.
 *
 * States:
 *  - No active shift   → "Вийти на зміну" CTA (NoShiftState)
 *  - On shift, idle    → "Очікуємо замовлення" + shift timer in header
 *  - Delivery assigned → address + [Прийняти] + shift timer
 *  - Delivery in_progress → address + [Здати замовлення] + GPS active + shift timer
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
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth';
import { useShiftStore } from '@/store/shift';
import { apiGet, apiPost, apiPatch } from '@/api/client';
import { ActiveDelivery, Shift } from '@/types';
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

const POLL_INTERVAL_MS = 10_000;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function useShiftTimer(shift: Shift | null): string {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!shift) { setLabel(''); return; }

    function tick() {
      const now = Date.now();
      if (shift!.planned_end_at) {
        const remaining = new Date(shift!.planned_end_at).getTime() - now;
        if (remaining <= 0) {
          setLabel('Зміна завершується');
        } else {
          setLabel(`Залишилось ${formatDuration(remaining)}`);
        }
      } else {
        const elapsed = now - new Date(shift!.started_at).getTime();
        setLabel(`Зміна ${formatDuration(elapsed)}`);
      }
    }

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [shift]);

  return label;
}

// ── Preset durations for planned_end_at ────────────────────────────────────

const DURATION_PRESETS = [
  { label: '4 год', hours: 4 },
  { label: '8 год', hours: 8 },
  { label: '10 год', hours: 10 },
  { label: '12 год', hours: 12 },
];

// ── Main Screen ────────────────────────────────────────────────────────────

export default function MainScreen() {
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { shift, setShift, clearShift, hydrateFromStorage } = useShiftStore();
  const [delivery, setDelivery] = useState<ActiveDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const pingCleanupRef = useRef<(() => void) | null>(null);
  const notificationIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shiftTimer = useShiftTimer(shift);

  // ── Fetch shift + delivery ──────────────────────────────────────────────

  const fetchState = useCallback(async () => {
    try {
      const [shiftData, deliveryData] = await Promise.all([
        apiGet<Shift | null>('/api/v1/shifts/my'),
        apiGet<ActiveDelivery | null>('/api/v1/deliveries/active'),
      ]);
      await setShift(shiftData);
      setDelivery(deliveryData);
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_EXPIRED') {
        clearAuth();
      }
    } finally {
      setLoading(false);
    }
  }, [clearAuth, setShift]);

  const scheduleNextPoll = useCallback(() => {
    pollTimerRef.current = setTimeout(async () => {
      await fetchState();
      scheduleNextPoll();
    }, POLL_INTERVAL_MS);
  }, [fetchState]);

  useEffect(() => {
    // Hydrate cached shift first so UI shows correct state immediately,
    // then fetch fresh data from API.
    hydrateFromStorage().then(() => fetchState()).then(scheduleNextPoll);
    requestBatteryOptimizationExemption().catch(() => {});
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GPS lifecycle ──────────────────────────────────────────────────────

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

  // ── Shift actions ──────────────────────────────────────────────────────

  async function handleStartShift(plannedEndAt?: string) {
    setActionLoading(true);
    try {
      const newShift = await apiPost<Shift>('/api/v1/shifts/start', {
        planned_end_at: plannedEndAt ?? null,
      });
      await setShift(newShift);
    } catch {
      Alert.alert('Помилка', 'Не вдалося вийти на зміну. Спробуйте ще раз.');
    } finally {
      setActionLoading(false);
    }
  }

  function handleEndShiftPrompt() {
    Alert.alert(
      'Завершити зміну?',
      'Переконайтесь, що всі доставки виконані.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Завершити',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiPost('/api/v1/shifts/end', {});
              await clearShift();
              setDelivery(null);
            } catch {
              Alert.alert('Помилка', 'Не вдалося завершити зміну.');
            }
          },
        },
      ],
    );
  }

  // ── Delivery actions ───────────────────────────────────────────────────

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

  function handleCompleteDelivery() {
    if (!delivery) return;
    router.push({ pathname: '/(app)/proof', params: { deliveryId: delivery.id } });
  }

  // ── Logout ─────────────────────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────────────

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
        <View>
          <Text style={styles.headerName}>👋 {user?.name}</Text>
          {shift && (
            <Text style={styles.shiftTimer}>{shiftTimer}</Text>
          )}
        </View>
        <View style={styles.headerActions}>
          {shift && (
            <TouchableOpacity onPress={handleEndShiftPrompt} style={styles.endShiftBtn}>
              <Text style={styles.endShiftText}>Завершити зміну</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleLogout}>
            <Text style={styles.logoutBtn}>Вийти</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {!shift && (
          <NoShiftState onStart={handleStartShift} loading={actionLoading} />
        )}

        {shift && !delivery && <IdleState />}

        {shift && delivery?.status === 'assigned' && (
          <AssignedState
            delivery={delivery}
            onAccept={handleAccept}
            actionLoading={actionLoading}
          />
        )}

        {shift && delivery?.status === 'in_progress' && (
          <InProgressState delivery={delivery} onComplete={handleCompleteDelivery} />
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function NoShiftState({
  onStart,
  loading,
}: {
  onStart: (plannedEndAt?: string) => void;
  loading: boolean;
}) {
  const [selectedHours, setSelectedHours] = useState<number | null>(null);

  function handleStart() {
    if (selectedHours !== null) {
      const plannedEnd = new Date(Date.now() + selectedHours * 60 * 60 * 1000).toISOString();
      onStart(plannedEnd);
    } else {
      onStart();
    }
  }

  return (
    <View style={styles.noShift}>
      <Ionicons name="time-outline" size={52} color="#3f3f46" style={{ marginBottom: 20 }} />
      <Text style={styles.noShiftTitle}>Ви не на зміні</Text>
      <Text style={styles.noShiftSub}>Вкажіть тривалість зміни або пропустіть</Text>

      {/* Duration presets */}
      <View style={styles.presets}>
        {DURATION_PRESETS.map((p) => (
          <TouchableOpacity
            key={p.hours}
            style={[styles.preset, selectedHours === p.hours && styles.presetSelected]}
            onPress={() => setSelectedHours(selectedHours === p.hours ? null : p.hours)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.presetText, selectedHours === p.hours && styles.presetTextSelected]}
            >
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {selectedHours !== null && (
        <Text style={styles.plannedNote}>
          Зміна до {new Date(Date.now() + selectedHours * 60 * 60 * 1000).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}

      <TouchableOpacity
        style={[styles.startBtn, loading && styles.btnDisabled]}
        onPress={handleStart}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.startBtnText}>Вийти на зміну</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

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

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09090b' },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  headerName: { fontSize: 16, color: '#fafafa', fontFamily: 'Manrope_500Medium' },
  shiftTimer: {
    fontSize: 12,
    color: '#6aaa84',
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 2,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  endShiftBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  endShiftText: { fontSize: 12, color: '#a1a1aa', fontFamily: 'Manrope_500Medium' },
  logoutBtn: { fontSize: 14, color: '#71717a' },

  // Content
  content: { flex: 1, padding: 20, justifyContent: 'center' },

  // NoShiftState
  noShift: { alignItems: 'center', paddingHorizontal: 24 },
  noShiftTitle: {
    fontSize: 24,
    fontFamily: 'Manrope_700Bold',
    color: '#fafafa',
    marginBottom: 8,
  },
  noShiftSub: {
    fontSize: 15,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 16,
  },
  preset: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#18181b',
  },
  presetSelected: {
    borderColor: '#6aaa84',
    backgroundColor: 'rgba(106,170,132,0.1)',
  },
  presetText: { fontSize: 14, color: '#a1a1aa', fontFamily: 'Manrope_500Medium' },
  presetTextSelected: { color: '#6aaa84' },
  plannedNote: {
    fontSize: 13,
    color: '#6aaa84',
    marginBottom: 24,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  startBtn: {
    backgroundColor: '#6aaa84',
    borderRadius: 6,
    paddingVertical: 18,
    paddingHorizontal: 48,
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
  },
  startBtnText: { color: '#09090b', fontSize: 17, fontFamily: 'Manrope_700Bold' },

  // IdleState
  idle: { alignItems: 'center', paddingHorizontal: 32 },
  idleEmoji: { fontSize: 56, marginBottom: 16 },
  idleTitle: { fontSize: 22, fontFamily: 'Manrope_700Bold', color: '#fafafa', marginBottom: 8 },
  idleSub: { fontSize: 15, color: '#71717a', textAlign: 'center', lineHeight: 22 },

  // Card (assigned / in_progress)
  card: { backgroundColor: '#18181b', borderRadius: 8, padding: 24 },
  statusBadge: {
    backgroundColor: '#6aaa84',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  statusBadgeActive: { backgroundColor: '#5c9973' },
  statusText: { color: '#09090b', fontSize: 13, fontFamily: 'Manrope_600SemiBold' },
  gpsLabel: { fontSize: 12, color: '#22c55e', marginBottom: 12 },
  address: {
    fontSize: 20,
    fontFamily: 'Manrope_700Bold',
    color: '#fafafa',
    lineHeight: 28,
    marginBottom: 8,
  },
  notes: { fontSize: 14, color: '#a1a1aa', marginBottom: 6 },
  externalId: {
    fontSize: 13,
    color: '#71717a',
    marginBottom: 20,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  btn: { borderRadius: 6, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
  btnAccept: { backgroundColor: '#6aaa84' },
  btnComplete: { backgroundColor: '#6aaa84' },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#09090b', fontSize: 17, fontFamily: 'Manrope_700Bold' },
});
