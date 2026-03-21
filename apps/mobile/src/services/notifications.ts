/**
 * Notifications service.
 *
 * 1. Registers FCM push token with the backend on app start.
 * 2. Shows a persistent "delivery active" notification on Android
 *    (the foreground service notification is handled by expo-location).
 * 3. Handles incoming FCM messages (new order assigned while app is open).
 *
 * Fire-and-forget pattern — never throw from this service.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_SAVED_KEY = 'fcm_token_registered';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ── Register push token ───────────────────────────────────────────────────────
export async function registerPushToken(): Promise<void> {
  if (!Device.isDevice) return; // Simulators don't support push

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Сповіщення',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync('delivery', {
      name: 'Доставки',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500],
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) return;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const fcmToken = tokenData.data;

    const alreadySaved = await AsyncStorage.getItem(TOKEN_SAVED_KEY);
    if (alreadySaved === fcmToken) return; // No change — skip API call

    const accessToken = await AsyncStorage.getItem('access_token');
    if (!accessToken) return;

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';

    await fetch(`${API_URL}/api/v1/couriers/me/device-token`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ device_token: fcmToken, device_platform: platform }),
    });

    await AsyncStorage.setItem(TOKEN_SAVED_KEY, fcmToken);
  } catch {
    // Non-blocking — app works without push
  }
}

// ── Persistent delivery notification (Android only) ──────────────────────────
// On Android, the foreground service notification from expo-location already
// shows. This function shows an additional sticky alert for the delivery address.
export async function showDeliveryNotification(address: string): Promise<string> {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '🛵 Доставка активна',
      body: address,
      sticky: true,
      autoDismiss: false,
      data: { type: 'delivery_active' },
      ...(Platform.OS === 'android' ? { channelId: 'delivery' } : {}),
    },
    trigger: null, // Show immediately
  });
  return id;
}

export async function dismissDeliveryNotification(id: string): Promise<void> {
  await Notifications.dismissNotificationAsync(id);
}

// ── Incoming notification listener ───────────────────────────────────────────
export function addNotificationListener(
  onReceived: (notification: Notifications.Notification) => void,
): () => void {
  const sub = Notifications.addNotificationReceivedListener(onReceived);
  return () => sub.remove();
}
