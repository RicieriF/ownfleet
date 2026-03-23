import { useState } from 'react';
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
            <Text style={styles.label}>Номер телефону</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+380XXXXXXXXX"
              placeholderTextColor="#71717a"
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.label, { marginTop: 16 }]}>Пароль</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#71717a"
              secureTextEntry
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
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
  safe: { flex: 1, backgroundColor: '#09090b' },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 28, fontFamily: 'Manrope_700Bold', color: '#fafafa', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: '#a1a1aa', marginTop: 4 },
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
