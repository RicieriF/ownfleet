/**
 * Shared types for the public tracking embed.
 * Mirrors the TrackSnapshot interface from the API (public-tracking.service.ts).
 */

export interface TrackSnapshot {
  orderStatus: string;
  deliveryStatus: string | null;
  courierName: string | null;
  courierTransportMode: string | null;
  courierLat: number | null;
  courierLng: number | null;
  orderLat: number | null;
  orderLng: number | null;
  etaSeconds: number | null;
  etaStartedAt: string | null;
  routeGeometry: GeoJsonLineString | null;
  address: string;
  slaDeadline: string | null;
  establishmentName: string;
  locale: string;
  tokenExpiresAt: string;
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

/** Derived widget state from snapshot data. */
export type WidgetState =
  | 'loading'
  | 'state0'   // pending, no delivery
  | 'state1'   // delivery assigned, courier not yet departed
  | 'state2'   // delivery in_progress (courier on the way)
  | 'state3'   // completed
  | 'state4'   // cancelled
  | 'state5'   // delivery failed
  | 'expired'; // token expired or order not found

export function deriveWidgetState(snapshot: TrackSnapshot | null): WidgetState {
  if (!snapshot) return 'loading';

  // Token expired check
  if (new Date(snapshot.tokenExpiresAt) < new Date()) return 'expired';

  const { orderStatus, deliveryStatus } = snapshot;

  if (orderStatus === 'completed') return 'state3';
  if (orderStatus === 'cancelled') return 'state4';
  if (deliveryStatus === 'failed') return 'state5';
  if (deliveryStatus === 'in_progress') return 'state2';
  if (deliveryStatus === 'assigned') return 'state1';
  return 'state0';
}

export const TRANSPORT_ICON: Record<string, string> = {
  car:            '🚗',
  moto_gas:       '🛵',
  moto_electric:  '⚡',
  bicycle:        '🚲',
  walking:        '🚶',
};
