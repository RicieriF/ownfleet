/**
 * Main delivery screen.
 *
 * States:
 *  - No active shift      → "Вийти на зміну" CTA (NoShiftState)
 *  - On shift, idle       → "Очікуємо замовлення" + shift timer in header + workload block
 *  - Delivery assigned    → address + [Прийняти] + shift timer
 *  - Delivery in_progress → address + [Здати замовлення] + GPS active + shift timer
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { TabBar } from '@/components/tab-bar';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth';
import { useShiftStore } from '@/store/shift';
import { apiGet, apiPost, apiPatch } from '@/api/client';
import { ActiveDelivery, Shift, WorkloadToday } from '@/types';
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
const WORKLOAD_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
  const [workload, setWorkload] = useState<WorkloadToday | null>(null);

  const pingCleanupRef = useRef<(() => void) | null>(null);
  const notificationIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shiftTimer = useShiftTimer(shift);

  // ── Fetch workload ──────────────────────────────────────────────────────

  const fetchWorkload = useCallback(async () => {
    try {
      const data = await apiGet<WorkloadToday>('/api/v1/couriers/workload-today');
      setWorkload(data);
    } catch {
      // Non-critical: silently ignore workload fetch errors
    }
  }, []);

  const scheduleWorkloadRefresh = useCallback(() => {
    workloadTimerRef.current = setTimeout(async () => {
      await fetchWorkload();
      scheduleWorkloadRefresh();
    }, WORKLOAD_REFRESH_INTERVAL_MS);
  }, [fetchWorkload]);

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
      if (workloadTimerRef.current) clearTimeout(workloadTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Workload: fetch when shift becomes active, refresh every 5 min ──────

  useEffect(() => {
    if (workloadTimerRef.current) {
      clearTimeout(workloadTimerRef.current);
      workloadTimerRef.current = null;
    }
    if (shift) {
      fetchWorkload();
      scheduleWorkloadRefresh();
    } else {
      setWorkload(null);
    }
  }, [shift?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleFailDelivery() {
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
        <ActivityIndicator color="#9c9b96" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerName}>{user?.name}</Text>
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
          <TouchableOpacity
            onPress={() => router.push('/(app)/profile')}
            hitSlop={8}
            style={{ marginRight: 4 }}
          >
            <Ionicons name="person-circle-outline" size={26} color="#78776e" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout}>
            <Text style={styles.logoutBtn}>Вийти</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          (!shift || delivery) && styles.contentCentered,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!shift && (
          <NoShiftState onStart={handleStartShift} loading={actionLoading} />
        )}

        {shift && !delivery && (
          <>
            <IdleState />
            <WorkloadBlock workload={workload} />
          </>
        )}

        {shift && delivery?.status === 'assigned' && (
          <AssignedState
            delivery={delivery}
            onAccept={handleAccept}
            actionLoading={actionLoading}
          />
        )}

        {shift && delivery?.status === 'in_progress' && (
          <InProgressState
            delivery={delivery}
            onComplete={handleCompleteDelivery}
            onNavigate={handleNavigate}
            onFail={handleFailDelivery}
          />
        )}
      </ScrollView>
      <TabBar />
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
      <Ionicons name="time-outline" size={52} color="#3a3935" style={{ marginBottom: 20 }} />
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
          <ActivityIndicator color="#faf9f6" />
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
      <Ionicons name="hourglass-outline" size={52} color="#3a3935" style={{ marginBottom: 16 }} />
      <Text style={styles.idleTitle}>Очікуємо замовлення</Text>
      <Text style={styles.idleSub}>Коли менеджер призначить доставку — ви побачите її тут</Text>
    </View>
  );
}

function WorkloadBlock({ workload }: { workload: WorkloadToday | null }) {
  const router = useRouter();
  if (!workload) return null;

  const { myStats, teamAvg } = workload;
  const avgDeliveries = teamAvg.deliveriesCount % 1 === 0
    ? String(teamAvg.deliveriesCount)
    : teamAvg.deliveriesCount.toFixed(1);
  const avgMinutes = teamAvg.activeMinutes % 1 === 0
    ? String(teamAvg.activeMinutes)
    : teamAvg.activeMinutes.toFixed(0);

  return (
    <TouchableOpacity
      style={styles.workloadBlock}
      onPress={() => router.push('/(app)/history')}
      activeOpacity={0.75}
    >
      <View style={styles.workloadHeader}>
        <Text style={styles.workloadTitle}>Моя статистика сьогодні</Text>
        <Ionicons name="chevron-forward" size={14} color="#3a3935" />
      </View>
      <Text style={styles.workloadMain}>
        <Text style={styles.workloadNumber}>{myStats.deliveriesCount}</Text>
        <Text style={styles.workloadLabel}> доставок · </Text>
        <Text style={styles.workloadNumber}>{myStats.activeMinutes}</Text>
        <Text style={styles.workloadLabel}> хв у роботі</Text>
      </Text>
      <Text style={styles.workloadAvg}>
        Середня по команді: {avgDeliveries} · {avgMinutes} хв
      </Text>
    </TouchableOpacity>
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
      <View style={styles.statusRow}>
        <View style={styles.statusDot} />
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
          <ActivityIndicator color="#faf9f6" />
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
  onNavigate,
  onFail,
}: {
  delivery: ActiveDelivery;
  onComplete: () => void;
  onNavigate: () => void;
  onFail: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <View style={styles.statusDotActive} />
        <Text style={styles.statusText}>Доставка активна</Text>
      </View>
      <View style={styles.gpsRow}>
        <View style={styles.gpsDot} />
        <Text style={styles.gpsText}>GPS відстеження увімкнено</Text>
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
        <Text style={styles.btnText}>Навігація</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, styles.btnComplete]}
        onPress={onComplete}
        activeOpacity={0.8}
      >
        <Text style={styles.btnText}>Здати замовлення</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.failLink}
        onPress={onFail}
        activeOpacity={0.7}
      >
        <Text style={styles.failLinkText}>Не вдалося доставити</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  headerName: { fontSize: 16, color: '#faf9f6', fontFamily: 'Manrope_500Medium' },
  shiftTimer: {
    fontSize: 12,
    color: '#78776e',
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 2,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  endShiftBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.10)',
  },
  endShiftText: { fontSize: 12, color: '#9c9b96', fontFamily: 'Manrope_500Medium' },
  logoutBtn: { fontSize: 14, color: '#78776e', fontFamily: 'Manrope_400Regular' },

  // Content
  scrollView: { flex: 1 },
  content: { flexGrow: 1, padding: 20, justifyContent: 'flex-start' },
  contentCentered: { justifyContent: 'center' },

  // NoShiftState
  noShift: { alignItems: 'center', paddingHorizontal: 24 },
  noShiftTitle: {
    fontSize: 24,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    marginBottom: 8,
  },
  noShiftSub: {
    fontSize: 15,
    color: '#78776e',
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
    borderColor: 'rgba(250,249,246,0.08)',
    backgroundColor: '#1a1917',
  },
  presetSelected: {
    borderColor: 'rgba(250,249,246,0.22)',
    backgroundColor: '#252420',
  },
  presetText: { fontSize: 14, color: '#9c9b96', fontFamily: 'Manrope_500Medium' },
  presetTextSelected: { color: '#faf9f6' },
  plannedNote: {
    fontSize: 13,
    color: '#78776e',
    marginBottom: 24,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  startBtn: {
    backgroundColor: '#3a3935',
    borderRadius: 6,
    paddingVertical: 18,
    paddingHorizontal: 48,
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
  },
  startBtnText: { color: '#faf9f6', fontSize: 17, fontFamily: 'Manrope_600SemiBold' },

  // IdleState
  idle: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 40, paddingBottom: 32 },
  idleTitle: { fontSize: 22, fontFamily: 'Manrope_600SemiBold', color: '#faf9f6', marginBottom: 8 },
  idleSub: { fontSize: 15, color: '#78776e', textAlign: 'center', lineHeight: 22 },

  // WorkloadBlock
  workloadBlock: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    marginTop: 4,
  },
  workloadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  workloadTitle: {
    fontSize: 11,
    fontFamily: 'Manrope_600SemiBold',
    color: '#78776e',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  workloadMain: {
    marginBottom: 6,
  },
  workloadNumber: {
    fontSize: 16,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#faf9f6',
  },
  workloadLabel: {
    fontSize: 15,
    fontFamily: 'Manrope_500Medium',
    color: '#9c9b96',
  },
  workloadAvg: {
    fontSize: 13,
    fontFamily: 'Manrope_400Regular',
    color: '#78776e',
  },

  // Card (assigned / in_progress)
  card: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9c9b96' },
  statusDotActive: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  statusText: { color: '#9c9b96', fontSize: 13, fontFamily: 'Manrope_500Medium' },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  gpsDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#22c55e' },
  gpsText: { fontSize: 12, color: '#9c9b96' },
  address: {
    fontSize: 20,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    lineHeight: 28,
    marginBottom: 8,
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

  // Fail delivery link
  failLink: {
    alignItems: 'center',
    paddingTop: 14,
    marginTop: 4,
  },
  failLinkText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: '#78776e',
    textDecorationLine: 'underline' as const,
    textDecorationColor: 'rgba(120,119,110,0.5)',
  },
});
