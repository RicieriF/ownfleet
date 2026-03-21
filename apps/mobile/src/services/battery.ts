/**
 * Battery optimization exemption.
 *
 * On Android (Xiaomi/Samsung/Huawei) aggressive battery optimization
 * kills background location. We request the user to exempt the app.
 * On iOS this is not applicable.
 */
import { Platform, Alert } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const EXEMPTION_ASKED_KEY = 'battery_exemption_asked';

// OEM brands that are known to kill background processes aggressively
const AGGRESSIVE_OEMS = ['xiaomi', 'redmi', 'huawei', 'honor', 'samsung', 'oppo', 'vivo', 'realme'];

function isAggressiveOEM(): boolean {
  const brand = (Device.brand ?? '').toLowerCase();
  return AGGRESSIVE_OEMS.some((oem) => brand.includes(oem));
}

export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!isAggressiveOEM()) return;

  const alreadyAsked = await AsyncStorage.getItem(EXEMPTION_ASKED_KEY);
  if (alreadyAsked) return;

  await AsyncStorage.setItem(EXEMPTION_ASKED_KEY, '1');

  const packageName =
    Constants.expoConfig?.android?.package ?? 'ua.weego.courier';

  Alert.alert(
    '⚡ Оптимізація батареї',
    'Для коректної роботи GPS у фоні (на вашому пристрої це може блокуватися) відключіть оптимізацію батареї для Weego Courier у налаштуваннях.',
    [
      { text: 'Пізніше', style: 'cancel' },
      {
        text: 'Відкрити налаштування',
        onPress: () => {
          IntentLauncher.startActivityAsync(
            IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            { data: `package:${packageName}` },
          ).catch(() => {
            // Fallback: open general battery settings
            IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
            ).catch(() => {});
          });
        },
      },
    ],
  );
}
