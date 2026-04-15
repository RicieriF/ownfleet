/**
 * Manager Couriers screen.
 *
 * Shows all couriers for the establishment.
 * Actions:
 *   - Add new courier    POST /api/v1/couriers
 *   - Toggle active      PATCH /api/v1/couriers/:id
 *   - Edit name/phone    PATCH /api/v1/couriers/:id
 *   - Generate invite    POST /api/v1/onboarding/invites → OS share sheet
 *   - Revoke invite      DELETE /api/v1/onboarding/invites/:id
 *
 * Invite flow: manager creates courier → "Створити запрошення" → token generated →
 *   OS share sheet → courier opens weego-courier:///onboarding/TOKEN
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Share,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/api/client';
import type { ManagerCourier, TransportMode, InviteItem } from '@/types';

// ── Constants ─────────────────────────────────────────────────────────────────

const TRANSPORT_ICON: Record<TransportMode, string> = {
  car: '🚗',
  moto_gas: '🏍️',
  moto_electric: '⚡',
  bicycle: '🚲',
  walking: '🚶',
};

const ONLINE_COLOR: Record<string, string> = {
  online: '#22c55e',
  background: '#f59e0b',
  not_responding: '#ef4444',
  offline: '#78776e',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function formatExpiry(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Прострочений';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `Діє ще ${h} год ${m} хв`;
  return `Діє ще ${m} хв`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CourierRow({
  courier,
  onPress,
}: {
  courier: ManagerCourier;
  onPress: () => void;
}) {
  const statusColor = ONLINE_COLOR[courier.status] ?? '#78776e';
  const transportIcon = courier.transport_mode ? TRANSPORT_ICON[courier.transport_mode] : null;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <View style={[styles.avatar, !courier.active && styles.avatarInactive]}>
          <Text style={[styles.avatarText, !courier.active && styles.avatarTextInactive]}>
            {initials(courier.name)}
          </Text>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: courier.active ? statusColor : '#3a3935' },
            ]}
          />
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowNameRow}>
            <Text
              style={[styles.rowName, !courier.active && styles.rowNameInactive]}
              numberOfLines={1}
            >
              {courier.name}
            </Text>
            {!courier.active && (
              <View style={styles.inactiveBadge}>
                <Text style={styles.inactiveBadgeText}>Неактивний</Text>
              </View>
            )}
          </View>
          <Text style={styles.rowPhone}>{courier.phone}</Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        {transportIcon ? <Text style={styles.transportIcon}>{transportIcon}</Text> : null}
        <Ionicons name="chevron-forward" size={16} color="#3a3935" />
      </View>
    </TouchableOpacity>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────

interface AddEditModalProps {
  visible: boolean;
  title: string;
  initialName: string;
  initialPhone: string;
  onClose: () => void;
  onSave: (name: string, phone: string) => Promise<void>;
}

function AddEditModal({
  visible,
  title,
  initialName,
  initialPhone,
  onClose,
  onSave,
}: AddEditModalProps) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setPhone(initialPhone);
      setError('');
    }
  }, [visible, initialName, initialPhone]);

  async function handleSave() {
    const n = name.trim();
    const p = phone.trim();
    if (!n) { setError("Введіть ім'я"); return; }
    if (!p) { setError('Введіть номер телефону'); return; }
    setError('');
    setSaving(true);
    try {
      await onSave(n, p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{title}</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>ІМ'Я ТА ПРІЗВИЩЕ</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(v) => { setName(v); setError(''); }}
              placeholder="Іван Петренко"
              placeholderTextColor="#3a3935"
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>ТЕЛЕФОН</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={(v) => { setPhone(v); setError(''); }}
              placeholder="+380501234567"
              placeholderTextColor="#3a3935"
              keyboardType="phone-pad"
              autoCorrect={false}
            />
          </View>

          {error ? <Text style={styles.formError}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryBtn, saving && styles.btnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#faf9f6" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>Зберегти</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.cancelBtnText}>Скасувати</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Courier detail modal ──────────────────────────────────────────────────────

interface DetailModalProps {
  courier: ManagerCourier | null;
  invites: InviteItem[];
  onClose: () => void;
  onEditPress: () => void;
  onToggleActive: () => Promise<void>;
  onGenerateInvite: () => Promise<void>;
  onRevokeInvite: (id: string) => void;
  onShare: (token: string, courierName: string) => void;
}

function DetailModal({
  courier,
  invites,
  onClose,
  onEditPress,
  onToggleActive,
  onGenerateInvite,
  onRevokeInvite,
  onShare,
}: DetailModalProps) {
  const [toggling, setToggling] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);

  if (!courier) return null;

  const statusColor = ONLINE_COLOR[courier.status] ?? '#78776e';
  const transportIcon = courier.transport_mode ? TRANSPORT_ICON[courier.transport_mode] : null;
  const courierInvites = invites.filter(
    (inv) => inv.courier_id === courier.id && !inv.used_at,
  );
  const hasActiveInvite = courierInvites.some((inv) => !isExpired(inv.expires_at));

  async function handleToggle() {
    setToggling(true);
    try {
      await onToggleActive();
    } catch {
      Alert.alert('Помилка', 'Не вдалось змінити статус. Спробуйте ще раз.');
    } finally {
      setToggling(false);
    }
  }

  async function handleGenerateInvite() {
    setGeneratingInvite(true);
    try {
      await onGenerateInvite();
    } catch {
      Alert.alert('Помилка', 'Не вдалось створити запрошення. Спробуйте ще раз.');
    } finally {
      setGeneratingInvite(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, styles.sheetTall]}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.detailHeader}>
            <View style={[styles.avatarLg, !courier.active && styles.avatarInactive]}>
              <Text style={[styles.avatarLgText, !courier.active && styles.avatarTextInactive]}>
                {initials(courier.name)}
              </Text>
              <View
                style={[
                  styles.statusDotLg,
                  { backgroundColor: courier.active ? statusColor : '#3a3935' },
                ]}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.detailName} numberOfLines={1}>{courier.name}</Text>
              <Text style={styles.detailPhone}>{courier.phone}</Text>
            </View>
            <TouchableOpacity onPress={onEditPress} hitSlop={10} activeOpacity={0.7}>
              <Ionicons name="pencil-outline" size={18} color="#78776e" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Info card */}
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>ТРАНСПОРТ</Text>
                <Text style={styles.infoValue}>
                  {transportIcon ? `${transportIcon} ` : ''}
                  {courier.transport_mode ?? '—'}
                </Text>
              </View>
              <View style={[styles.infoRow, styles.noBorder]}>
                <Text style={styles.infoLabel}>ЗМІНА</Text>
                <Text style={styles.infoValue}>
                  {courier.active_shift ? 'На зміні' : 'Не на зміні'}
                </Text>
              </View>
            </View>

            {/* Toggle active */}
            <TouchableOpacity
              style={[styles.actionRow, toggling && styles.btnDisabled]}
              onPress={handleToggle}
              disabled={toggling}
              activeOpacity={0.7}
            >
              <View style={styles.actionRowLeft}>
                <Ionicons
                  name={courier.active ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color="#9c9b96"
                />
                <Text style={styles.actionRowLabel}>
                  {courier.active ? 'Деактивувати курʼєра' : 'Активувати курʼєра'}
                </Text>
              </View>
              {toggling ? (
                <ActivityIndicator size="small" color="#78776e" />
              ) : (
                <Ionicons name="chevron-forward" size={14} color="#3a3935" />
              )}
            </TouchableOpacity>

            {/* Invite section */}
            <View style={styles.inviteSection}>
              <Text style={styles.inviteSectionLabel}>ЗАПРОШЕННЯ В ДОДАТОК</Text>

              {courierInvites.map((inv) => {
                const expired = isExpired(inv.expires_at);
                return (
                  <View
                    key={inv.id}
                    style={[styles.inviteItem, expired && styles.inviteItemFaded]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.inviteToken,
                          expired && { color: '#78776e' },
                        ]}
                      >
                        {inv.token.slice(0, 12)}…
                      </Text>
                      <Text style={styles.inviteExpiry}>{formatExpiry(inv.expires_at)}</Text>
                    </View>
                    <View style={styles.inviteActions}>
                      {!expired && (
                        <TouchableOpacity
                          onPress={() => onShare(inv.token, courier.name)}
                          hitSlop={8}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="share-outline" size={18} color="#9c9b96" />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => onRevokeInvite(inv.id)}
                        hitSlop={8}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="trash-outline" size={16} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              {!hasActiveInvite && (
                <TouchableOpacity
                  style={[styles.primaryBtn, generatingInvite && styles.btnDisabled]}
                  onPress={handleGenerateInvite}
                  disabled={generatingInvite}
                  activeOpacity={0.8}
                >
                  {generatingInvite ? (
                    <ActivityIndicator color="#faf9f6" size="small" />
                  ) : (
                    <>
                      <Ionicons
                        name="link-outline"
                        size={16}
                        color="#faf9f6"
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.primaryBtnText}>Створити запрошення</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              <Text style={styles.inviteHint}>
                Запрошення діє 48 годин. Поділіться токеном з курʼєром — він введе його в
                додатку при першому вході.
              </Text>
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.cancelBtnText}>Закрити</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function CouriersScreen() {
  const [couriers, setCouriers] = useState<ManagerCourier[]>([]);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [selectedCourier, setSelectedCourier] = useState<ManagerCourier | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError('');
    try {
      const [couriersData, invitesData] = await Promise.all([
        apiGet<ManagerCourier[]>('/api/v1/couriers'),
        apiGet<InviteItem[]>('/api/v1/onboarding/invites'),
      ]);
      setCouriers(couriersData);
      setInvites(invitesData);
    } catch {
      setError('Не вдалось завантажити. Спробуйте ще раз.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleAdd(name: string, phone: string) {
    const created = await apiPost<ManagerCourier>('/api/v1/couriers', { name, phone });
    setCouriers((prev) => [created, ...prev]);
    setShowAdd(false);
    setSelectedCourier(created); // auto-open detail to generate invite
  }

  async function handleEdit(name: string, phone: string) {
    if (!selectedCourier) return;
    const updated = await apiPatch<ManagerCourier>(`/api/v1/couriers/${selectedCourier.id}`, {
      name,
      phone,
    });
    setCouriers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setSelectedCourier(updated);
    setShowEdit(false);
  }

  async function handleToggleActive() {
    if (!selectedCourier) return;
    const updated = await apiPatch<ManagerCourier>(`/api/v1/couriers/${selectedCourier.id}`, {
      active: !selectedCourier.active,
    });
    setCouriers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setSelectedCourier(updated);
  }

  async function handleGenerateInvite() {
    if (!selectedCourier) return;
    const inv = await apiPost<InviteItem>('/api/v1/onboarding/invites', {
      courier_id: selectedCourier.id,
    });
    setInvites((prev) => [inv, ...prev]);
    handleShare(inv.token, selectedCourier.name);
  }

  function handleRevokeInvite(id: string) {
    Alert.alert('Відкликати запрошення?', 'Курʼєр не зможе використати цей токен.', [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Відкликати',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiDelete(`/api/v1/onboarding/invites/${id}`);
            setInvites((prev) => prev.filter((inv) => inv.id !== id));
          } catch {
            Alert.alert('Помилка', 'Не вдалось відкликати запрошення. Спробуйте ще раз.');
          }
        },
      },
    ]);
  }

  function handleShare(token: string, courierName: string) {
    const deepLink = `weego-courier:///onboarding/${token}`;
    Share.share({
      message: `Запрошення в Weego Courier для ${courierName}.\n\nТокен: ${token}\n\n${deepLink}`,
      title: `Запрошення для ${courierName}`,
    }).catch(() => {
      // user dismissed share sheet — not an error
    });
  }

  // ── List sections ─────────────────────────────────────────────────────────

  const activeCouriers = couriers.filter((c) => c.active);
  const inactiveCouriers = couriers.filter((c) => !c.active);

  type ListItem =
    | { type: 'sectionHeader'; id: string; label: string; count: number }
    | { type: 'courier'; id: string; courier: ManagerCourier };

  const listData: ListItem[] = [];

  listData.push({ type: 'sectionHeader', id: 'h-active', label: 'АКТИВНІ', count: activeCouriers.length });
  for (const c of activeCouriers) {
    listData.push({ type: 'courier', id: c.id, courier: c });
  }
  if (inactiveCouriers.length > 0) {
    listData.push({ type: 'sectionHeader', id: 'h-inactive', label: 'НЕАКТИВНІ', count: inactiveCouriers.length });
    for (const c of inactiveCouriers) {
      listData.push({ type: 'courier', id: c.id, courier: c });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Курʼєри</Text>
          <View style={styles.headerRight}>
            {couriers.length > 0 && (
              <Text style={styles.headerCount}>{couriers.length}</Text>
            )}
            <TouchableOpacity
              onPress={() => setShowAdd(true)}
              hitSlop={8}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={26} color="#faf9f6" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        {loading ? (
          <ActivityIndicator color="#9c9b96" style={{ marginTop: 60 }} />
        ) : error ? (
          <View style={styles.centerWrap}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => load()}
              activeOpacity={0.7}
            >
              <Text style={styles.retryText}>Повторити</Text>
            </TouchableOpacity>
          </View>
        ) : couriers.length === 0 ? (
          <View style={styles.centerWrap}>
            <Ionicons name="people-outline" size={48} color="#3a3935" style={{ marginBottom: 16 }} />
            <Text style={styles.emptyTitle}>Немає курʼєрів</Text>
            <Text style={styles.emptySub}>Додайте першого курʼєра за допомогою кнопки «+»</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 24 }]}
              onPress={() => setShowAdd(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={16} color="#faf9f6" style={{ marginRight: 6 }} />
              <Text style={styles.primaryBtnText}>Додати курʼєра</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList<ListItem>
            data={listData}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(true); }}
                tintColor="#9c9b96"
              />
            }
            renderItem={({ item, index }) => {
              if (item.type === 'sectionHeader') {
                return (
                  <Text style={[styles.sectionLabel, index > 0 && { marginTop: 20 }]}>
                    {item.label} · {item.count}
                  </Text>
                );
              }

              // Detect card grouping for rounded corners
              const prev = listData[index - 1];
              const next = listData[index + 1];
              const isFirst = prev?.type !== 'courier';
              const isLast = next?.type !== 'courier';

              return (
                <View
                  style={[
                    styles.rowWrapper,
                    isFirst && styles.rowWrapperTop,
                    isLast && styles.rowWrapperBottom,
                    !isLast && styles.rowWrapperDivider,
                  ]}
                >
                  <CourierRow
                    courier={item.courier}
                    onPress={() => setSelectedCourier(item.courier)}
                  />
                </View>
              );
            }}
          />
        )}
      </SafeAreaView>

      {/* Add courier */}
      <AddEditModal
        visible={showAdd}
        title="Новий курʼєр"
        initialName=""
        initialPhone=""
        onClose={() => setShowAdd(false)}
        onSave={handleAdd}
      />

      {/* Edit courier */}
      <AddEditModal
        visible={showEdit}
        title="Редагувати курʼєра"
        initialName={selectedCourier?.name ?? ''}
        initialPhone={selectedCourier?.phone ?? ''}
        onClose={() => setShowEdit(false)}
        onSave={handleEdit}
      />

      {/* Courier detail */}
      {selectedCourier && (
        <DetailModal
          courier={selectedCourier}
          invites={invites}
          onClose={() => setSelectedCourier(null)}
          onEditPress={() => setShowEdit(true)}
          onToggleActive={handleToggleActive}
          onGenerateInvite={handleGenerateInvite}
          onRevokeInvite={handleRevokeInvite}
          onShare={handleShare}
        />
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  headerTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 22,
    color: '#faf9f6',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerCount: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 14,
    color: '#78776e',
  },

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
    lineHeight: 20,
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
  retryText: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: '#9c9b96' },

  // List
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  sectionLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: '#78776e',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 8,
  },

  // Row wrapper (card grouping)
  rowWrapper: {
    backgroundColor: '#1a1917',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
  },
  rowWrapperTop: {
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderTopWidth: 1,
  },
  rowWrapperBottom: {
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderBottomWidth: 1,
  },
  rowWrapperDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.06)',
  },

  // Courier row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 12 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#3a3935',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarInactive: { backgroundColor: '#252420' },
  avatarText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 14,
    color: '#faf9f6',
    lineHeight: 18,
  },
  avatarTextInactive: { color: '#78776e' },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 1.5,
    borderColor: '#1a1917',
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowName: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: '#faf9f6',
    flexShrink: 1,
  },
  rowNameInactive: { color: '#78776e' },
  inactiveBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(120,119,110,0.25)',
    backgroundColor: 'rgba(120,119,110,0.08)',
    flexShrink: 0,
  },
  inactiveBadgeText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 10,
    color: '#78776e',
  },
  rowPhone: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 12,
    color: '#78776e',
    marginTop: 2,
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8, flexShrink: 0 },
  transportIcon: { fontSize: 16 },

  // Modal overlay + sheet
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#1a1917',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  sheetTall: { maxHeight: '88%' },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(250,249,246,0.16)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 17,
    color: '#faf9f6',
    marginBottom: 20,
  },

  // Form fields
  fieldGroup: { marginBottom: 14 },
  fieldLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: '#78776e',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#252420',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.10)',
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: 'Manrope_400Regular',
    fontSize: 15,
    color: '#faf9f6',
  },
  formError: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: '#ef4444',
    marginBottom: 10,
  },

  // Detail header
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  avatarLg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#3a3935',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarLgText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 18,
    color: '#faf9f6',
  },
  statusDotLg: {
    width: 11,
    height: 11,
    borderRadius: 6,
    position: 'absolute',
    bottom: 1,
    right: 1,
    borderWidth: 1.5,
    borderColor: '#1a1917',
  },
  detailName: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 17,
    color: '#faf9f6',
  },
  detailPhone: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 13,
    color: '#78776e',
    marginTop: 2,
  },

  // Info card (inside detail)
  infoCard: {
    backgroundColor: '#252420',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.08)',
  },
  noBorder: { borderBottomWidth: 0 },
  infoLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: '#78776e',
    letterSpacing: 0.5,
  },
  infoValue: { fontFamily: 'Manrope_400Regular', fontSize: 13, color: '#9c9b96' },

  // Action row (toggle active etc.)
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#252420',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    marginBottom: 16,
  },
  actionRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionRowLabel: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: '#9c9b96' },

  // Invite section
  inviteSection: { marginBottom: 8 },
  inviteSectionLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: '#78776e',
    letterSpacing: 0.7,
    marginBottom: 10,
  },
  inviteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#252420',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    marginBottom: 8,
  },
  inviteItemFaded: { opacity: 0.5 },
  inviteToken: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 13,
    color: '#9c9b96',
    marginBottom: 2,
  },
  inviteExpiry: { fontFamily: 'Manrope_400Regular', fontSize: 11, color: '#78776e' },
  inviteActions: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  inviteHint: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: '#78776e',
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 8,
  },

  // Buttons
  primaryBtn: {
    backgroundColor: '#3a3935',
    borderRadius: 6,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
    flexDirection: 'row',
    marginBottom: 8,
  },
  primaryBtnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 15,
    color: '#faf9f6',
  },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontFamily: 'Manrope_500Medium', fontSize: 15, color: '#78776e' },
  btnDisabled: { opacity: 0.4 },
});
