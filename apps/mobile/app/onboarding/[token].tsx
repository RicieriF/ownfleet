/**
 * Accept invite screen.
 *
 * Flow: manager generates an invite link → courier opens
 * weego-courier://onboarding/<token>  or  https://app.weego.ua/onboarding/<token>
 *
 * Step 1: password + confirm
 * Step 2: transport mode selection
 * Finish: POST /api/v1/onboarding/accept-invite/:token → setAuth → redirect to (app)
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@/store/auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

type TransportMode = 'car' | 'moto_gas' | 'moto_electric' | 'bicycle' | 'walking';

const TRANSPORT_OPTIONS: { value: TransportMode; label: string; icon: string; hint: string }[] = [
  { value: 'car',           label: 'Авто',           icon: '🚗', hint: 'Легковий або вантажний автомобіль' },
  { value: 'moto_gas',      label: 'Мотоцикл',       icon: '🏍️', hint: 'Бензиновий мотоцикл або скутер' },
  { value: 'moto_electric', label: 'Електромотоцикл', icon: '⚡', hint: 'Електроскутер або e-мото' },
  { value: 'bicycle',       label: 'Велосипед',       icon: '🚲', hint: 'Звичайний або електровелосипед' },
  { value: 'walking',       label: 'Пішки',           icon: '🚶', hint: 'Пішохідна або самокатна доставка' },
];

export default function AcceptInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { setAuth } = useAuthStore();

  // Step 1: password
  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  // Step 2: transport
  const [transportMode, setTransportMode] = useState<TransportMode | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleNextStep() {
    if (!password || password.length < 8) {
      setError('Пароль повинен містити мінімум 8 символів');
      return;
    }
    if (password !== confirm) {
      setError('Паролі не співпадають');
      return;
    }
    setError('');
    setStep(2);
  }

  async function handleAccept() {
    if (!transportMode) {
      setError('Оберіть тип транспорту');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/v1/onboarding/accept-invite/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, transport_mode: transportMode }),
      });

      if (res.status === 404) {
        setError('Посилання недійсне або вже використане');
        return;
      }
      if (res.status === 410) {
        setError('Посилання застаріло. Зверніться до менеджера за новим.');
        return;
      }
      if (!res.ok) {
        setError('Помилка при активації. Спробуйте ще раз.');
        return;
      }

      const data = await res.json();
      await setAuth(data.user, data.access_token, data.refresh_token);
      // AuthGuard in root _layout.tsx handles redirect to (app)
    } catch {
      setError('Помилка мережі. Перевірте зʼєднання.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.logo}>🛵</Text>
            <Text style={styles.title}>Ласкаво просимо!</Text>
            <Text style={styles.subtitle}>
              {step === 1
                ? 'Вас запросили до команди курʼєрів.\nСтворіть пароль для входу.'
                : 'Оберіть тип транспорту.\nЦе потрібно для точного розрахунку часу доставки.'}
            </Text>
          </View>

          {/* Progress indicator */}
          <View style={styles.progress}>
            <View style={[styles.dot, step >= 1 && styles.dotActive]} />
            <View style={styles.line} />
            <View style={[styles.dot, step >= 2 && styles.dotActive]} />
          </View>

          {step === 1 ? (
            <View style={styles.form}>
              <Text style={styles.label}>Новий пароль</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Мінімум 8 символів"
                placeholderTextColor="#78776e"
                secureTextEntry
                autoFocus
              />

              <Text style={[styles.label, { marginTop: 16 }]}>Підтвердити пароль</Text>
              <TextInput
                style={styles.input}
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Повторіть пароль"
                placeholderTextColor="#78776e"
                secureTextEntry
                onSubmitEditing={handleNextStep}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={styles.btn}
                onPress={handleNextStep}
                activeOpacity={0.8}
              >
                <Text style={styles.btnText}>Далі →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.form}>
              <View style={styles.transportGrid}>
                {TRANSPORT_OPTIONS.map((opt) => {
                  const selected = transportMode === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.transportCard, selected && styles.transportCardSelected]}
                      onPress={() => setTransportMode(opt.value)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.transportIcon}>{opt.icon}</Text>
                      <Text style={[styles.transportLabel, selected && styles.transportLabelSelected]}>
                        {opt.label}
                      </Text>
                      <Text style={styles.transportHint}>{opt.hint}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => { setStep(1); setError(''); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.backBtnText}>← Назад</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.btnFlex, (!transportMode || loading) && styles.btnDisabled]}
                  onPress={handleAccept}
                  disabled={!transportMode || loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator color="#faf9f6" />
                  ) : (
                    <Text style={styles.btnText}>Активувати акаунт</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  header: { alignItems: 'center', marginBottom: 24 },
  logo: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 26, fontFamily: 'Manrope_600SemiBold', color: '#faf9f6', letterSpacing: -0.5 },
  subtitle: {
    fontSize: 15,
    color: '#9c9b96',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 22,
  },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    gap: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(250,249,246,0.12)',
  },
  dotActive: { backgroundColor: '#faf9f6' },
  line: { width: 32, height: 1, backgroundColor: 'rgba(250,249,246,0.08)', marginHorizontal: 6 },
  form: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    padding: 24,
  },
  label: { fontSize: 14, fontFamily: 'Manrope_500Medium', color: '#d5d4ce', marginBottom: 8 },
  input: {
    backgroundColor: '#0c0b09',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.14)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#faf9f6',
  },
  error: {
    color: '#d5d4ce',
    fontSize: 14,
    marginTop: 12,
    backgroundColor: 'rgba(239,68,68,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.12)',
    borderRadius: 8,
    padding: 10,
    lineHeight: 20,
  },
  btn: {
    backgroundColor: '#3a3935',
    borderRadius: 6,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.16)',
  },
  btnFlex: { flex: 1, marginTop: 0 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#faf9f6', fontSize: 16, fontFamily: 'Manrope_600SemiBold' },
  transportGrid: { gap: 8 },
  transportCard: {
    backgroundColor: '#0c0b09',
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
    borderRadius: 8,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  transportCardSelected: {
    borderColor: 'rgba(250,249,246,0.22)',
    backgroundColor: '#252420',
  },
  transportIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  transportLabel: {
    fontSize: 15,
    fontFamily: 'Manrope_600SemiBold',
    color: '#9c9b96',
    flex: 1,
  },
  transportLabelSelected: { color: '#faf9f6' },
  transportHint: { fontSize: 12, color: '#78776e', flexShrink: 1, maxWidth: 140, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24 },
  backBtn: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  backBtnText: { color: '#78776e', fontSize: 15, fontFamily: 'Manrope_500Medium' },
});
