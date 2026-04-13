/**
 * Delivery history screen — courier's completed and failed deliveries.
 * Shows the last 50 deliveries from the API, grouped by date.
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
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiGet } from '@/api/client';
import { DeliveryHistoryItem } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return '—';
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

function groupByDate(items: DeliveryHistoryItem[]): { label: string; items: DeliveryHistoryItem[] }[] {
  const groups: Map<string, { label: string; items: DeliveryHistoryItem[] }> = new Map();

  for (const item of items) {
    const date = new Date(item.assigned_at);
    const key = date.toDateString();
    if (!groups.has(key)) {
      groups.set(key, { label: formatDateLabel(item.assigned_at), items: [] });
    }
    groups.get(key)!.items.push(item);
  }

  return Array.from(groups.values());
}

function durationMinutes(item: DeliveryHistoryItem): string | null {
  if (!item.started_at || !item.completed_at) return null;
  const ms = new Date(item.completed_at).getTime() - new Date(item.started_at).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return null;
  return `${min} хв`;
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const [items, setItems] = useState<DeliveryHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError('');
    try {
      const data = await apiGet<DeliveryHistoryItem[]>('/api/v1/deliveries/my-history');
      setItems(data);
    } catch {
      setError('Не вдалось завантажити історію. Спробуйте ще раз.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleRefresh() {
    setRefreshing(true);
    load(true);
  }

  const groups = groupByDate(items);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Мої доставки',
          headerStyle: { backgroundColor: '#0c0b09' },
          headerTintColor: '#faf9f6',
          headerTitleStyle: { fontFamily: 'Manrope_600SemiBold', fontSize: 17 },
        }}
      />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        {loading ? (
          <ActivityIndicator color="#9c9b96" style={{ marginTop: 60 }} />
        ) : error ? (
          <View style={styles.errorWrap}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => load()} activeOpacity={0.7}>
              <Text style={styles.retryText}>Повторити</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="time-outline" size={48} color="#3a3935" style={{ marginBottom: 16 }} />
            <Text style={styles.emptyTitle}>Немає доставок</Text>
            <Text style={styles.emptySub}>Завершені доставки зʼявляться тут</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="#9c9b96"
              />
            }
          >
            {/* Summary row */}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryText}>
                <Text style={styles.summaryCount}>{items.length}</Text>
                <Text> доставок · </Text>
                <Text style={styles.summaryCount}>{items.filter((i) => i.status === 'completed').length}</Text>
                <Text> виконано</Text>
              </Text>
            </View>

            {groups.map((group) => (
              <View key={group.label} style={styles.group}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                <View style={styles.groupCard}>
                  {group.items.map((item, idx) => (
                    <DeliveryRow
                      key={item.id}
                      item={item}
                      isLast={idx === group.items.length - 1}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

// ── DeliveryRow ──────────────────────────────────────────────────────────────

function DeliveryRow({ item, isLast }: { item: DeliveryHistoryItem; isLast: boolean }) {
  const completed = item.status === 'completed';
  const duration = durationMinutes(item);

  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <View style={[styles.statusDot, completed ? styles.dotGreen : styles.dotRed]} />
      <View style={styles.rowContent}>
        <Text style={styles.address} numberOfLines={1}>
          {item.order.address}
        </Text>
        <View style={styles.metaRow}>
          {item.order.external_id ? (
            <Text style={styles.metaText}>№ {item.order.external_id}</Text>
          ) : null}
          <Text style={styles.metaText}>{formatTime(item.completed_at ?? item.assigned_at)}</Text>
          {duration ? <Text style={styles.metaText}>{duration}</Text> : null}
        </View>
      </View>
      {!completed && (
        <View style={styles.failedBadge}>
          <Text style={styles.failedBadgeText}>провал</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  // Summary
  summaryRow: {
    marginBottom: 20,
  },
  summaryText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: '#78776e',
  },
  summaryCount: {
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#9c9b96',
  },

  // Group
  group: { marginBottom: 20 },
  groupLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: '#78776e',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  groupCard: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    overflow: 'hidden',
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.06)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  dotGreen: { backgroundColor: '#22c55e' },
  dotRed: { backgroundColor: '#ef4444' },
  rowContent: { flex: 1, minWidth: 0 },
  address: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: '#faf9f6',
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  metaText: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 11,
    color: '#78776e',
  },
  failedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  failedBadgeText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 10,
    color: '#ef4444',
    letterSpacing: 0.3,
  },

  // Empty
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 18,
    color: '#faf9f6',
    marginBottom: 6,
  },
  emptySub: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: '#78776e',
    textAlign: 'center',
  },

  // Error
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: '#78776e',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.12)',
    backgroundColor: '#1a1917',
  },
  retryText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: '#9c9b96',
  },
});
