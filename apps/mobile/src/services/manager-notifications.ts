/**
 * Push token registration for manager users.
 * Mirrors courier registerPushToken() but calls /api/v1/users/me/device-token.
 * Fire-and-forget — never throws.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const MANAGER_TOKEN_SAVED_KEY = 'manager_fcm_token_registered';

export async function registerManagerPushToken(): Promise<void> {
  if (!Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('manager', {
      name: 'Сповіщення менеджера',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
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

    const alreadySaved = await AsyncStorage.getItem(MANAGER_TOKEN_SAVED_KEY);
    if (alreadySaved === fcmToken) return;

    const accessToken = await AsyncStorage.getItem('access_token');
    if (!accessToken) return;

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';

    const res = await fetch(`${API_URL}/api/v1/auth/me/device-token`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ device_token: fcmToken, device_platform: platform }),
    });

    if (res.ok) {
      await AsyncStorage.setItem(MANAGER_TOKEN_SAVED_KEY, fcmToken);
    }
  } catch {
    // Non-blocking
  }
}
