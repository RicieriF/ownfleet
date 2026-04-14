/**
 * Shift history screen — courier's last 60 completed shifts.
 * Grouped by month. Each row: date, duration, deliveries count, distance, ended_by badge.
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
import { ShiftHistoryItem } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  });
}

function formatMonthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
}

function formatDuration(startedAt: string, endedAt: string): string {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h} год ${m} хв`;
}

function formatDistance(km: string): string | null {
  const n = parseFloat(km);
  if (isNaN(n) || n === 0) return null;
  return `${n.toFixed(1)} км`;
}

function groupByMonth(
  items: ShiftHistoryItem[],
): { label: string; items: ShiftHistoryItem[] }[] {
  const groups: Map<string, { label: string; items: ShiftHistoryItem[] }> = new Map();
  for (const item of items) {
    const key = new Date(item.started_at).toLocaleDateString('uk-UA', {
      year: 'numeric',
      month: '2-digit',
    });
    if (!groups.has(key)) {
      groups.set(key, { label: formatMonthLabel(item.started_at), items: [] });
    }
    groups.get(key)!.items.push(item);
  }
  return Array.from(groups.values());
}

function totalStats(items: ShiftHistoryItem[]): { deliveries: number; distanceKm: number } {
  return items.reduce(
    (acc, s) => ({
      deliveries: acc.deliveries + s.total_deliveries,
      distanceKm: acc.distanceKm + parseFloat(s.total_distance_km || '0'),
    }),
    { deliveries: 0, distanceKm: 0 },
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function ShiftsScreen() {
  const [items, setItems] = useState<ShiftHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError('');
    try {
      const data = await apiGet<ShiftHistoryItem[]>('/api/v1/shifts/my-history');
      setItems(data);
    } catch {
      setError('Не вдалось завантажити зміни. Спробуйте ще раз.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleRefresh() {
    setRefreshing(true);
    load(true);
  }

  const groups = groupByMonth(items);
  const totals = totalStats(items);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Мої зміни',
          headerStyle: { backgroundColor: '#0c0b09' },
          headerTintColor: '#faf9f6',
          headerTitleStyle: { fontFamily: 'Manrope_600SemiBold', fontSize: 17 },
        }}
      />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        {loading ? (
          <ActivityIndicator color="#9c9b96" style={{ marginTop: 60 }} />
        ) : error ? (
          <View style={styles.centerWrap}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => load()} activeOpacity={0.7}>
              <Text style={styles.retryText}>Повторити</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centerWrap}>
            <Ionicons name="time-outline" size={48} color="#3a3935" style={{ marginBottom: 16 }} />
            <Text style={styles.emptyTitle}>Немає завершених змін</Text>
            <Text style={styles.emptySub}>Завершені зміни зʼявляться тут</Text>
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
            {/* Summary */}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryText}>
                <Text style={styles.summaryNum}>{items.length}</Text>
                <Text> змін · </Text>
                <Text style={styles.summaryNum}>{totals.deliveries}</Text>
                <Text> доставок · </Text>
                <Text style={styles.summaryNum}>{totals.distanceKm.toFixed(0)}</Text>
                <Text> км</Text>
              </Text>
            </View>

            {groups.map((group) => (
              <View key={group.label} style={styles.group}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                <View style={styles.groupCard}>
                  {group.items.map((item, idx) => (
                    <ShiftRow
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

// ── ShiftRow ───────────────────────────────────────────────────────────────

function ShiftRow({ item, isLast }: { item: ShiftHistoryItem; isLast: boolean }) {
  const duration = formatDuration(item.started_at, item.ended_at);
  const distance = formatDistance(item.total_distance_km);

  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowDate}>{formatDate(item.started_at)}</Text>
        <View style={styles.rowMeta}>
          <Text style={styles.metaChip}>{duration}</Text>
          {item.total_deliveries > 0 && (
            <Text style={styles.metaChip}>{item.total_deliveries} дост.</Text>
          )}
          {distance ? <Text style={styles.metaChip}>{distance}</Text> : null}
        </View>
      </View>
      {item.ended_by !== 'courier' && (
        <EndedByBadge endedBy={item.ended_by} />
      )}
    </View>
  );
}

function EndedByBadge({ endedBy }: { endedBy: 'manager' | 'auto' }) {
  const isAuto = endedBy === 'auto';
  return (
    <View style={[styles.badge, isAuto ? styles.badgeAuto : styles.badgeManager]}>
      <Text style={[styles.badgeText, isAuto ? styles.badgeTextAuto : styles.badgeTextManager]}>
        {isAuto ? 'авто' : 'менеджер'}
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  // Center states
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
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

  // Summary
  summaryRow: { marginBottom: 20 },
  summaryText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: '#78776e',
  },
  summaryNum: {
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
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.06)',
  },
  rowLeft: { flex: 1, minWidth: 0 },
  rowDate: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: '#faf9f6',
    marginBottom: 4,
  },
  rowMeta: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaChip: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 11,
    color: '#78776e',
  },

  // Badges
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    marginLeft: 10,
    flexShrink: 0,
  },
  badgeAuto: {
    borderColor: 'rgba(251,191,36,0.25)',
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  badgeManager: {
    borderColor: 'rgba(156,155,150,0.25)',
    backgroundColor: 'rgba(156,155,150,0.08)',
  },
  badgeText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 10,
    letterSpacing: 0.3,
  },
  badgeTextAuto: { color: '#fbbf24' },
  badgeTextManager: { color: '#9c9b96' },
});
