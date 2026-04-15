/**
 * Manager History screen.
 * Shows completed, failed, and cancelled orders.
 * Tap completed order → delivery proof bottom sheet.
 * Navigate here via Orders screen header button.
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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '@/api/client';
import type { HistoryOrder, DeliveryProof, GeoFlags } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  completed: 'Виконано',
  failed: 'Провалено',
  cancelled: 'Скасовано',
};

const STATUS_COLOR: Record<string, string> = {
  completed: '#22c55e',
  failed: '#ef4444',
  cancelled: '#78776e',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Сьогодні';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчора';
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

function getDateRangeCutoff(range: DateRange): Date | null {
  const now = new Date();
  if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === '7d') {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    return start;
  }
  if (range === '30d') {
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    return start;
  }
  return null;
}

// ── Types ──────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'completed' | 'failed' | 'cancelled';
type DateRange = 'today' | '7d' | '30d';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Всі' },
  { value: 'completed', label: 'Виконані' },
  { value: 'failed', label: 'Провалені' },
  { value: 'cancelled', label: 'Скасовані' },
];

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'today', label: 'Сьогодні' },
  { value: '7d', label: '7 днів' },
  { value: '30d', label: '30 днів' },
];

// ── Proof Modal ────────────────────────────────────────────────────────────

function GeoMatchRow({ match, flags }: { match: boolean; flags: GeoFlags }) {
  if (flags.force_closed) {
    return (
      <View style={proofStyles.geoRow}>
        <Ionicons name="warning-outline" size={18} color="#f59e0b" />
        <Text style={[proofStyles.geoText, { color: '#f59e0b' }]}>
          Закрито менеджером (без гео-підтвердження)
        </Text>
      </View>
    );
  }
  if (flags.no_destination_coords) {
    return (
      <View style={proofStyles.geoRow}>
        <Ionicons name="remove-circle-outline" size={18} color="#78776e" />
        <Text style={[proofStyles.geoText, { color: '#9c9b96' }]}>
          Неможливо перевірити (адреса без координат)
        </Text>
      </View>
    );
  }
  return match ? (
    <View style={proofStyles.geoRow}>
      <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
      <Text style={[proofStyles.geoText, { color: '#22c55e' }]}>
        Геопозиція підтверджена (≤ 300 м)
      </Text>
    </View>
  ) : (
    <View style={proofStyles.geoRow}>
      <Ionicons name="close-circle" size={18} color="#ef4444" />
      <Text style={[proofStyles.geoText, { color: '#ef4444' }]}>
        Геопозиція не співпала (&gt; 300 м)
      </Text>
    </View>
  );
}

function AnomalyBlock({ flags }: { flags: GeoFlags }) {
  const items: string[] = [];
  if (flags.proof_after_close) items.push('Пруф отримано після закриття замовлення в POS');
  if (flags.low_accuracy) items.push('Низька точність GPS (> 100 м)');
  if (items.length === 0) return null;
  return (
    <View style={proofStyles.anomalyBox}>
      <Text style={proofStyles.anomalyTitle}>АНОМАЛІЇ</Text>
      {items.map((item) => (
        <Text key={item} style={proofStyles.anomalyItem}>· {item}</Text>
      ))}
    </View>
  );
}

interface ProofModalProps {
  deliveryId: string | null;
  onClose: () => void;
}

function ProofModal({ deliveryId, onClose }: ProofModalProps) {
  const [proof, setProof] = useState<DeliveryProof | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deliveryId) return;
    let cancelled = false;
    setProof(undefined);
    setError(null);
    apiGet<DeliveryProof | null>(`/api/v1/deliveries/${deliveryId}/proof`)
      .then((data) => { if (!cancelled) setProof(data); })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Помилка завантаження');
        setProof(null);
      });
    return () => { cancelled = true; };
  }, [deliveryId]);

  return (
    <Modal
      visible={!!deliveryId}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={proofStyles.overlay}>
        <View style={proofStyles.sheet}>
          <View style={proofStyles.handle} />

          <View style={proofStyles.sheetHeader}>
            <Text style={proofStyles.sheetTitle}>Доказ доставки</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color="#78776e" />
            </TouchableOpacity>
          </View>

          {proof === undefined ? (
            <View style={proofStyles.centered}>
              <ActivityIndicator color="#78776e" />
            </View>
          ) : error ? (
            <View style={proofStyles.centered}>
              <Text style={proofStyles.errorText}>{error}</Text>
            </View>
          ) : proof === null ? (
            <View style={proofStyles.centered}>
              <Ionicons name="document-outline" size={32} color="#78776e" />
              <Text style={proofStyles.emptyText}>Доказ доставки відсутній</Text>
            </View>
          ) : (
            <View style={proofStyles.proofContent}>
              <GeoMatchRow match={proof.geo_match} flags={proof.geo_flags} />

              {proof.accuracy !== null ? (
                <View style={proofStyles.metaRow}>
                  <Text style={proofStyles.metaLabel}>ТОЧНІСТЬ GPS</Text>
                  <Text style={proofStyles.metaValue}>
                    {Math.round(proof.accuracy)} м
                  </Text>
                </View>
              ) : null}

              <View style={proofStyles.metaRow}>
                <Text style={proofStyles.metaLabel}>ЧАС ПРУФУ</Text>
                <Text style={proofStyles.metaValue}>
                  {new Date(proof.captured_at).toLocaleString('uk-UA', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </Text>
              </View>

              <AnomalyBlock flags={proof.geo_flags} />

              {proof.photo_url ? (
                <View style={proofStyles.photoBox}>
                  <Text style={proofStyles.metaLabel}>ФОТО</Text>
                  <Image
                    source={{ uri: proof.photo_url }}
                    style={proofStyles.photo}
                    resizeMode="cover"
                  />
                </View>
              ) : (
                <View style={proofStyles.noPhotoRow}>
                  <Ionicons name="camera-outline" size={16} color="#78776e" />
                  <Text style={proofStyles.noPhotoText}>Фото не додано</Text>
                </View>
              )}
            </View>
          )}

          <TouchableOpacity style={proofStyles.closeBtn} onPress={onClose}>
            <Text style={proofStyles.closeBtnText}>Закрити</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const proofStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#1a1917',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(250,249,246,0.14)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_700Bold' : undefined,
    fontWeight: '700',
    color: '#faf9f6',
  },
  centered: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    textAlign: 'center',
  },
  emptyText: {
    color: '#9c9b96',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    textAlign: 'center',
  },
  proofContent: { gap: 12 },
  geoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  geoText: {
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaLabel: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
    letterSpacing: 0.05,
    color: '#78776e',
  },
  metaValue: {
    fontSize: 13,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#d5d4ce',
  },
  anomalyBox: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
    borderRadius: 6,
    padding: 10,
    gap: 4,
  },
  anomalyTitle: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
    letterSpacing: 0.05,
    color: '#f59e0b',
    marginBottom: 2,
  },
  anomalyItem: {
    fontSize: 12,
    color: '#f59e0b',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  photoBox: { gap: 8 },
  photo: {
    width: '100%',
    height: 200,
    borderRadius: 6,
    backgroundColor: '#252420',
  },
  noPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  noPhotoText: {
    fontSize: 12,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  closeBtn: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#252420',
  },
  closeBtnText: {
    color: '#9c9b96',
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
});

// ── Main Screen ────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [proofDeliveryId, setProofDeliveryId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiGet<HistoryOrder[]>(
        '/api/v1/orders?status=completed,failed,cancelled',
      );
      data.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      setOrders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  // Client-side filtering
  const filtered = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    const cutoff = getDateRangeCutoff(dateRange);
    if (cutoff && new Date(o.created_at) < cutoff) return false;
    return true;
  });

  // Group by date
  const groups: { label: string; items: HistoryOrder[] }[] = [];
  const seen = new Map<string, number>();
  for (const order of filtered) {
    const key = new Date(order.created_at).toDateString();
    if (!seen.has(key)) {
      seen.set(key, groups.length);
      groups.push({ label: formatDateLabel(order.created_at), items: [] });
    }
    groups[seen.get(key)!].items.push(order);
  }

  function openProof(order: HistoryOrder) {
    if (order.status !== 'completed' || !order.delivery?.id) return;
    setProofDeliveryId(order.delivery.id);
  }

  if (loading && orders.length === 0) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Stack.Screen options={{ title: 'Історія', headerShown: false }} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Історія</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color="#78776e" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ title: 'Історія', headerShown: false }} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Історія</Text>
        <Text style={styles.headerCount}>{filtered.length}</Text>
      </View>

      {/* Status filter */}
      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterPill, statusFilter === f.value && styles.filterPillActive]}
            onPress={() => setStatusFilter(f.value)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.filterPillText, statusFilter === f.value && styles.filterPillTextActive]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Date range filter */}
      <View style={styles.dateRow}>
        {DATE_RANGES.map((r) => (
          <TouchableOpacity
            key={r.value}
            style={[styles.datePill, dateRange === r.value && styles.datePillActive]}
            onPress={() => setDateRange(r.value)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.datePillText, dateRange === r.value && styles.datePillTextActive]}
            >
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <View style={styles.centered}>
          <Ionicons name="warning-outline" size={32} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>Повторити</Text>
          </TouchableOpacity>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="archive-outline" size={48} color="#78776e" />
          <Text style={styles.emptyText}>Замовлень не знайдено</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.label}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#78776e" />
          }
          renderItem={({ item: group }) => (
            <View>
              <Text style={styles.dateLabel}>{group.label}</Text>
              {group.items.map((order, idx) => {
                const canViewProof = order.status === 'completed' && !!order.delivery?.id;
                return (
                  <TouchableOpacity
                    key={order.id}
                    style={[
                      styles.orderRow,
                      idx < group.items.length - 1 && styles.orderRowBorder,
                    ]}
                    onPress={() => openProof(order)}
                    activeOpacity={canViewProof ? 0.7 : 1}
                    disabled={!canViewProof}
                  >
                    <View style={styles.orderLeft}>
                      <Text style={styles.orderAddress} numberOfLines={1}>
                        {order.address}
                      </Text>
                      {order.delivery?.courier ? (
                        <Text style={styles.orderCourier}>
                          {order.delivery.courier.name}
                        </Text>
                      ) : null}
                      <Text style={styles.orderTime}>{formatTime(order.created_at)}</Text>
                    </View>
                    <View style={styles.orderRight}>
                      <View
                        style={[
                          styles.badge,
                          { borderColor: STATUS_COLOR[order.status] ?? 'rgba(250,249,246,0.14)' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            { color: STATUS_COLOR[order.status] ?? '#9c9b96' },
                          ]}
                        >
                          {STATUS_LABEL[order.status]}
                        </Text>
                      </View>
                      {canViewProof ? (
                        <Ionicons
                          name="shield-checkmark-outline"
                          size={14}
                          color="#78776e"
                          style={{ marginTop: 6 }}
                        />
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        />
      )}

      <ProofModal
        deliveryId={proofDeliveryId}
        onClose={() => setProofDeliveryId(null)}
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
  headerCount: {
    fontSize: 14,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#78776e',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.06)',
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.10)',
  },
  filterPillActive: {
    backgroundColor: '#252420',
    borderColor: 'rgba(250,249,246,0.20)',
  },
  filterPillText: {
    fontSize: 12,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },
  filterPillTextActive: {
    color: '#faf9f6',
  },
  dateRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.06)',
  },
  datePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  datePillActive: {
    backgroundColor: '#252420',
  },
  datePillText: {
    fontSize: 11,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
  },
  datePillTextActive: {
    color: '#d5d4ce',
  },
  list: { paddingBottom: 24 },
  dateLabel: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
    letterSpacing: 0.05,
    color: '#78776e',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  orderRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.06)',
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
});
