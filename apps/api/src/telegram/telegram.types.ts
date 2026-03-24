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
}

export type ManagerTelegramEvent = keyof ManagerTelegramPrefs;
export type CourierTelegramEvent = keyof CourierTelegramPrefs;

// Only events that are actually fired are enabled by default.
// courier_not_responding and shift_ending_soon are defined in types but not yet
// implemented — they will be added to defaults when the logic is wired up.
export const DEFAULT_MANAGER_PREFS: ManagerTelegramPrefs = {
  order_created: true,
  courier_shift_auto_closed: true,
};

export const DEFAULT_COURIER_PREFS: CourierTelegramPrefs = {
  delivery_assigned: true,
  manager_reminder: true,
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
