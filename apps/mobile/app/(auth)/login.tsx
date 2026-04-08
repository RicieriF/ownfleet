import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/auth';
import { registerPushToken } from '@/services/notifications';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function LoginScreen() {
  const { setAuth } = useAuthStore();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const passwordRef = useRef<TextInput>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!phone.trim() || !password.trim()) {
      setError('Введіть телефон та пароль');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: phone.trim(), password }),
      });

      if (!res.ok) {
        setError('Невірний телефон або пароль');
        return;
      }

      const data = await res.json();
      await setAuth(data.user, data.access_token, data.refresh_token);
      // Register FCM push token now that we have an access token
      registerPushToken().catch(() => {});
      // AuthGuard in _layout.tsx handles the redirect automatically
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
            <Text style={styles.title}>Weego Courier</Text>
            <Text style={styles.subtitle}>Вхід для курʼєрів</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="courier@example.com"
              placeholderTextColor="#78776e"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
            />

            <Text style={[styles.label, { marginTop: 16 }]}>Пароль</Text>
            <TextInput
              ref={passwordRef}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#78776e"
              secureTextEntry
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#faf9f6" />
              ) : (
                <Text style={styles.btnText}>Увійти</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c0b09' },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 28, fontFamily: 'Manrope_600SemiBold', color: '#faf9f6', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: '#9c9b96', marginTop: 4 },
  form: {
    backgroundColor: '#1a1917',
    borderRadius: 8,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(250,249,246,0.08)',
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
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#faf9f6', fontSize: 16, fontFamily: 'Manrope_600SemiBold' },
});
