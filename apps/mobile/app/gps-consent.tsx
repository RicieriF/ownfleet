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
          <Text style={styles.icon}>📍</Text>
        </View>

        {/* Title & description */}
        <Text style={styles.title}>Доступ до геолокації</Text>
        <Text style={styles.subtitle}>
          Додаток відстежує ваше місцезнаходження під час активних доставок.
        </Text>

        {/* Why section */}
        <View style={styles.reasonsCard}>
          <ReasonRow icon="✅" text="Підтвердження факту доставки (геопруф)" />
          <ReasonRow icon="🗺️" text="Менеджер бачить де ви знаходитесь" />
          <ReasonRow icon="⏱️" text="Статистика ефективності маршрутів" />
          <ReasonRow icon="🔒" text="Дані не передаються третім особам" />
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
                <ActivityIndicator color="#09090b" />
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

function ReasonRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.reasonRow}>
      <Text style={styles.reasonIcon}>{icon}</Text>
      <Text style={styles.reasonText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09090b' },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'center',
  },
  iconWrap: { alignItems: 'center', marginBottom: 20 },
  icon: { fontSize: 64 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fafafa',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  reasonsCard: {
    backgroundColor: '#18181b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 20,
    gap: 14,
    marginBottom: 20,
  },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  reasonIcon: { fontSize: 18, lineHeight: 24 },
  reasonText: { fontSize: 14, color: '#d4d4d8', flex: 1, lineHeight: 22 },
  note: {
    fontSize: 13,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  deniedCard: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  deniedText: { fontSize: 14, color: '#fca5a5', lineHeight: 20 },
  settingsBtn: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  settingsBtnText: { color: '#fca5a5', fontSize: 14, fontWeight: '600' },
  actions: { gap: 12 },
  btnAllow: {
    backgroundColor: '#f4f4f5',
    borderRadius: 6,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  btnAllowText: { color: '#09090b', fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  btnSkip: { paddingVertical: 14, alignItems: 'center' },
  btnSkipText: { color: '#71717a', fontSize: 15 },
});
