import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CourierUser } from '../types';

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_KEY = 'courier_user';

interface AuthState {
  user: CourierUser | null;
  accessToken: string | null;
  isLoaded: boolean;
  setAuth: (user: CourierUser, accessToken: string, refreshToken: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  refreshAccessToken: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isLoaded: false,

  setAuth: async (user, accessToken, refreshToken) => {
    await Promise.all([
      AsyncStorage.setItem(ACCESS_TOKEN_KEY, accessToken),
      AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(user)),
    ]);
    set({ user, accessToken });
  },

  clearAuth: async () => {
    await Promise.all([
      AsyncStorage.removeItem(ACCESS_TOKEN_KEY),
      AsyncStorage.removeItem(REFRESH_TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
    set({ user: null, accessToken: null });
  },

  loadFromStorage: async () => {
    const [token, userJson] = await Promise.all([
      AsyncStorage.getItem(ACCESS_TOKEN_KEY),
      AsyncStorage.getItem(USER_KEY),
    ]);
    if (token && userJson) {
      set({ user: JSON.parse(userJson), accessToken: token, isLoaded: true });
    } else {
      set({ isLoaded: true });
    }
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
      const data = await res.json();
      if (data.access_token) {
        await AsyncStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
        if (data.refresh_token) {
          await AsyncStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
        }
        set({ accessToken: data.access_token });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
}));
