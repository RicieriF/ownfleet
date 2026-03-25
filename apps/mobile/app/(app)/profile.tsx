/**
 * Profile screen — courier info + Telegram notification settings.
 *
 * Telegram flow:
 *   Not connected → [Підключити] → POST /telegram/connect → show XXXX-XX code
 *   Connected     → prefs checkboxes → [Зберегти] → PATCH /telegram/prefs
 *                   [Відключити]      → DELETE /telegram/connect
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/api/client';

// ── Types ───────────────────────────────────────────────────────────────────

interface CourierTelegramPrefs {
  delivery_assigned?: boolean;
  manager_reminder?: boolean;
  shift_ending_soon?: boolean;
  shift_ending_soon_min?: number;
}

interface TelegramStatus {
  connected: boolean;
  prefs: CourierTelegramPrefs;
}

interface ConnectResponse {
  code: string;
  expires_in: number;
}

// ── Pref labels ──────────────────────────────────────────────────────────────

type BooleanPrefKey = Exclude<keyof CourierTelegramPrefs, 'shift_ending_soon_min'>;

const PREF_LABELS: { key: BooleanPrefKey; label: string }[] = [
  { key: 'delivery_assigned',  label: 'Нова доставка призначена' },
  { key: 'manager_reminder',   label: 'Нагадування від менеджера' },
  { key: 'shift_ending_soon',  label: 'Нагадування про закінчення зміни' },
];

const THRESHOLD_OPTIONS = [10, 15, 30, 60] as const;

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { user } = useAuthStore();

  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [prefs, setPrefs] = useState<CourierTelegramPrefs>({});
  const [connectCode, setConnectCode] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [error, setError] = useState('');

  // ── Load status on mount ──────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    try {
      const s = await apiGet<TelegramStatus>('/api/v1/telegram/status');
      setStatus(s);
      setPrefs({ shift_ending_soon_min: 30, ...(s.prefs ?? {}) });
    } catch {
      setStatus({ connected: false, prefs: {} });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // ── Actions ───────────────────────────────────────────────────────────────

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

  async function handleDisconnect() {
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
            try {
              await apiDelete('/api/v1/telegram/connect');
              setStatus({ connected: false, prefs: {} });
              setPrefs({});
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

  async function handleSavePrefs() {
    setError('');
    setSavedFeedback(false);
    setActionLoading(true);
    try {
      await apiPatch('/api/v1/telegram/prefs', prefs);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 3000);
    } catch {
      setError('Не вдалось зберегти налаштування.');
    } finally {
      setActionLoading(false);
    }
  }

  function togglePref(key: BooleanPrefKey) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    setSavedFeedback(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Профіль',
          headerStyle: { backgroundColor: '#09090b' },
          headerTintColor: '#fafafa',
          headerTitleStyle: { fontFamily: 'Manrope_600SemiBold', fontSize: 17 },
        }}
      />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* ── Courier info ────────────────────────────────────────────── */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Обліковий запис</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>ІМ'Я</Text>
              <Text style={styles.infoValue}>{user?.name ?? '—'}</Text>
            </View>
            <View style={[styles.infoRow, styles.noBorder]}>
              <Text style={styles.infoLabel}>ТЕЛЕФОН</Text>
              <Text style={styles.infoValue}>{user?.phone ?? '—'}</Text>
            </View>
          </View>

          {/* ── Telegram section ────────────────────────────────────────── */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>Telegram сповіщення</Text>
                {status?.connected && (
                  <Text style={styles.connectedBadge}>● Підключено</Text>
                )}
              </View>
              {status?.connected && (
                <TouchableOpacity
                  onPress={handleDisconnect}
                  disabled={actionLoading}
                  hitSlop={8}
                >
                  <Text style={[styles.disconnectText, actionLoading && styles.disabled]}>
                    Відключити
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {loadingStatus ? (
              <ActivityIndicator color="#6aaa84" style={{ marginVertical: 20 }} />
            ) : (
              <>
                {/* Not connected — connect button */}
                {!status?.connected && !connectCode && (
                  <View style={styles.notConnected}>
                    <Text style={styles.notConnectedText}>
                      Отримуйте сповіщення про доставки прямо в Telegram.
                    </Text>
                    <TouchableOpacity
                      style={[styles.connectBtn, actionLoading && styles.disabled]}
                      onPress={handleConnect}
                      disabled={actionLoading}
                      activeOpacity={0.8}
                    >
                      {actionLoading ? (
                        <ActivityIndicator color="#09090b" size="small" />
                      ) : (
                        <Text style={styles.connectBtnText}>Підключити Telegram</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* Connect code banner */}
                {!status?.connected && connectCode && (
                  <View style={styles.codeBanner}>
                    <Text style={styles.codeLabel}>КОД ДЛЯ ПІДКЛЮЧЕННЯ · ДІЄ 10 ХВ</Text>
                    <Text style={styles.code}>{connectCode}</Text>
                    <Text style={styles.codeInstruction}>
                      Відкрийте{' '}
                      <Text style={styles.botName}>@weego_notify_bot</Text>
                      {' '}і надішліть:
                    </Text>
                    <Text style={styles.codeCommand}>/start {connectCode}</Text>
                    <Text style={styles.codeHint}>
                      Після підключення поверніться та оновіть сторінку.
                    </Text>
                    <TouchableOpacity
                      style={styles.refreshBtn}
                      onPress={() => { setConnectCode(null); loadStatus(); }}
                    >
                      <Ionicons name="refresh-outline" size={14} color="#6aaa84" />
                      <Text style={styles.refreshText}>Перевірити статус</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Connected — prefs */}
                {status?.connected && (
                  <View style={styles.prefsContainer}>
                    {PREF_LABELS.map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        style={styles.prefRow}
                        onPress={() => togglePref(key)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.checkbox, prefs[key] && styles.checkboxChecked]}>
                          {prefs[key] && (
                            <Ionicons name="checkmark" size={12} color="#09090b" />
                          )}
                        </View>
                        <Text style={styles.prefLabel}>{label}</Text>
                      </TouchableOpacity>
                    ))}

                    {prefs.shift_ending_soon && (
                      <View style={styles.thresholdContainer}>
                        <Text style={styles.thresholdLabel}>ПОПЕРЕДИТИ ЗА</Text>
                        <View style={styles.thresholdRow}>
                          {THRESHOLD_OPTIONS.map((min) => {
                            const selected = (prefs.shift_ending_soon_min ?? 30) === min;
                            return (
                              <TouchableOpacity
                                key={min}
                                style={selected ? [styles.chip, styles.chipSelected] : styles.chip}
                                onPress={() => setPrefs((prev) => ({ ...prev, shift_ending_soon_min: min }))}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                                  {min} хв
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    )}

                    {error ? (
                      <Text style={styles.errorText}>{error}</Text>
                    ) : null}

                    <View style={styles.saveRow}>
                      <TouchableOpacity
                        style={[styles.saveBtn, actionLoading && styles.disabled]}
                        onPress={handleSavePrefs}
                        disabled={actionLoading}
                        activeOpacity={0.8}
                      >
                        {actionLoading ? (
                          <ActivityIndicator color="#09090b" size="small" />
                        ) : (
                          <Text style={styles.saveBtnText}>Зберегти</Text>
                        )}
                      </TouchableOpacity>
                      {savedFeedback && (
                        <Text style={styles.savedText}>Збережено</Text>
                      )}
                    </View>
                  </View>
                )}

                {/* Error outside prefs (connect/disconnect errors) */}
                {!status?.connected && error ? (
                  <Text style={[styles.errorText, { marginHorizontal: 16, marginBottom: 12 }]}>
                    {error}
                  </Text>
                ) : null}
              </>
            )}
          </View>

        </ScrollView>
      </SafeAreaView>
    </>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  scroll: {
    padding: 16,
    gap: 12,
  },

  // Card
  card: {
    backgroundColor: '#18181b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  cardTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 14,
    color: '#fafafa',
  },
  connectedBadge: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: '#6aaa84',
    marginTop: 2,
  },

  // Info rows (account section)
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  noBorder: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: '#71717a',
    letterSpacing: 0.6,
  },
  infoValue: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: '#a1a1aa',
  },

  // Not connected
  notConnected: {
    padding: 16,
    gap: 14,
  },
  notConnectedText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: '#71717a',
    lineHeight: 20,
  },
  connectBtn: {
    backgroundColor: '#6aaa84',
    borderRadius: 6,
    paddingVertical: 11,
    alignItems: 'center',
  },
  connectBtnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 14,
    color: '#09090b',
  },

  // Code banner
  codeBanner: {
    margin: 16,
    padding: 14,
    backgroundColor: 'rgba(106,170,132,0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(106,170,132,0.25)',
    gap: 6,
  },
  codeLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 10,
    color: '#6aaa84',
    letterSpacing: 0.8,
  },
  code: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 32,
    color: '#fafafa',
    letterSpacing: 6,
    marginVertical: 4,
  },
  codeInstruction: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: '#71717a',
  },
  botName: {
    color: '#a1a1aa',
  },
  codeCommand: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 14,
    color: '#a1a1aa',
    marginTop: 2,
  },
  codeHint: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: '#52525b',
    marginTop: 4,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  refreshText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: '#6aaa84',
  },

  // Prefs
  prefsContainer: {
    padding: 16,
    gap: 2,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#6aaa84',
    borderColor: '#6aaa84',
  },
  prefLabel: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: '#a1a1aa',
    flex: 1,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  saveBtn: {
    backgroundColor: '#6aaa84',
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  saveBtnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 14,
    color: '#09090b',
  },
  savedText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: '#6aaa84',
  },

  // Disconnect
  disconnectText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: '#f87171',
  },

  // Threshold chip picker
  thresholdContainer: {
    marginTop: 12,
    marginBottom: 4,
  },
  thresholdLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: '#71717a',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  thresholdRow: {
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: '#6aaa84',
    borderColor: '#6aaa84',
  },
  chipText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: '#71717a',
  },
  chipTextSelected: {
    color: '#09090b',
  },

  // Shared
  errorText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: '#f87171',
    marginTop: 4,
  },
  disabled: {
    opacity: 0.4,
  },
});
