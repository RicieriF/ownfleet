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
import { registerManagerPushToken } from '@/services/manager-notifications';

const PREVIEW_MODE = process.env.EXPO_PUBLIC_PREVIEW_MODE === '1';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { user, isLoaded, gpsConsentDone, notifConsentDone, role, courierId } = useAuthStore();

  useEffect(() => {
    if (PREVIEW_MODE) return;
    if (!isLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    const inGpsConsent = segments[0] === 'gps-consent';
    const inNotifConsent = segments[0] === 'notifications-consent';
    const inManagerGroup = segments[0] === '(manager)';

    if (!user && !inAuthGroup && !inOnboarding) {
      router.replace('/(auth)/login');
      return;
    }

    if (!user) return;

    // Manager flow: role-based users (owner/manager/dispatcher)
    // They skip GPS & notification consent — those are courier-specific
    const isManager = role === 'owner' || role === 'manager' || role === 'dispatcher';
    if (isManager) {
      if (inAuthGroup || (!inManagerGroup && !inOnboarding)) {
        router.replace('/(manager)');
      }
      return;
    }

    // Courier flow (has courier_id in JWT, or no role — legacy fallback)
    if (inAuthGroup) {
      if (!gpsConsentDone) router.replace('/gps-consent');
      else if (!notifConsentDone) router.replace('/notifications-consent');
      else router.replace('/(app)');
    } else if (!gpsConsentDone && !inGpsConsent && !inOnboarding) {
      router.replace('/gps-consent');
    } else if (gpsConsentDone && !notifConsentDone && !inNotifConsent && !inOnboarding) {
      router.replace('/notifications-consent');
    }
  }, [user, isLoaded, segments, router, gpsConsentDone, notifConsentDone, role, courierId]);

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
    loadFromStorage().then(() => {
      const { notifConsentDone, role } = useAuthStore.getState();
      const isManager = role === 'owner' || role === 'manager' || role === 'dispatcher';

      if (isManager) {
        // Register manager push token via users endpoint
        registerManagerPushToken().catch(() => {});
      } else if (notifConsentDone) {
        // Re-register courier FCM token on each launch to handle token rotation
        registerPushToken().catch(() => {});
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            <Stack.Screen name="(manager)" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="gps-consent" />
            <Stack.Screen name="notifications-consent" />
          </Stack>
        </AuthGuard>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
