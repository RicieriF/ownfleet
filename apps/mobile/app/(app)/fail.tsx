/**
 * Fail delivery screen.
 *
 * Courier reaches this when they cannot complete a delivery
 * (customer not home, wrong address, customer refused, etc.).
 *
 * Calls PATCH /api/v1/deliveries/:id/fail → delivery status → failed,
 * order status → failed, notifies managers via Telegram + webhook.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiPatch } from '@/api/client';

const FAIL_REASONS = [
  { key: 'not_home',       label: 'Клієнта немає вдома' },
  { key: 'wrong_address',  label: 'Неправильна адреса' },
  { key: 'refused',        label: 'Клієнт відмовився' },
  { key: 'unreachable',    label: 'Клієнт не відповідає' },
  { key: 'other',          label: 'Інша причина' },
] as const;

type FailReason = typeof FAIL_REASONS[number]['key'];

export default function FailDeliveryScreen() {
  const { deliveryId, address, externalId } = useLocalSearchParams<{
    deliveryId: string;
    address: string;
    externalId?: string;
  }>();
  const router = useRouter();

  const [selectedReason, setSelectedReason] = useState<FailReason | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function handleFail() {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }

    setSubmitting(true);
    try {
      await apiPatch(`/api/v1/deliveries/${deliveryId}/fail`);
      // Navigate back to main — delivery is gone, courier is idle on shift
      router.replace('/(app)');
    } catch {
      setSubmitting(false);
      setConfirmed(false);
      Alert.alert('Помилка', 'Не вдалося позначити доставку як провалену. Спробуйте ще раз.');
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Провал доставки',
          headerStyle: { backgroundColor: '#0c0b09' },
          headerTintColor: '#faf9f6',
          headerTitleStyle: { fontFamily: 'Manrope_600SemiBold', fontSize: 17 },
        }}
      />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Warning banner */}
          <View style={styles.warningBanner}>
            <Ionicons name="alert-circle-outline" size={22} color="#ef4444" />
            <Text style={styles.warningText}>
              Менеджер отримає сповіщення про провал доставки
            </Text>
          </View>

          {/* Delivery info */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>АДРЕСА ДОСТАВКИ</Text>
            <Text style={styles.address}>{address}</Text>
            {externalId ? (
              <Text style={styles.orderId}>№ {externalId}</Text>
            ) : null}
          </View>

          {/* Reason picker */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ПРИЧИНА (необов'язково)</Text>
            <View style={styles.reasonList}>
              {FAIL_REASONS.map((r, idx) => {
                const selected = selectedReason === r.key;
                const isLast = idx === FAIL_REASONS.length - 1;
                return (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.reasonRow, !isLast && styles.reasonBorder]}
                    onPress={() => setSelectedReason(selected ? null : r.key)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.radio, selected && styles.radioSelected]}>
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <Text style={[styles.reasonLabel, selected && styles.reasonLabelSelected]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Confirmation state */}
          {confirmed && (
            <View style={styles.confirmBanner}>
              <Ionicons name="warning-outline" size={18} color="#f59e0b" />
              <Text style={styles.confirmText}>
                Натисніть ще раз для підтвердження. Цю дію не можна скасувати.
              </Text>
            </View>
          )}

          {/* CTA */}
          <TouchableOpacity
            style={[
              styles.failBtn,
              confirmed && styles.failBtnConfirm,
              submitting && styles.btnDisabled,
            ]}
            onPress={handleFail}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#faf9f6" />
            ) : (
              <>
                <Ionicons
                  name={confirmed ? 'checkmark-circle-outline' : 'close-circle-outline'}
                  size={20}
                  color="#faf9f6"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.failBtnText}>
                  {confirmed ? 'Підтвердити провал' : 'Позначити як провал'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => router.back()}
            disabled={submitting}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelText}>Скасувати</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },
  scroll: { flex: 1 },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },

  // Warning banner
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.20)',
    borderRadius: 8,
    padding: 14,
  },
  warningText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: '#ef4444',
    flex: 1,
    lineHeight: 18,
  },

  // Delivery card
  card: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    padding: 16,
  },
  cardLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: '#78776e',
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
    marginBottom: 8,
  },
  address: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 17,
    color: '#faf9f6',
    lineHeight: 24,
  },
  orderId: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 12,
    color: '#78776e',
    marginTop: 6,
  },

  // Reason section
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: '#78776e',
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
  },
  reasonList: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    overflow: 'hidden',
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  reasonBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(250,249,246,0.06)',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: 'rgba(250,249,246,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioSelected: {
    borderColor: '#ef4444',
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  reasonLabel: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: '#78776e',
  },
  reasonLabelSelected: {
    color: '#faf9f6',
  },

  // Confirm warning
  confirmBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.20)',
    borderRadius: 8,
    padding: 12,
  },
  confirmText: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: '#f59e0b',
    flex: 1,
    lineHeight: 18,
  },

  // Buttons
  failBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingVertical: 17,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.30)',
    marginTop: 4,
  },
  failBtnConfirm: {
    backgroundColor: 'rgba(239,68,68,0.20)',
    borderColor: 'rgba(239,68,68,0.45)',
  },
  failBtnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 16,
    color: '#ef4444',
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  cancelText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: '#78776e',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
