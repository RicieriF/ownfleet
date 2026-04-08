/**
 * GPS Consent Screen.
 *
 * Shown once after first login/registration, before the courier reaches the
 * main delivery screen. Explains GPS tracking and requests permissions.
 *
 * Flow:
 *  "Надати доступ" → requestLocationPermissions() → requestBatteryOptimizationExemption()
 *                  → mark consent done → navigate to (app)
 *  "Пропустити"    → mark consent done → navigate to (app)
 *                    (permissions will be requested again when delivery starts)
 *
 * If permissions are denied: show explanation + "Відкрити налаштування" button.
 * The screen is never shown again once consent is marked — regardless of whether
 * the user granted or denied permissions.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth';
import { requestLocationPermissions } from '@/services/location';
import { requestBatteryOptimizationExemption } from '@/services/battery';

export default function GpsConsentScreen() {
  const router = useRouter();
  const { setGpsConsentDone } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  async function handleAllow() {
    setLoading(true);
    const granted = await requestLocationPermissions();
    if (granted) {
      // Request battery exemption for Chinese OEMs (fire-and-forget)
      requestBatteryOptimizationExemption().catch(() => {});
      await setGpsConsentDone();
      router.replace('/(app)');
    } else {
      setDenied(true);
      setLoading(false);
    }
  }

  async function handleSkip() {
    await setGpsConsentDone();
    router.replace('/(app)');
  }

  async function handleOpenSettings() {
    await Linking.openSettings();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconWrap}>
          <Ionicons name="location" size={64} color="#9c9b96" />
        </View>

        {/* Title & description */}
        <Text style={styles.title}>Доступ до геолокації</Text>
        <Text style={styles.subtitle}>
          Додаток відстежує ваше місцезнаходження під час активних доставок.
        </Text>

        {/* Why section */}
        <View style={styles.reasonsCard}>
          <ReasonRow icon="check" text="Підтвердження факту доставки (геопруф)" />
          <ReasonRow icon="map"   text="Менеджер бачить де ви знаходитесь" />
          <ReasonRow icon="time"  text="Статистика ефективності маршрутів" />
          <ReasonRow icon="lock"  text="Дані не передаються третім особам" />
        </View>

        {/* Note about background */}
        <Text style={styles.note}>
          GPS активний лише під час доставки.{'\n'}
          {Platform.OS === 'android'
            ? 'Потрібен доступ до геолокації у фоні.'
            : 'Потрібен доступ "Завжди" для роботи у фоні.'}
        </Text>

        {/* Denied state */}
        {denied && (
          <View style={styles.deniedCard}>
            <Text style={styles.deniedText}>
              Доступ відхилено. Щоб увімкнути GPS — відкрийте налаштування додатка.
            </Text>
            <TouchableOpacity style={styles.settingsBtn} onPress={handleOpenSettings}>
              <Text style={styles.settingsBtnText}>Відкрити налаштування</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {!denied && (
            <TouchableOpacity
              style={[styles.btnAllow, loading && styles.btnDisabled]}
              onPress={handleAllow}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#faf9f6" />
              ) : (
                <Text style={styles.btnAllowText}>Надати доступ до GPS</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.btnSkip} onPress={handleSkip} activeOpacity={0.7}>
            <Text style={styles.btnSkipText}>
              {denied ? 'Продовжити без GPS' : 'Пропустити'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const REASON_ICONS = {
  check: 'checkmark-circle-outline',
  map:   'map-outline',
  time:  'time-outline',
  lock:  'lock-closed-outline',
} as const;

function ReasonRow({ icon, text }: { icon: keyof typeof REASON_ICONS; text: string }) {
  return (
    <View style={styles.reasonRow}>
      <Ionicons name={REASON_ICONS[icon]} size={18} color="#78776e" />
      <Text style={styles.reasonText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'center',
  },
  iconWrap: { alignItems: 'center', marginBottom: 20 },
  title: {
    fontSize: 26,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#9c9b96',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  reasonsCard: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    padding: 20,
    gap: 14,
    marginBottom: 20,
  },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  reasonText: { fontSize: 14, color: '#d5d4ce', flex: 1, lineHeight: 22 },
  note: {
    fontSize: 13,
    color: '#78776e',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  deniedCard: {
    backgroundColor: 'rgba(239,68,68,0.04)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.12)',
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  deniedText: { fontSize: 14, color: '#d5d4ce', lineHeight: 20 },
  settingsBtn: {
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.14)',
  },
  settingsBtnText: { color: '#9c9b96', fontSize: 14, fontFamily: 'Manrope_600SemiBold' },
  actions: { gap: 12 },
  btnAllow: {
    backgroundColor: '#3a3935',
    borderRadius: 6,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
  },
  btnDisabled: { opacity: 0.5 },
  btnAllowText: { color: '#faf9f6', fontSize: 15, fontFamily: 'Manrope_600SemiBold', letterSpacing: -0.2 },
  btnSkip: { paddingVertical: 14, alignItems: 'center' },
  btnSkipText: { color: '#78776e', fontSize: 15 },
});
