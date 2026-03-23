/**
 * Accept invite screen.
 *
 * Flow: manager generates an invite link → courier opens
 * weego-courier://onboarding/<token>  or  https://app.weego.ua/onboarding/<token>
 *
 * Screen asks for a password, then calls POST /api/v1/onboarding/accept-invite/:token
 * which creates the courier account and returns access/refresh tokens.
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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@/store/auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function AcceptInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { setAuth } = useAuthStore();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAccept() {
    if (!password || password.length < 8) {
      setError('Пароль повинен містити мінімум 8 символів');
      return;
    }
    if (password !== confirm) {
      setError('Паролі не співпадають');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/v1/onboarding/accept-invite/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
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
              Вас запросили до команди курʼєрів.{'\n'}Створіть пароль для входу.
            </Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Новий пароль</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Мінімум 8 символів"
              placeholderTextColor="#71717a"
              secureTextEntry
              autoFocus
            />

            <Text style={[styles.label, { marginTop: 16 }]}>Підтвердити пароль</Text>
            <TextInput
              style={styles.input}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Повторіть пароль"
              placeholderTextColor="#71717a"
              secureTextEntry
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleAccept}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Активувати акаунт</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09090b' },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 26, fontFamily: 'Manrope_700Bold', color: '#fafafa', letterSpacing: -0.5 },
  subtitle: {
    fontSize: 15,
    color: '#a1a1aa',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 22,
  },
  form: { backgroundColor: '#18181b', borderRadius: 8, padding: 24 },
  label: { fontSize: 14, fontFamily: 'Manrope_500Medium', color: '#d4d4d8', marginBottom: 8 },
  input: {
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fafafa',
  },
  error: {
    color: '#f87171',
    fontSize: 14,
    marginTop: 12,
    backgroundColor: '#450a0a',
    borderRadius: 8,
    padding: 10,
  },
  btn: {
    backgroundColor: '#6aaa84',
    borderRadius: 6,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  btnDisabled: { backgroundColor: '#5c9973', opacity: 0.7 },
  btnText: { color: '#fff', fontSize: 16, fontFamily: 'Manrope_600SemiBold' },
});
