/**
 * Manager Telegram Notifications screen.
 *
 * Flow:
 *   Not connected → [Підключити] → POST /telegram/connect → show code banner
 *   Connected     → grouped pref checkboxes → [Зберегти] → PATCH /telegram/prefs
 *                   [Відключити] header button → DELETE /telegram/connect
 *
 * Pref groups:
 *   ЗАМОВЛЕННЯ   — order_created, delivery_assigned, delivery_completed,
 *                  delivery_failed, delivery_force_closed
 *   КУРʼЄРИ     — courier_shift_started, courier_shift_ended,
 *                  courier_shift_auto_closed, courier_not_responding, shift_anomaly
 *   СИСТЕМА      — dispatch_no_courier, geocode_failed
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ManagerTelegramPrefs {
  order_created?: boolean;
  delivery_assigned?: boolean;
  delivery_completed?: boolean;
  delivery_failed?: boolean;
  delivery_force_closed?: boolean;
  courier_shift_started?: boolean;
  courier_shift_ended?: boolean;
  courier_shift_auto_closed?: boolean;
  courier_not_responding?: boolean;
  shift_anomaly?: boolean;
  dispatch_no_courier?: boolean;
  geocode_failed?: boolean;
}

type PrefKey = keyof ManagerTelegramPrefs;

interface TelegramStatus {
  connected: boolean;
  prefs: ManagerTelegramPrefs;
}

interface ConnectResponse {
  code: string;
  expires_in: number;
}

// ── Default prefs (mirrors DEFAULT_MANAGER_PREFS in telegram.types.ts) ─────────

const DEFAULT_PREFS: ManagerTelegramPrefs = {
  order_created: true,
  courier_shift_auto_closed: true,
  courier_not_responding: true,
  dispatch_no_courier: true,
  geocode_failed: true,
};

// ── Pref group config ──────────────────────────────────────────────────────────

interface PrefDef {
  key: PrefKey;
  label: string;
}

const GROUPS: { title: string; items: PrefDef[] }[] = [
  {
    title: 'ЗАМОВЛЕННЯ',
    items: [
      { key: 'order_created',        label: 'Нове замовлення надійшло' },
      { key: 'delivery_assigned',    label: 'Доставку призначено курʼєру' },
      { key: 'delivery_completed',   label: 'Доставку виконано' },
      { key: 'delivery_failed',      label: 'Доставка провалена' },
      { key: 'delivery_force_closed',label: 'Доставку примусово закрито' },
    ],
  },
  {
    title: 'КУРʼЄРИ',
    items: [
      { key: 'courier_shift_started',    label: 'Курʼєр вийшов на зміну' },
      { key: 'courier_shift_ended',      label: 'Курʼєр завершив зміну' },
      { key: 'courier_shift_auto_closed',label: 'Зміну закрито автоматично' },
      { key: 'courier_not_responding',   label: 'Курʼєр не відповідає' },
      { key: 'shift_anomaly',            label: 'Аномальна зміна виявлена' },
    ],
  },
  {
    title: 'СИСТЕМА',
    items: [
      { key: 'dispatch_no_courier', label: 'Немає вільних курʼєрів' },
      { key: 'geocode_failed',      label: 'Помилка геокодування адреси' },
    ],
  },
];

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function ManagerTelegramScreen() {
  const router = useRouter();

  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<ManagerTelegramPrefs>({});
  const [connectCode, setConnectCode] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [error, setError] = useState('');

  // ── Load status ──────────────────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const s = await apiGet<TelegramStatus>('/api/v1/telegram/status');
      setStatus(s);
      setPrefs({ ...DEFAULT_PREFS, ...(s.prefs ?? {}) });
    } catch {
      setStatus({ connected: false, prefs: {} });
      setPrefs({ ...DEFAULT_PREFS });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  // ── Connect ──────────────────────────────────────────────────────────────────

  async function handleConnect() {
    setError('');
    setActionLoading(true);
    try {
      const res = await apiPost<ConnectResponse>('/api/v1/telegram/connect');
      setConnectCode(res.code);
    } catch {
      setError('Не вдалось згенерувати код. Спробуйте ще раз.');
    } finally {
      setActionLoading(false);
    }
  }

  // ── Disconnect ───────────────────────────────────────────────────────────────

  function handleDisconnectPrompt() {
    Alert.alert(
      'Відключити Telegram?',
      'Ви більше не отримуватимете сповіщення в Telegram.',
      [
        { text: 'Відміна', style: 'cancel' },
        {
          text: 'Відключити',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            setError('');
            try {
              await apiDelete('/api/v1/telegram/connect');
              setStatus({ connected: false, prefs: {} });
              setPrefs({ ...DEFAULT_PREFS });
              setConnectCode(null);
            } catch {
              setError('Не вдалось відключити. Спробуйте ще раз.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ],
    );
  }

  // ── Save prefs ───────────────────────────────────────────────────────────────

  async function handleSavePrefs() {
    setSaving(true);
    setSavedFeedback(false);
    setError('');
    try {
      await apiPatch('/api/v1/telegram/prefs', prefs);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 3000);
    } catch {
      setError('Не вдалось зберегти налаштування. Спробуйте ще раз.');
    } finally {
      setSaving(false);
    }
  }

  function togglePref(key: PrefKey) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    setSavedFeedback(false);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color="#9c9b96" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Telegram сповіщення</Text>
            {status?.connected && (
              <View style={styles.connectedRow}>
                <View style={styles.connectedDot} />
                <Text style={styles.connectedText}>Підключено</Text>
              </View>
            )}
          </View>
          {status?.connected ? (
            <TouchableOpacity
              onPress={handleDisconnectPrompt}
              disabled={actionLoading}
              hitSlop={8}
              style={styles.headerAction}
            >
              <Text style={[styles.disconnectText, actionLoading && styles.disabled]}>
                Відключити
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 80 }} />
          )}
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#78776e" />
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Not connected ──────────────────────────────────────────── */}
            {!status?.connected && !connectCode && (
              <View style={styles.card}>
                <View style={styles.notConnectedPad}>
                  <Ionicons
                    name="paper-plane-outline"
                    size={32}
                    color="#3a3935"
                    style={{ marginBottom: 12 }}
                  />
                  <Text style={styles.notConnectedTitle}>Telegram не підключено</Text>
                  <Text style={styles.notConnectedText}>
                    Отримуйте сповіщення про замовлення, курʼєрів та систему прямо у Telegram.
                  </Text>
                  {error ? (
                    <Text style={styles.errorText}>{error}</Text>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.connectBtn, actionLoading && styles.disabled]}
                    onPress={handleConnect}
                    disabled={actionLoading}
                    activeOpacity={0.8}
                  >
                    {actionLoading ? (
                      <ActivityIndicator color="#faf9f6" size="small" />
                    ) : (
                      <Text style={styles.connectBtnText}>Підключити Telegram</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Connect code banner ────────────────────────────────────── */}
            {!status?.connected && connectCode && (
              <View style={styles.card}>
                <View style={styles.codePad}>
                  <Text style={styles.codeLabel}>КОД ДЛЯ ПІДКЛЮЧЕННЯ · ДІЄ 10 ХВ</Text>
                  <Text style={styles.code}>{connectCode}</Text>
                  <Text style={styles.codeInstruction}>
                    Відкрийте{' '}
                    <Text style={styles.botName}>@weego_notify_bot</Text>
                    {' '}і надішліть:
                  </Text>
                  <Text style={styles.codeCommand}>/start {connectCode}</Text>
                  <Text style={styles.codeHint}>
                    Після підключення поверніться та натисніть «Перевірити».
                  </Text>
                  <TouchableOpacity
                    style={styles.refreshBtn}
                    onPress={() => { setConnectCode(null); void loadStatus(); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="refresh-outline" size={14} color="#9c9b96" />
                    <Text style={styles.refreshText}>Перевірити статус</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Prefs (connected) ──────────────────────────────────────── */}
            {status?.connected && (
              <>
                {GROUPS.map((group) => (
                  <View key={group.title}>
                    <Text style={styles.groupLabel}>{group.title}</Text>
                    <View style={styles.card}>
                      {group.items.map((item, idx) => {
                        const isLast = idx === group.items.length - 1;
                        const checked = !!prefs[item.key];
                        return (
                          <TouchableOpacity
                            key={item.key}
                            style={[styles.prefRow, isLast && styles.noBorder]}
                            onPress={() => togglePref(item.key)}
                            activeOpacity={0.7}
                          >
                            <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                              {checked && (
                                <Ionicons name="checkmark" size={12} color="#faf9f6" />
                              )}
                            </View>
                            <Text style={styles.prefLabel}>{item.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}

                {/* Save row */}
                {error ? (
                  <Text style={styles.errorText}>{error}</Text>
                ) : null}
                <View style={styles.saveRow}>
                  <TouchableOpacity
                    style={[styles.saveBtn, saving && styles.disabled]}
                    onPress={handleSavePrefs}
                    disabled={saving}
                    activeOpacity={0.8}
                  >
                    {saving ? (
                      <ActivityIndicator color="#faf9f6" size="small" />
                    ) : (
                      <Text style={styles.saveBtnText}>Зберегти</Text>
                    )}
                  </TouchableOpacity>
                  {savedFeedback && (
                    <View style={styles.savedBadge}>
                      <Ionicons name="checkmark" size={13} color="#22c55e" />
                      <Text style={styles.savedText}>Збережено</Text>
                    </View>
                  )}
                </View>
              </>
            )}

            <View style={{ height: 32 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
  },
  connectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  connectedText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    color: '#9c9b96',
  },
  headerAction: { width: 80, alignItems: 'flex-end' },
  disconnectText: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    fontSize: 13,
    color: '#ef4444',
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 6,
  },

  // Card
  card: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    overflow: 'hidden',
  },

  // Group label
  groupLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.05,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 2,
  },

  // Not connected state
  notConnectedPad: {
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  notConnectedTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 16,
    color: '#faf9f6',
    marginBottom: 2,
    textAlign: 'center',
  },
  notConnectedText: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    fontSize: 14,
    color: '#78776e',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  connectBtn: {
    backgroundColor: '#3a3935',
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
    marginTop: 4,
    alignSelf: 'stretch',
  },
  connectBtnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 15,
    color: '#faf9f6',
  },

  // Code banner
  codePad: {
    padding: 16,
    gap: 6,
  },
  codeLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
    fontSize: 10,
    color: '#78776e',
    letterSpacing: 0.8,
  },
  code: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 32,
    color: '#faf9f6',
    letterSpacing: 6,
    marginVertical: 4,
  },
  codeInstruction: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    fontSize: 13,
    color: '#78776e',
  },
  botName: { color: '#9c9b96' },
  codeCommand: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 14,
    color: '#9c9b96',
    marginTop: 2,
  },
  codeHint: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    fontSize: 12,
    color: '#78776e',
    marginTop: 4,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  refreshText: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    fontSize: 13,
    color: '#9c9b96',
  },

  // Pref rows
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.06)',
  },
  noBorder: { borderBottomWidth: 0 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: '#3a3935',
    borderColor: 'rgba(250,249,246,0.22)',
  },
  prefLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    fontSize: 14,
    color: '#9c9b96',
    flex: 1,
  },

  // Save
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#3a3935',
    borderRadius: 6,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
  },
  saveBtnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 15,
    color: '#faf9f6',
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  savedText: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    fontSize: 13,
    color: '#22c55e',
  },

  // Shared
  errorText: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    fontSize: 12,
    color: '#ef4444',
    textAlign: 'center',
    marginTop: 2,
  },
  disabled: { opacity: 0.4 },
});
