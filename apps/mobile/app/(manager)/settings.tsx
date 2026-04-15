/**
 * Manager Settings screen.
 *
 * Sections:
 *   1. Account — name, email, role + logout
 *   2. Часовий пояс
 *   3. Режим призначення (manual / recommend / auto)
 *   4. SLA доставки (toggle + minutes)
 *   5. Сповіщення ETA (toggle + delay minutes)
 *   6. Курʼєр не відповідає (threshold minutes)
 *
 * Load:  GET  /api/v1/establishments/me
 * Save:  PATCH /api/v1/establishments/me/settings
 * Logout: POST /api/v1/auth/logout → clearAuth()
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
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiGet, apiPatch, apiPost } from '@/api/client';
import { useAuthStore } from '@/store/auth';

// ── Types ──────────────────────────────────────────────────────────────────────

type DispatchMode = 'manual' | 'recommend' | 'auto';

interface EstablishmentSettings {
  courier_not_responding_min?: number;
  eta_alert_enabled?: boolean;
  eta_alert_delay_minutes?: number;
  show_sla_on_dashboard?: boolean;
  retention_orders_days?: number;
  retention_pings_days?: number;
}

interface EstablishmentData {
  id: string;
  name: string;
  timezone: string;
  dispatch_mode: DispatchMode;
  delivery_sla_minutes: number | null;
  settings: EstablishmentSettings | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

// Must stay in sync with ALLOWED_TIMEZONES in update-settings.dto.ts
const TIMEZONE_OPTIONS = [
  { value: 'Europe/Kyiv',   label: 'Київ',    sub: 'UTC+2/+3' },
  { value: 'Europe/Warsaw', label: 'Варшава', sub: 'UTC+1/+2' },
  { value: 'Europe/Prague', label: 'Прага',   sub: 'UTC+1/+2' },
  { value: 'Europe/Berlin', label: 'Берлін',  sub: 'UTC+1/+2' },
  { value: 'Europe/Riga',   label: 'Рига',    sub: 'UTC+2/+3' },
] as const;

const DISPATCH_OPTIONS: { value: DispatchMode; label: string; hint: string }[] = [
  { value: 'manual',    label: 'Вручну',       hint: 'Менеджер призначає кожне замовлення' },
  { value: 'recommend', label: 'Рекомендація', hint: 'Система пропонує — менеджер підтверджує' },
  { value: 'auto',      label: 'Авто',         hint: 'Замовлення призначаються автоматично' },
];

const NOT_RESPONDING_OPTIONS = [10, 15, 30, 60] as const;
const ETA_ALERT_DELAY_OPTIONS = [5, 10, 15, 30] as const;
const SLA_OPTIONS = [20, 30, 45, 60, 90] as const;

function snapToNearest<T extends number>(options: readonly T[], value: number): T {
  return options.reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev,
  );
}

const ROLE_LABELS: Record<string, string> = {
  owner:      'Власник',
  manager:    'Менеджер',
  dispatcher: 'Диспетчер',
};

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { user, role, clearAuth } = useAuthStore();
  const router = useRouter();

  // Remote data
  const [establishment, setEstablishment] = useState<EstablishmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Local editable state (initialised from establishment on load)
  const [timezone, setTimezone]               = useState('Europe/Kyiv');
  const [dispatchMode, setDispatchMode]       = useState<DispatchMode>('manual');
  const [slaEnabled, setSlaEnabled]           = useState(false);
  const [slaMinutes, setSlaMinutes]           = useState(45);
  const [etaAlertEnabled, setEtaAlertEnabled] = useState(false);
  const [etaAlertDelay, setEtaAlertDelay]     = useState(10);
  const [notRespondingMin, setNotRespondingMin] = useState(15);

  // Save state
  const [saving, setSaving]       = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [loggingOut, setLoggingOut] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const est = await apiGet<EstablishmentData>('/api/v1/establishments/me');
      setEstablishment(est);
      setTimezone(est.timezone ?? 'Europe/Kyiv');
      setDispatchMode(est.dispatch_mode ?? 'manual');
      setSlaEnabled(est.delivery_sla_minutes !== null && est.delivery_sla_minutes !== undefined);
      setSlaMinutes(snapToNearest(SLA_OPTIONS, est.delivery_sla_minutes ?? 45));
      setEtaAlertEnabled(est.settings?.eta_alert_enabled ?? false);
      setEtaAlertDelay(snapToNearest(ETA_ALERT_DELAY_OPTIONS, est.settings?.eta_alert_delay_minutes ?? 10));
      setNotRespondingMin(snapToNearest(NOT_RESPONDING_OPTIONS, est.settings?.courier_not_responding_min ?? 15));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    setSavedFeedback(false);
    try {
      await apiPatch('/api/v1/establishments/me/settings', {
        timezone,
        dispatch_mode: dispatchMode,
        delivery_sla_minutes: slaEnabled ? slaMinutes : null,
        eta_alert_enabled: etaAlertEnabled,
        eta_alert_delay_minutes: etaAlertDelay,
        courier_not_responding_min: notRespondingMin,
      });
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  }

  // ── Logout ──────────────────────────────────────────────────────────────────

  function confirmLogout() {
    Alert.alert(
      'Вийти з акаунту?',
      'Вам потрібно буде знову увійти для доступу до дашборду.',
      [
        { text: 'Відміна', style: 'cancel' },
        {
          text: 'Вийти',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              await apiPost('/api/v1/auth/logout');
            } catch {
              // Fire-and-forget: clear local auth regardless
            }
            try {
              await clearAuth();
            } finally {
              setLoggingOut(false);
            }
          },
        },
      ],
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color="#9c9b96" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Налаштування</Text>
          <View style={{ width: 30 }} />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#78776e" />
          </View>
        ) : loadError ? (
          <View style={styles.centered}>
            <Ionicons name="warning-outline" size={32} color="#ef4444" />
            <Text style={styles.errorMsg}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
              <Text style={styles.retryText}>Повторити</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Account ──────────────────────────────────────────────────── */}
            <SectionLabel>АКАУНТ</SectionLabel>
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>ІМʼЯ</Text>
                <Text style={styles.infoValue}>{user?.name ?? '—'}</Text>
              </View>
              {establishment && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>ЗАКЛАД</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>{establishment.name}</Text>
                </View>
              )}
              <View style={[styles.infoRow, styles.noBorder]}>
                <Text style={styles.infoLabel}>РОЛЬ</Text>
                <Text style={styles.infoValue}>{role ? (ROLE_LABELS[role] ?? role) : '—'}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.logoutRow}
              onPress={confirmLogout}
              disabled={loggingOut}
              activeOpacity={0.7}
            >
              {loggingOut ? (
                <ActivityIndicator color="#ef4444" size="small" />
              ) : (
                <>
                  <Ionicons name="log-out-outline" size={18} color="#ef4444" />
                  <Text style={styles.logoutText}>Вийти з акаунту</Text>
                </>
              )}
            </TouchableOpacity>

            {/* ── Timezone ─────────────────────────────────────────────────── */}
            <SectionLabel>ЧАСОВИЙ ПОЯС</SectionLabel>
            <View style={styles.card}>
              <Text style={styles.fieldHint}>
                Використовується для відображення часу в Telegram-сповіщеннях
              </Text>
              <View style={styles.chipGroup}>
                {TIMEZONE_OPTIONS.map((tz) => {
                  const active = timezone === tz.value;
                  return (
                    <TouchableOpacity
                      key={tz.value}
                      style={[styles.tzChip, active && styles.chipActive]}
                      onPress={() => setTimezone(tz.value)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.tzChipMain, active && styles.chipTextActive]}>
                        {tz.label}
                      </Text>
                      <Text style={[styles.tzChipSub, active && styles.chipSubActive]}>
                        {tz.sub}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* ── Dispatch mode ────────────────────────────────────────────── */}
            <SectionLabel>РЕЖИМ ПРИЗНАЧЕННЯ</SectionLabel>
            <View style={styles.card}>
              {DISPATCH_OPTIONS.map((opt, i) => {
                const active = dispatchMode === opt.value;
                const last = i === DISPATCH_OPTIONS.length - 1;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.dispatchRow, last && styles.noBorderBottom]}
                    onPress={() => setDispatchMode(opt.value)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active && <View style={styles.radioDot} />}
                    </View>
                    <View style={styles.dispatchInfo}>
                      <Text style={[styles.dispatchLabel, active && styles.dispatchLabelActive]}>
                        {opt.label}
                      </Text>
                      <Text style={styles.dispatchHint}>{opt.hint}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── SLA ──────────────────────────────────────────────────────── */}
            <SectionLabel>SLA ДОСТАВКИ</SectionLabel>
            <View style={styles.card}>
              <View style={[styles.toggleRow, slaEnabled && styles.noBorderBottom]}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.toggleLabel}>SLA доставки</Text>
                  <Text style={styles.toggleHint}>Стандарт часу доставки для клієнтів</Text>
                </View>
                <Toggle value={slaEnabled} onChange={setSlaEnabled} />
              </View>
              {slaEnabled && (
                <View style={[styles.chipRowPad, styles.noBorderBottom]}>
                  <Text style={styles.chipRowLabel}>ХВИЛИН</Text>
                  <View style={styles.chipRow}>
                    {SLA_OPTIONS.map((opt) => (
                      <ChipBtn
                        key={opt}
                        label={`${opt}`}
                        active={slaMinutes === opt}
                        onPress={() => setSlaMinutes(opt)}
                      />
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* ── ETA Alert ────────────────────────────────────────────────── */}
            <SectionLabel>СПОВІЩЕННЯ ETA</SectionLabel>
            <View style={styles.card}>
              <View style={[styles.toggleRow, etaAlertEnabled && styles.noBorderBottom]}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.toggleLabel}>Сповіщати про запізнення</Text>
                  <Text style={styles.toggleHint}>Telegram-повідомлення при перевищенні ETA</Text>
                </View>
                <Toggle value={etaAlertEnabled} onChange={setEtaAlertEnabled} />
              </View>
              {etaAlertEnabled && (
                <View style={[styles.chipRowPad, styles.noBorderBottom]}>
                  <Text style={styles.chipRowLabel}>ЧЕРЕЗ ХВ ПІСЛЯ ВИХОДУ ETA</Text>
                  <View style={styles.chipRow}>
                    {ETA_ALERT_DELAY_OPTIONS.map((opt) => (
                      <ChipBtn
                        key={opt}
                        label={`${opt}`}
                        active={etaAlertDelay === opt}
                        onPress={() => setEtaAlertDelay(opt)}
                      />
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* ── Courier not responding ───────────────────────────────────── */}
            <SectionLabel>КУРʼЄР НЕ ВІДПОВІДАЄ</SectionLabel>
            <View style={styles.card}>
              <View style={styles.fieldHintRow}>
                <Text style={styles.fieldHint}>
                  Поріг відсутності GPS-пінгу під час активної доставки
                </Text>
              </View>
              <View style={[styles.chipRowPad, styles.noBorderBottom]}>
                <Text style={styles.chipRowLabel}>ХВИЛИН БЕЗ ПІНГУ</Text>
                <View style={styles.chipRow}>
                  {NOT_RESPONDING_OPTIONS.map((opt) => (
                    <ChipBtn
                      key={opt}
                      label={`${opt}`}
                      active={notRespondingMin === opt}
                      onPress={() => setNotRespondingMin(opt)}
                    />
                  ))}
                </View>
              </View>
            </View>

            {/* ── Save button ──────────────────────────────────────────────── */}
            <View style={styles.saveWrap}>
              {saveError ? (
                <Text style={styles.saveError}>{saveError}</Text>
              ) : null}
              <View style={styles.saveRow}>
                <TouchableOpacity
                  style={[styles.saveBtn, saving && styles.disabled]}
                  onPress={handleSave}
                  disabled={saving}
                  activeOpacity={0.8}
                >
                  {saving ? (
                    <ActivityIndicator color="#faf9f6" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>Зберегти зміни</Text>
                  )}
                </TouchableOpacity>
                {savedFeedback && (
                  <View style={styles.savedBadge}>
                    <Ionicons name="checkmark" size={13} color="#22c55e" />
                    <Text style={styles.savedText}>Збережено</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={{ height: 32 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <TouchableOpacity
      onPress={() => onChange(!value)}
      activeOpacity={0.8}
      style={[styles.toggle, value && styles.toggleOn]}
    >
      <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
    </TouchableOpacity>
  );
}

function ChipBtn({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0c0b09',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Manrope_600SemiBold',
    color: '#faf9f6',
  },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorMsg: {
    fontSize: 14,
    color: '#9c9b96',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    textAlign: 'center',
    paddingHorizontal: 32,
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
    fontSize: 14,
    color: '#faf9f6',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 6,
  },

  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.05,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 2,
  },

  // Card
  card: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    overflow: 'hidden',
  },

  // Info rows (account section)
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  noBorder: {
    borderBottomWidth: 0,
  },
  noBorderBottom: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    fontWeight: '600',
    fontSize: 11,
    color: '#78776e',
    letterSpacing: 0.6,
  },
  infoValue: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    fontSize: 14,
    color: '#9c9b96',
    maxWidth: '60%',
    textAlign: 'right',
  },

  // Logout row
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.15)',
  },
  logoutText: {
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    fontSize: 14,
    color: '#ef4444',
  },

  // Timezone chips
  fieldHint: {
    fontSize: 12,
    color: '#78776e',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    lineHeight: 16,
  },
  fieldHintRow: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: 12,
  },
  tzChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    gap: 1,
  },
  tzChipMain: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    color: '#78776e',
  },
  tzChipSub: {
    fontSize: 10,
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#4a4945',
  },

  // Dispatch options
  dispatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioActive: {
    borderColor: 'rgba(250,249,246,0.5)',
    backgroundColor: '#3a3935',
  },
  radioDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#faf9f6',
  },
  dispatchInfo: {
    flex: 1,
    gap: 2,
  },
  dispatchLabel: {
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    color: '#78776e',
  },
  dispatchLabelActive: {
    color: '#faf9f6',
  },
  dispatchHint: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    color: '#4a4945',
    lineHeight: 16,
  },

  // Toggle row
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
    gap: 12,
  },
  toggleInfo: {
    flex: 1,
    gap: 2,
  },
  toggleLabel: {
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_500Medium' : undefined,
    color: '#faf9f6',
  },
  toggleHint: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    color: '#78776e',
    lineHeight: 16,
  },
  toggle: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#3a3935',
    justifyContent: 'center',
    paddingHorizontal: 2,
    flexShrink: 0,
  },
  toggleOn: {
    backgroundColor: '#4a4945',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.2)',
  },
  toggleThumb: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    backgroundColor: '#78776e',
  },
  toggleThumbOn: {
    transform: [{ translateX: 16 }],
    backgroundColor: '#faf9f6',
  },

  // Chip row (minutes picker)
  chipRowPad: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  chipRowLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: '#4a4945',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_600SemiBold' : undefined,
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    backgroundColor: 'transparent',
  },
  chipActive: {
    backgroundColor: '#3a3935',
    borderColor: 'rgba(250,249,246,0.22)',
  },
  chipText: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 13,
    color: '#78776e',
  },
  chipTextActive: {
    color: '#faf9f6',
  },
  chipSubActive: {
    color: '#9c9b96',
  },

  // Save
  saveWrap: {
    marginTop: 8,
    gap: 8,
  },
  saveError: {
    fontSize: 12,
    color: '#ef4444',
    fontFamily: Platform.OS === 'ios' ? 'Manrope_400Regular' : undefined,
    textAlign: 'center',
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  disabled: {
    opacity: 0.4,
  },
});
