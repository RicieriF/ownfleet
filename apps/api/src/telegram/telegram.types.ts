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
  shift_anomaly?: boolean;
  dispatch_no_courier?: boolean;
  geocode_failed?: boolean;
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

/**
 * Named constants for all manager Telegram event types.
 * Use these instead of bare string literals so that IDE autocomplete
 * enumerates valid values and a future rename only touches one place.
 *
 * TypeScript already validates strings against ManagerTelegramEvent at
 * compile time; these constants are an extra DX convenience on top.
 */
export const MANAGER_EVENT = {
  ORDER_CREATED: 'order_created',
  DELIVERY_ASSIGNED: 'delivery_assigned',
  DELIVERY_COMPLETED: 'delivery_completed',
  DELIVERY_FAILED: 'delivery_failed',
  DELIVERY_FORCE_CLOSED: 'delivery_force_closed',
  COURIER_SHIFT_STARTED: 'courier_shift_started',
  COURIER_SHIFT_ENDED: 'courier_shift_ended',
  COURIER_SHIFT_AUTO_CLOSED: 'courier_shift_auto_closed',
  COURIER_NOT_RESPONDING: 'courier_not_responding',
  SHIFT_ANOMALY: 'shift_anomaly',
  DISPATCH_NO_COURIER: 'dispatch_no_courier',
  GEOCODE_FAILED: 'geocode_failed',
} as const satisfies Record<string, ManagerTelegramEvent>;

/** Named constants for courier Telegram event types. */
export const COURIER_EVENT = {
  DELIVERY_ASSIGNED: 'delivery_assigned',
  MANAGER_REMINDER: 'manager_reminder',
  SHIFT_ENDING_SOON: 'shift_ending_soon',
} as const satisfies Record<string, CourierTelegramEvent>;

// Only events that are implemented and fired are enabled by default.
export const DEFAULT_MANAGER_PREFS: ManagerTelegramPrefs = {
  order_created: true,
  courier_shift_auto_closed: true,
  courier_not_responding: true,
  dispatch_no_courier: true,
  geocode_failed: true,
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
