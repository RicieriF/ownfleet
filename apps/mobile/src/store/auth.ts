import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CourierUser, UserRole } from '../types';

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_KEY = 'courier_user';
const GPS_CONSENT_KEY = 'gps_consent_done';
const NOTIF_CONSENT_KEY = 'notif_consent_done';
const USER_ROLE_KEY = 'user_role';
const COURIER_ID_KEY = 'jwt_courier_id';

interface JwtPayload {
  sub: string;
  establishment_id: string;
  role: UserRole | null;
  courier_id?: string;
  is_platform_admin?: boolean;
}

function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // atob is available in React Native (Hermes engine)
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

interface AuthState {
  user: CourierUser | null;
  accessToken: string | null;
  isLoaded: boolean;
  gpsConsentDone: boolean;
  notifConsentDone: boolean;
  /** Role extracted from JWT — owner|manager|dispatcher or null for couriers */
  role: UserRole | null;
  /** courier_id from JWT — present only for courier-linked users */
  courierId: string | null;
  setAuth: (user: CourierUser, accessToken: string, refreshToken: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  refreshAccessToken: () => Promise<boolean>;
  setGpsConsentDone: () => Promise<void>;
  setNotifConsentDone: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isLoaded: false,
  gpsConsentDone: false,
  notifConsentDone: false,
  role: null,
  courierId: null,

  setAuth: async (user, accessToken, refreshToken) => {
    const payload = parseJwtPayload(accessToken);
    const role = payload?.role ?? null;
    const courierId = payload?.courier_id ?? null;

    await Promise.all([
      AsyncStorage.setItem(ACCESS_TOKEN_KEY, accessToken),
      AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(user)),
      role
        ? AsyncStorage.setItem(USER_ROLE_KEY, role)
        : AsyncStorage.removeItem(USER_ROLE_KEY),
      courierId
        ? AsyncStorage.setItem(COURIER_ID_KEY, courierId)
        : AsyncStorage.removeItem(COURIER_ID_KEY),
    ]);
    set({ user, accessToken, role, courierId });
  },

  clearAuth: async () => {
    await Promise.all([
      AsyncStorage.removeItem(ACCESS_TOKEN_KEY),
      AsyncStorage.removeItem(REFRESH_TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
      AsyncStorage.removeItem(USER_ROLE_KEY),
      AsyncStorage.removeItem(COURIER_ID_KEY),
    ]);
    set({ user: null, accessToken: null, role: null, courierId: null });
  },

  loadFromStorage: async () => {
    const [token, userJson, gpsConsent, notifConsent, storedRole, storedCourierId] =
      await Promise.all([
        AsyncStorage.getItem(ACCESS_TOKEN_KEY),
        AsyncStorage.getItem(USER_KEY),
        AsyncStorage.getItem(GPS_CONSENT_KEY),
        AsyncStorage.getItem(NOTIF_CONSENT_KEY),
        AsyncStorage.getItem(USER_ROLE_KEY),
        AsyncStorage.getItem(COURIER_ID_KEY),
      ]);
    const gpsConsentDone = gpsConsent === '1';
    const notifConsentDone = notifConsent === '1';

    if (token && userJson) {
      // Re-parse JWT to get fresh role (handles token rotation between sessions)
      const payload = parseJwtPayload(token);
      const role = (payload?.role ?? storedRole ?? null) as UserRole | null;
      const courierId = payload?.courier_id ?? storedCourierId ?? null;
      set({
        user: JSON.parse(userJson) as CourierUser,
        accessToken: token,
        isLoaded: true,
        gpsConsentDone,
        notifConsentDone,
        role,
        courierId,
      });
    } else {
      set({ isLoaded: true, gpsConsentDone, notifConsentDone });
    }
  },

  setGpsConsentDone: async () => {
    await AsyncStorage.setItem(GPS_CONSENT_KEY, '1');
    set({ gpsConsentDone: true });
  },

  setNotifConsentDone: async () => {
    await AsyncStorage.setItem(NOTIF_CONSENT_KEY, '1');
    set({ notifConsentDone: true });
  },

  refreshAccessToken: async () => {
    const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
    const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `refresh_token=${refreshToken}`,
        },
      });
      if (!res.ok) {
        await get().clearAuth();
        return false;
      }
      const data = await res.json() as { access_token?: string; refresh_token?: string };
      if (data.access_token) {
        // Re-parse role from new token
        const payload = parseJwtPayload(data.access_token);
        const role = payload?.role ?? null;
        const courierId = payload?.courier_id ?? null;

        await AsyncStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
        if (data.refresh_token) {
          await AsyncStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
        }
        set({ accessToken: data.access_token, role, courierId });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
}));
