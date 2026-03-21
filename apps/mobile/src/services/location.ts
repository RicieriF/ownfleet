/**
 * Location service — GPS ping every 15 seconds during active delivery.
 *
 * Android: uses a foreground service (persistent notification) to keep GPS alive.
 * iOS:     uses background location mode via expo-task-manager.
 *
 * The background task calls the tracking API directly using the stored token.
 * The foreground ping interval is started/stopped by the delivery screen.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const LOCATION_TASK_NAME = 'WEEGO_BACKGROUND_LOCATION';
const PING_INTERVAL_MS = 15_000; // 15 seconds
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

// ── Background task definition ────────────────────────────────────────────────
// Must be defined at module top-level (TaskManager requirement)
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.warn('[location-task] error:', error.message);
    return;
  }

  const locations = (data as { locations: Location.LocationObject[] })?.locations;
  if (!locations?.length) return;

  const { coords } = locations[locations.length - 1];
  await sendPing(coords.latitude, coords.longitude, coords.accuracy ?? null);
});

// ── Shared ping sender ────────────────────────────────────────────────────────
async function sendPing(lat: number, lng: number, accuracy: number | null): Promise<void> {
  const token = await AsyncStorage.getItem('access_token');
  if (!token) return;

  let battery: number | null = null;
  try {
    const level = await Battery.getBatteryLevelAsync();
    battery = Math.round(level * 100);
  } catch {
    // Battery API unavailable on some simulators
  }

  try {
    await fetch(`${API_URL}/api/v1/tracking/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ lat, lng, battery }),
    });
  } catch {
    // Fire-and-forget — ignore network errors
  }
}

// ── Permissions ────────────────────────────────────────────────────────────────
export async function requestLocationPermissions(): Promise<boolean> {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') return false;

  // Background location required for GPS tracking while app is minimized
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  return bg === 'granted';
}

// ── Background task (iOS + Android) ──────────────────────────────────────────
export async function startBackgroundLocationTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (isRegistered) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: PING_INTERVAL_MS,
    distanceInterval: 0, // always ping on time interval
    showsBackgroundLocationIndicator: true, // iOS blue bar
    foregroundService: Platform.OS === 'android'
      ? {
          notificationTitle: 'Weego — доставка активна',
          notificationBody: 'GPS відстеження увімкнено',
          notificationColor: '#2563eb',
        }
      : undefined,
  });
}

export async function stopBackgroundLocationTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

// ── Foreground ping interval (while app is in foreground) ────────────────────
// Returns a cleanup function. Call when delivery ends or component unmounts.
export function startForegroundPingInterval(
  onPing?: (lat: number, lng: number) => void,
): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude, accuracy } = loc.coords;
      await sendPing(latitude, longitude, accuracy);
      onPing?.(latitude, longitude);
    } catch {
      // Ignore — background task covers gaps
    }
    if (!stopped) {
      setTimeout(tick, PING_INTERVAL_MS);
    }
  };

  // Start immediately
  tick();

  return () => {
    stopped = true;
  };
}

// ── One-shot current location ─────────────────────────────────────────────────
export async function getCurrentLocation(): Promise<Location.LocationObject> {
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}
