import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';
import { useAuthStore } from '@/store/auth';
import { registerPushToken } from '@/services/notifications';

const PREVIEW_MODE = process.env.EXPO_PUBLIC_PREVIEW_MODE === '1';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { user, isLoaded, gpsConsentDone } = useAuthStore();

  useEffect(() => {
    if (PREVIEW_MODE) return;

    if (!isLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    const inGpsConsent = segments[0] === 'gps-consent';

    if (!user && !inAuthGroup && !inOnboarding) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace(gpsConsentDone ? '/(app)' : '/gps-consent');
    } else if (user && !gpsConsentDone && !inGpsConsent && !inOnboarding) {
      router.replace('/gps-consent');
    }
  }, [user, isLoaded, segments, router, gpsConsentDone]);

  return <>{children}</>;
}

export default function RootLayout() {
  const { loadFromStorage } = useAuthStore();

  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    loadFromStorage();
    // Register FCM token (fire-and-forget — no await intentional)
    registerPushToken().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // In design preview mode allow render even if font loading is delayed/failed.
  if (!fontsLoaded && !PREVIEW_MODE) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthGuard>
          <Stack
            initialRouteName={PREVIEW_MODE ? '(app)' : undefined}
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="gps-consent" />
          </Stack>
        </AuthGuard>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
