import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Shift } from '../types';

const SHIFT_KEY = 'active_shift';

interface ShiftState {
  shift: Shift | null;
  /** True while the initial hydration from storage hasn't completed yet */
  isHydrated: boolean;
  setShift: (shift: Shift | null) => Promise<void>;
  clearShift: () => Promise<void>;
  /** Call once on app start (before first API fetch) to restore cached shift */
  hydrateFromStorage: () => Promise<void>;
}

export const useShiftStore = create<ShiftState>((set) => ({
  shift: null,
  isHydrated: false,

  setShift: async (shift) => {
    if (shift) {
      await AsyncStorage.setItem(SHIFT_KEY, JSON.stringify(shift));
    } else {
      await AsyncStorage.removeItem(SHIFT_KEY);
    }
    set({ shift });
  },

  clearShift: async () => {
    await AsyncStorage.removeItem(SHIFT_KEY);
    set({ shift: null });
  },

  hydrateFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(SHIFT_KEY);
      const shift: Shift | null = raw ? (JSON.parse(raw) as Shift) : null;
      set({ shift, isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },
}));
