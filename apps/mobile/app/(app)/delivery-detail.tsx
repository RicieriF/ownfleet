/**
 * Delivery Detail screen.
 *
 * Reached from:
 *   - Statistics screen → "Останні доставки" row (tap)
 *   - Day Detail screen → delivery row (tap)
 *
 * Shows delivery metadata: status, address, timing, duration.
 * No map (location_pings not exposed via public API — future enhancement).
 *
 * Params (all serialized strings from expo-router):
 *   deliveryId, status, address, external_id?,
 *   assigned_at, started_at?, completed_at?
 */
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(started: string | null | undefined, completed: string | null | undefined): string {
  if (!started || !completed) return '—';
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (ms <= 0) return '—';
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  if (min === 0) return `${sec} сек`;
  if (min < 60) return `${min} хв`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} год` : `${h} год ${m} хв`;
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'completed' ? '#22c55e' : '#ef4444';
  return <View style={[styles.statusDot, { backgroundColor: color }]} />;
}

function StatusLabel({ status }: { status: string }) {
  return status === 'completed' ? 'Виконано' : 'Не доставлено';
}

// ── Detail row ─────────────────────────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.rowValueMono]}>{value}</Text>
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function DeliveryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    deliveryId: string;
    status: string;
    address: string;
    external_id?: string;
    assigned_at: string;
    started_at?: string;
    completed_at?: string;
  }>();

  const { deliveryId, status, address, external_id, assigned_at, started_at, completed_at } = params;

  const orderLabel = external_id ? `Замовлення #${external_id}` : `Замовлення ${deliveryId.slice(0, 8).toUpperCase()}`;
  const date = formatDateFull(assigned_at);
  const duration = formatDuration(started_at, completed_at);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#9c9b96" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{orderLabel}</Text>
          <Text style={styles.headerSub}>
            {date}{duration !== '—' ? ` · ${duration}` : ''}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Status badge */}
        <View style={styles.statusRow}>
          <StatusDot status={status} />
          <Text style={styles.statusText}><StatusLabel status={status} /></Text>
        </View>

        {/* Info card */}
        <View style={styles.card}>
          <Row label="АДРЕСА" value={address} />
          {external_id ? <Row label="НОМЕР" value={`#${external_id}`} mono /> : null}
          <View style={styles.divider} />
          <Row label="ПРИЗНАЧЕНО" value={formatTime(assigned_at)} mono />
          <Row label="ПОЧАТОК" value={formatTime(started_at)} mono />
          <Row label="ЗАВЕРШЕНО" value={formatTime(completed_at)} mono />
          <View style={styles.divider} />
          <Row label="ТРИВАЛІСТЬ" value={duration} mono />
        </View>

        {/* Future: history map with route polyline */}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
    gap: 12,
  },
  backBtn: { padding: 2 },
  headerCenter: { flex: 1 },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'JetBrainsMono_500Medium',
    color: '#9c9b96',
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'Manrope_400Regular',
    color: '#78776e',
    marginTop: 2,
  },

  content: {
    padding: 20,
    gap: 16,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 13,
    fontFamily: 'Manrope_500Medium',
    color: '#9c9b96',
  },

  card: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowLabel: {
    width: 88,
    fontSize: 11,
    fontFamily: 'Manrope_500Medium',
    color: '#78776e',
    letterSpacing: 0.5,
    paddingTop: 1,
  },
  rowValue: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Manrope_500Medium',
    color: '#c8c7c0',
    lineHeight: 20,
  },
  rowValueMono: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 13,
    color: '#c8c7c0',
  },

  divider: {
    height: 1,
    backgroundColor: 'rgba(250,249,246,0.06)',
    marginHorizontal: 16,
  },
});
