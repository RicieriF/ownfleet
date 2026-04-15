/**
 * Manager Shifts screen.
 * Shows active shifts with courier status + quick actions.
 * WS subscription: shift:started / shift:ended for real-time updates.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiGet, apiPost } from '@/api/client';
import { useManagerSocket } from '@/hooks/use-manager-socket';
import type { ActiveShiftItem, CourierOnlineStatus } from '@/types';

function computeStatus(lastPingAt: string | null, hasDelivery: boolean): CourierOnlineStatus {
  if (!lastPingAt) return 'offline';
  const diffSec = (Date.now() - new Date(lastPingAt).getTime()) / 1000;
  if (diffSec < 30) return 'online';
  if (diffSec < 300) return 'background';
  if (hasDelivery) return 'no_response';
  return 'offline';
}

const STATUS_COLOR: Record<CourierOnlineStatus, string> = {
  online: '#22c55e',
  background: '#f59e0b',
  no_response: '#ef4444',
  offline: '#78776e',
};

const STATUS_LABEL: Record<CourierOnlineStatus, string> = {
  online: 'Онлайн',
  background: 'Фон',
  no_response: 'Не відповідає',
  offline: 'Офлайн',
};

function formatDuration(startedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000);
  if (mins < 60) return `${mins} хв`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}г ${m}хв`;
}

interface ShiftRowProps {
  shift: ActiveShiftItem;
  onRemind: (courierId: string) => void;
  onForceEnd: (shiftId: string, courierName: string) => void;
  reminding: boolean;
  ending: boolean;
}

function ShiftRow({ shift, onRemind, onForceEnd, reminding, ending }: ShiftRowProps) {
  const { courier } = shift;
  const status = computeStatus(
    courier.last_ping?.created_at ?? null,
    !!courier.active_delivery,
  );
  const dotColor = STATUS_COLOR[status];

  return (
    <View style={styles.shiftRow}>
      <View style={styles.shiftHeader}>
        <View style={styles.nameRow}>
          <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
          <Text style={styles.courierName}>{courier.name}</Text>
        </View>
        <Text style={styles.statusLabel}>{STATUS_LABEL[status]}</Text>
      </View>

      <View style={styles.shiftMeta}>
        <Text style={styles.metaText}>
          Зміна: <Text style={styles.metaMono}>{formatDuration(shift.started_at)}</Text>
        </Text>
        {courier.active_delivery ? (
          <Text style={styles.metaDelivery} numberOfLines={1}>
            → {courier.active_delivery.order.address}
          </Text>
        ) : (
          <Text style={styles.metaFree}>Вільний</Text>
        )}
        {courier.last_ping?.battery !== null && courier.last_ping?.battery !== undefined ? (
          <Text style={styles.metaBattery}>🔋 {courier.last_ping.battery}%</Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {(status === 'no_response' || status === 'offline') ? (
          <TouchableOpacity
            style={styles.remindBtn}
            onPress={() => onRemind(courier.id)}
            disabled={reminding}
            activeOpacity={0.7}
          >
            {reminding ? (
              <ActivityIndicator size="small" color="#9c9b96" />
            ) : (
              <Text style={styles.remindText}>Нагадати</Text>
            )}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.endBtn}
          onPress={() => onForceEnd(shift.id, courier.name)}
          disabled={ending}
          activeOpacity={0.7}
        >
          {ending ? (
            <ActivityIndicator size="small" color="#9c9b96" />
          ) : (
            <Text style={styles.endText}>Завершити зміну</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ShiftsScreen() {
  const [shifts, setShifts] = useState<ActiveShiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reminding, setReminding] = useState<Set<string>>(new Set());
  const [ending, setEnding] = useState<Set<string>>(new Set());
  const { socket } = useManagerSocket();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ActiveShiftItem[]>('/api/v1/shifts/active');
      setShifts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // WS: refresh list on shift events
  useEffect(() => {
    if (!socket) return;

    const onShiftStarted = () => void load(true);
    const onShiftEnded = () => void load(true);
    socket.on('shift:started', onShiftStarted);
    socket.on('shift:ended', onShiftEnded);
    return () => {
      socket.off('shift:started', onShiftStarted);
      socket.off('shift:ended', onShiftEnded);
    };
  }, [socket, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  async function handleRemind(courierId: string) {
    setReminding((prev) => new Set(prev).add(courierId));
    try {
      await apiPost(`/api/v1/couriers/${courierId}/remind`);
    } catch {
      // fire-and-forget — reminder failure is non-critical
    } finally {
      setReminding((prev) => {
        const next = new Set(prev);
        next.delete(courierId);
        return next;
      });
    }
  }

  function handleForceEnd(shiftId: string, courierName: string) {
    Alert.alert(
      'Завершити зміну',
      `Завершити зміну курʼєра ${courierName}?`,
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Завершити',
          style: 'destructive',
          onPress: () => void doForceEnd(shiftId),
        },
      ],
    );
  }

  async function doForceEnd(shiftId: string) {
    setEnding((prev) => new Set(prev).add(shiftId));
    try {
      await apiPost(`/api/v1/shifts/${shiftId}/end`);
      // WS shift:ended will trigger reload — but also reload immediately
      void load(true);
    } catch (e) {
      Alert.alert('Помилка', e instanceof Error ? e.message : 'Не вдалося завершити зміну');
    } finally {
      setEnding((prev) => {
        const next = new Set(prev);
        next.delete(shiftId);
        return next;
      });
    }
  }

  if (loading && shifts.length === 0) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Зміни</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color="#78776e" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Зміни</Text>
        <Text style={styles.headerCount}>{shifts.length} активних</Text>
      </View>

      {error ? (
        <View style={styles.centered}>
          <Ionicons name="warning-outline" size={32} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>Повторити</Text>
          </TouchableOpacity>
        </View>
      ) : shifts.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="moon-outline" size={48} color="#78776e" />
          <Text style={styles.emptyTitle}>Немає активних змін</Text>
          <Text style={styles.emptyText}>Курʼєри ще не розпочали зміну</Text>
        </View>
      ) : (
        <FlatList
          data={shifts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#78776e" />
          }
          renderItem={({ item }) => (
            <ShiftRow
              shift={item}
              onRemind={(id) => void handleRemind(id)}
              onForceEnd={handleForceEnd}
              reminding={reminding.has(item.courier.id)}
              ending={ending.has(item.id)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c0b09' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  headerCount: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#78776e',
  },
  list: { paddingVertical: 4 },
  shiftRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  shiftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  courierName: {
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
    color: '#faf9f6',
  },
  statusLabel: {
    fontSize: 12,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  shiftMeta: { gap: 2 },
  metaText: {
    fontSize: 12,
    color: '#9c9b96',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  metaMono: {
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#d5d4ce',
  },
  metaDelivery: {
    fontSize: 12,
    color: '#9c9b96',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  metaFree: {
    fontSize: 12,
    color: '#22c55e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  metaBattery: {
    fontSize: 11,
    color: '#78776e',
    fontFamily: 'JetBrainsMono_400Regular',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  remindBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  remindText: {
    fontSize: 13,
    color: '#9c9b96',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
  endBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  endText: {
    fontSize: 13,
    color: '#ef4444',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(250,249,246,0.06)',
    marginLeft: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    color: '#faf9f6',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 13,
    color: '#78776e',
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
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
});
