/**
 * Push Notifications Consent Screen.
 *
 * Shown once after gps-consent, before the courier reaches the main screen.
 * Explains what notifications the courier will receive and requests permission.
 *
 * Flow:
 *  "Увімкнути сповіщення" → registerPushToken() → mark done → navigate to (app)
 *  "Пропустити"           → mark done → navigate to (app)
 *                           (courier won't get push; can enable later via phone settings)
 *
 * If permission denied: show explanation + "Відкрити налаштування" button.
 * Screen is never shown again once consent is marked.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '@/store/auth';
import { registerPushToken } from '@/services/notifications';

export default function NotificationsConsentScreen() {
  const router = useRouter();
  const { setNotifConsentDone } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  async function handleAllow() {
    setLoading(true);
    try {
      await registerPushToken();
      // registerPushToken returns void regardless of permission result.
      // Check if denied by trying permissions again — if FCM token wasn't saved,
      // the system dialog was dismissed/denied. We detect denial via the
      // Notifications API directly.
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        setLoading(false);
        return;
      }
    } catch {
      // Non-critical — proceed even on error
    }
    await setNotifConsentDone();
    router.replace('/(app)');
  }

  async function handleSkip() {
    await setNotifConsentDone();
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
          <Ionicons name="notifications" size={64} color="#9c9b96" />
        </View>

        {/* Title & description */}
        <Text style={styles.title}>Push-сповіщення</Text>
        <Text style={styles.subtitle}>
          Дозвольте надсилати повідомлення, щоб не пропустити нову доставку.
        </Text>

        {/* What will be sent */}
        <View style={styles.reasonsCard}>
          <ReasonRow icon="cube"  text="Нова доставка призначена" />
          <ReasonRow icon="alert" text="Нагадування від менеджера" />
          <ReasonRow icon="time"  text="Попередження про закінчення зміни" />
          <ReasonRow icon="lock"  text="Не використовуються для реклами" />
        </View>

        {/* Note */}
        <Text style={styles.note}>
          {Platform.OS === 'ios'
            ? 'Без дозволу доставки надходитимуть лише при відкритому додатку.'
            : 'Без дозволу push-сповіщення не працюватимуть.'}
        </Text>

        {/* Denied state */}
        {denied && (
          <View style={styles.deniedCard}>
            <Text style={styles.deniedText}>
              Доступ відхилено. Щоб увімкнути сповіщення — відкрийте налаштування додатка.
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
                <Text style={styles.btnAllowText}>Увімкнути сповіщення</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.btnSkip} onPress={handleSkip} activeOpacity={0.7}>
            <Text style={styles.btnSkipText}>
              {denied ? 'Продовжити без сповіщень' : 'Пропустити'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const REASON_ICONS = {
  cube:  'cube-outline',
  alert: 'megaphone-outline',
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
