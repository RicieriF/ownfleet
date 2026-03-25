export interface ManagerTelegramPrefs {
  order_created?: boolean;
  delivery_assigned?: boolean;
  delivery_completed?: boolean;
  delivery_failed?: boolean;
  delivery_force_closed?: boolean;
  courier_shift_started?: boolean;
  courier_shift_ended?: boolean;
  courier_shift_auto_closed?: boolean;
  courier_not_responding?: boolean;
}

export interface CourierTelegramPrefs {
  delivery_assigned?: boolean;
  manager_reminder?: boolean;
  shift_ending_soon?: boolean;
  shift_ending_soon_min?: number; // warning threshold in minutes (default 30)
}

export type ManagerTelegramEvent = keyof ManagerTelegramPrefs;
// Explicit union — excludes `shift_ending_soon_min` (a config value, not an event)
export type CourierTelegramEvent = 'delivery_assigned' | 'manager_reminder' | 'shift_ending_soon';

// Only events that are implemented and fired are enabled by default.
export const DEFAULT_MANAGER_PREFS: ManagerTelegramPrefs = {
  order_created: true,
  courier_shift_auto_closed: true,
  courier_not_responding: true,
};

export const DEFAULT_COURIER_PREFS: CourierTelegramPrefs = {
  delivery_assigned: true,
  manager_reminder: true,
  shift_ending_soon: true,
};

/** Parsed Telegram Bot API Update (minimal subset we need) */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot: boolean; first_name: string };
    chat: { id: number };
    text?: string;
  };
}
