/**
 * Delivery navigation screen.
 *
 * Opened during an active (in_progress) delivery.
 * Shows full order details, real-time elapsed timer,
 * and one-tap launchers for external navigation apps.
 *
 * Params (from expo-router):
 *   deliveryId   — for the "Здати замовлення" deep link back to proof screen
 *   address      — human-readable delivery address
 *   lat          — order latitude (may be empty string if not geocoded)
 *   lng          — order longitude (may be empty string if not geocoded)
 *   notes        — optional order notes
 *   externalId   — optional POS external ID
 *   startedAt    — ISO timestamp when delivery started (for elapsed timer)
 */
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function useElapsedTimer(startedAt: string | null): string {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!startedAt) {
      setLabel('—');
      return;
    }
    const start = new Date(startedAt).getTime();

    function tick() {
      setLabel(formatElapsed(Date.now() - start));
    }

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return label;
}

// ── Navigation app launchers ───────────────────────────────────────────────

interface NavApp {
  id: string;
  label: string;
  icon: string;
  platforms?: ('ios' | 'android')[];
  buildUrl: (lat: number, lng: number, address: string) => string;
  buildFallbackUrl: (address: string) => string;
}

const NAV_APPS: NavApp[] = [
  {
    id: 'google',
    label: 'Google Maps',
    icon: 'navigate-outline',
    buildUrl: (lat, lng) =>
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
    buildFallbackUrl: (address) =>
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
  },
  {
    id: 'waze',
    label: 'Waze',
    icon: 'car-outline',
    buildUrl: (lat, lng) =>
      `https://waze.com/ul?ll=${lat},${lng}&navigate=yes&zoom=17`,
    buildFallbackUrl: (address) =>
      `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`,
  },
  {
    id: 'apple',
    label: 'Apple Maps',
    icon: 'map-outline',
    platforms: ['ios'],
    buildUrl: (lat, lng) => `maps://?daddr=${lat},${lng}`,
    buildFallbackUrl: (address) => `maps://?q=${encodeURIComponent(address)}`,
  },
];

async function openNavApp(app: NavApp, lat: number | null, lng: number | null, address: string) {
  const url =
    lat !== null && lng !== null
      ? app.buildUrl(lat, lng, address)
      : app.buildFallbackUrl(address);

  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) {
    Alert.alert(
      `${app.label} недоступний`,
      `Не вдалося відкрити ${app.label}. Переконайтесь, що додаток встановлено.`,
    );
    return;
  }
  await Linking.openURL(url);
}

// ── Main Screen ────────────────────────────────────────────────────────────

export default function NavigateScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    deliveryId: string;
    address: string;
    lat: string;
    lng: string;
    notes: string;
    externalId: string;
    startedAt: string;
  }>();

  const lat = params.lat ? parseFloat(params.lat) : null;
  const lng = params.lng ? parseFloat(params.lng) : null;
  const hasCoords = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);

  const elapsedTimer = useElapsedTimer(params.startedAt || null);

  async function handleOpenApp(app: NavApp) {
    await openNavApp(app, lat, lng, params.address);
  }

  function handleCompleteDelivery() {
    router.push({ pathname: '/(app)/proof', params: { deliveryId: params.deliveryId } });
  }

  const visibleApps = NAV_APPS.filter(
    (app) => !app.platforms || app.platforms.includes(Platform.OS as 'ios' | 'android'),
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#9c9b96" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Навігація</Text>
        <View style={styles.headerRight}>
          <View style={styles.activeDot} />
          <Text style={styles.headerStatus}>Доставка активна</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Elapsed timer */}
        <View style={styles.timerBlock}>
          <Text style={styles.timerLabel}>ЧАС У ДОРОЗІ</Text>
          <Text style={styles.timerValue}>{elapsedTimer}</Text>
        </View>

        {/* Address card */}
        <View style={styles.addressCard}>
          <View style={styles.addressHeader}>
            <Ionicons name="location-outline" size={16} color="#78776e" />
            <Text style={styles.addressLabel}>АДРЕСА ДОСТАВКИ</Text>
          </View>
          <Text style={styles.address}>{params.address}</Text>

          {params.notes ? (
            <View style={styles.divider} />
          ) : null}
          {params.notes ? (
            <Text style={styles.notes}>{params.notes}</Text>
          ) : null}

          {params.externalId ? (
            <Text style={styles.externalId}>№ {params.externalId}</Text>
          ) : null}

          {!hasCoords && (
            <View style={styles.noCoordsRow}>
              <Ionicons name="warning-outline" size={14} color="#d97706" />
              <Text style={styles.noCoordsText}>Координати не визначені — пошук за адресою</Text>
            </View>
          )}
        </View>

        {/* Navigation app buttons */}
        <Text style={styles.sectionLabel}>ВІДКРИТИ В</Text>
        <View style={styles.navApps}>
          {visibleApps.map((app) => (
            <TouchableOpacity
              key={app.id}
              style={styles.navAppBtn}
              onPress={() => handleOpenApp(app)}
              activeOpacity={0.7}
            >
              <Ionicons name={app.icon as never} size={20} color="#9c9b96" />
              <Text style={styles.navAppLabel}>{app.label}</Text>
              <Ionicons name="open-outline" size={14} color="#3a3935" style={styles.navAppExternal} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Footer action */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.completeBtn}
          onPress={handleCompleteDelivery}
          activeOpacity={0.8}
        >
          <Ionicons name="checkmark-circle-outline" size={20} color="#faf9f6" style={{ marginRight: 8 }} />
          <Text style={styles.completeBtnText}>Здати замовлення</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    flex: 1,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  headerStatus: { fontSize: 12, color: '#9c9b96', fontFamily: 'Manrope_400Regular' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 20, gap: 16 },

  // Timer block
  timerBlock: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  timerLabel: {
    fontSize: 11,
    fontFamily: 'Manrope_600SemiBold',
    color: '#78776e',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  timerValue: {
    fontSize: 40,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#faf9f6',
    letterSpacing: 2,
  },

  // Address card
  addressCard: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    padding: 16,
    gap: 8,
  },
  addressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addressLabel: {
    fontSize: 11,
    fontFamily: 'Manrope_600SemiBold',
    color: '#78776e',
    letterSpacing: 0.8,
  },
  address: {
    fontSize: 20,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    lineHeight: 28,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(250,249,246,0.06)',
    marginVertical: 2,
  },
  notes: {
    fontSize: 14,
    fontFamily: 'Manrope_400Regular',
    color: '#9c9b96',
    lineHeight: 20,
  },
  externalId: {
    fontSize: 12,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#78776e',
  },
  noCoordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  noCoordsText: {
    fontSize: 12,
    fontFamily: 'Manrope_400Regular',
    color: '#d97706',
  },

  // Navigation apps
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Manrope_600SemiBold',
    color: '#78776e',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  navApps: { gap: 8 },
  navAppBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  navAppLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Manrope_500Medium',
    color: '#faf9f6',
  },
  navAppExternal: { marginLeft: 'auto' },

  // Footer
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,249,246,0.08)',
  },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3a3935',
    borderRadius: 6,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
  },
  completeBtnText: {
    color: '#faf9f6',
    fontSize: 17,
    fontFamily: 'Manrope_600SemiBold',
  },
});
