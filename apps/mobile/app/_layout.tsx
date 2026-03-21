import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/store/auth';
import { registerPushToken } from '@/services/notifications';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { user, isLoaded } = useAuthStore();

  useEffect(() => {
    if (!isLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';

    if (!user && !inAuthGroup && !inOnboarding) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(app)');
    }
  }, [user, isLoaded, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const { loadFromStorage } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
    // Register FCM token (fire-and-forget — no await intentional)
    registerPushToken().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthGuard>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
            <Stack.Screen name="onboarding" />
          </Stack>
        </AuthGuard>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
