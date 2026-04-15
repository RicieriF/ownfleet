/**
 * Manager Orders screen.
 * Lists pending + active orders. Tap pending → assign courier modal.
 * Tap assigned → reassign modal.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { apiGet, apiPost } from '@/api/client';
import type { ManagerOrder, ManagerCourier, OrderStatus } from '@/types';

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Очікує',
  assigned: 'Призначено',
  in_progress: 'В дорозі',
  completed: 'Виконано',
  cancelled: 'Скасовано',
  failed: 'Провалено',
};

const STATUS_COLOR: Partial<Record<OrderStatus, string>> = {
  pending: '#f59e0b',
  assigned: '#d5d4ce',  // Warm light — distinguishable from disabled gray (#78776e)
  in_progress: '#22c55e',
};

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <View style={[styles.badge, { borderColor: STATUS_COLOR[status] ?? 'rgba(250,249,246,0.14)' }]}>
      <Text style={[styles.badgeText, { color: STATUS_COLOR[status] ?? '#9c9b96' }]}>
        {STATUS_LABEL[status]}
      </Text>
    </View>
  );
}

interface AssignModalProps {
  order: ManagerOrder | null;
  mode: 'assign' | 'reassign';
  onClose: () => void;
  onSuccess: () => void;
}

function AssignModal({ order, mode, onClose, onSuccess }: AssignModalProps) {
  const [couriers, setCouriers] = useState<ManagerCourier[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!order) return;
    setLoading(true);
    setError(null);
    apiGet<ManagerCourier[]>('/api/v1/couriers')
      .then((all) => {
        // Show only couriers on active shift
        const available = all.filter((c) => c.active && c.active_shift);
        setCouriers(available);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Помилка');
      })
      .finally(() => setLoading(false));
  }, [order]);

  async function handleAssign(courierId: string) {
    if (!order) return;
    setSubmitting(courierId);
    setError(null);
    try {
      const endpoint =
        mode === 'assign'
          ? `/api/v1/orders/${order.id}/assign`
          : `/api/v1/orders/${order.id}/reassign`;
      const body =
        mode === 'assign' ? { courier_id: courierId } : { courierId };
      await apiPost(endpoint, body);
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка призначення');
    } finally {
      setSubmitting(null);
    }
  }

  const title = mode === 'assign' ? 'Призначити курʼєра' : 'Перепризначити курʼєра';

  return (
    <Modal visible={!!order} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{title}</Text>
          {order ? (
            <Text style={styles.modalAddress} numberOfLines={2}>
              {order.address}
            </Text>
          ) : null}

          {error ? (
            <TouchableOpacity onPress={() => setError(null)} activeOpacity={0.7}>
              <Text style={styles.modalError}>{error} (торкніться, щоб закрити)</Text>
            </TouchableOpacity>
          ) : null}

          {loading ? (
            <ActivityIndicator color="#78776e" style={{ marginVertical: 24 }} />
          ) : couriers.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={32} color="#78776e" />
              <Text style={styles.emptyText}>Немає доступних курʼєрів на зміні</Text>
            </View>
          ) : (
            couriers.map((courier) => {
              const isSubmitting = submitting === courier.id;
              const hasDelivery = !!courier.active_delivery;
              return (
                <TouchableOpacity
                  key={courier.id}
                  style={[styles.courierRow, hasDelivery && styles.courierRowBusy]}
                  onPress={() => void handleAssign(courier.id)}
                  disabled={!!submitting}
                  activeOpacity={0.7}
                >
                  <View style={styles.courierInfo}>
                    <Text style={styles.courierName}>{courier.name}</Text>
                    {hasDelivery ? (
                      <Text style={styles.courierBusyLabel}>вже в дорозі</Text>
                    ) : (
                      <Text style={styles.courierFreeLabel}>вільний</Text>
                    )}
                  </View>
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#78776e" />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color="#78776e" />
                  )}
                </TouchableOpacity>
              );
            })
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Скасувати</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function OrdersScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<ManagerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ManagerOrder | null>(null);
  const [modalMode, setModalMode] = useState<'assign' | 'reassign'>('assign');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ManagerOrder[]>(
        '/api/v1/orders?status=pending,assigned,in_progress',
      );
      // Sort: pending first (most urgent), then by created_at desc
      data.sort((a, b) => {
        const statusPriority: Partial<Record<OrderStatus, number>> = {
          pending: 0,
          assigned: 1,
          in_progress: 2,
        };
        const pa = statusPriority[a.status] ?? 99;
        const pb = statusPriority[b.status] ?? 99;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setOrders(data);
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  function openModal(order: ManagerOrder) {
    const mode =
      order.status === 'pending' ? 'assign' : 'reassign';
    setModalMode(mode);
    setSelectedOrder(order);
  }

  function handleModalSuccess() {
    setSelectedOrder(null);
    void load(true);
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  if (loading && orders.length === 0) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Замовлення</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => router.navigate('/(manager)/history' as Parameters<typeof router.navigate>[0])}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.historyBtn}
            >
              <Ionicons name="time-outline" size={20} color="#78776e" />
            </TouchableOpacity>
          </View>
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
        <Text style={styles.headerTitle}>Замовлення</Text>
        <View style={styles.headerRight}>
          <Text style={styles.headerCount}>{orders.length}</Text>
          <TouchableOpacity
            onPress={() => router.navigate('/(manager)/history' as Parameters<typeof router.navigate>[0])}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.historyBtn}
          >
            <Ionicons name="time-outline" size={20} color="#78776e" />
          </TouchableOpacity>
        </View>
      </View>

      {error ? (
        <View style={styles.centered}>
          <Ionicons name="warning-outline" size={32} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>Повторити</Text>
          </TouchableOpacity>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="checkmark-circle-outline" size={48} color="#78776e" />
          <Text style={styles.emptyText}>Немає активних замовлень</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#78776e" />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.orderRow}
              onPress={() => openModal(item)}
              activeOpacity={0.7}
            >
              <View style={styles.orderLeft}>
                <Text style={styles.orderAddress} numberOfLines={1}>
                  {item.address}
                </Text>
                {item.delivery?.courier ? (
                  <Text style={styles.orderCourier}>
                    {item.delivery.courier.name}
                  </Text>
                ) : null}
                <Text style={styles.orderTime}>{formatTime(item.created_at)}</Text>
              </View>
              <View style={styles.orderRight}>
                <StatusBadge status={item.status} />
                {(item.status === 'pending' || item.status === 'assigned') ? (
                  <Ionicons name="chevron-forward" size={16} color="#78776e" style={{ marginTop: 6 }} />
                ) : null}
              </View>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      <AssignModal
        order={selectedOrder}
        mode={modalMode}
        onClose={() => setSelectedOrder(null)}
        onSuccess={handleModalSuccess}
      />
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyBtn: {
    padding: 2,
  },
  headerCount: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#78776e',
  },
  list: { paddingVertical: 4 },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  orderLeft: { flex: 1, gap: 2, marginRight: 12 },
  orderAddress: {
    fontSize: 14,
    color: '#faf9f6',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
  orderCourier: {
    fontSize: 12,
    color: '#9c9b96',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  orderTime: {
    fontSize: 11,
    color: '#78776e',
    fontFamily: 'JetBrainsMono_400Regular',
    marginTop: 2,
  },
  orderRight: { alignItems: 'flex-end' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
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
  emptyText: {
    color: '#9c9b96',
    fontSize: 14,
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
  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: '#1a1917',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
    gap: 4,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(250,249,246,0.14)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_700Bold' : undefined,
    fontWeight: '700',
    color: '#faf9f6',
    marginBottom: 2,
  },
  modalAddress: {
    fontSize: 13,
    color: '#9c9b96',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    marginBottom: 12,
  },
  modalError: {
    fontSize: 13,
    color: '#ef4444',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    marginBottom: 8,
  },
  courierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.06)',
  },
  courierRowBusy: { opacity: 0.6 },
  courierInfo: { gap: 2 },
  courierName: {
    fontSize: 15,
    color: '#faf9f6',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
  courierFreeLabel: {
    fontSize: 12,
    color: '#22c55e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  courierBusyLabel: {
    fontSize: 12,
    color: '#f59e0b',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  cancelBtn: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#252420',
  },
  cancelText: {
    color: '#9c9b96',
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
});
