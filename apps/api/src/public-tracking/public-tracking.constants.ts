/** Bull queue for delayed WS disconnect after delivery completion */
export const TRACKING_DISCONNECT_QUEUE = 'tracking-disconnect';

/** Redis pub/sub channels — canonical source is shared/redis/redis.constants.ts */
export {
  PUBLIC_DELIVERY_STATUS_CHANNEL,
  PUBLIC_DELIVERY_COMPLETED_CHANNEL,
} from '../shared/redis/redis.constants.js';

/** Tracking token TTL from creation */
export const TRACKING_TOKEN_TTL_HOURS = 4;
/** Shortened TTL after delivery completion */
export const TRACKING_TOKEN_POST_DELIVERY_MINUTES = 15;
/** Delay before disconnecting WS room for terminal states: cancelled / failed */
export const TRACKING_TOKEN_TERMINAL_DISCONNECT_MINUTES = 2;
