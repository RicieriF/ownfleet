export interface Shift {
  id: string;
  courier_id: string;
  establishment_id: string;
  started_at: string;
  ended_at: string | null;
  ended_by: 'courier' | 'manager' | 'auto' | null;
  planned_end_at: string | null;
  total_deliveries: number;
  total_distance_km: string;
}

export type TransportMode = 'car' | 'moto_gas' | 'moto_electric' | 'bicycle' | 'walking';

export interface CourierUser {
  id: string;
  establishment_id: string;
  name: string;
  phone: string;
}

export type DeliveryStatus = 'assigned' | 'in_progress' | 'completed' | 'failed';

export interface ActiveDelivery {
  id: string;
  order_id: string;
  status: DeliveryStatus;
  assigned_at: string;
  started_at: string | null;
  order: {
    id: string;
    address: string;
    lat: number | null;
    lng: number | null;
    notes: string | null;
    external_id: string | null;
  };
}

export interface AvailableOrder {
  id: string;
  address: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  created_at: string;
}

export interface WorkloadCourierStat {
  courierId: string;
  courierName: string;
  deliveriesCount: number;
  activeMinutes: number;
}

export interface WorkloadToday {
  couriers: WorkloadCourierStat[];
  myStats: {
    deliveriesCount: number;
    activeMinutes: number;
  };
  teamAvg: {
    deliveriesCount: number;
    activeMinutes: number;
  };
}

export interface DeliveryHistoryItem {
  id: string;
  status: 'completed' | 'failed';
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  order: {
    id: string;
    address: string;
    external_id: string | null;
  };
}

export interface ShiftHistoryItem {
  id: string;
  started_at: string;
  ended_at: string;
  ended_by: 'courier' | 'manager' | 'auto';
  planned_end_at: string | null;
  total_deliveries: number;
  total_distance_km: string;
}

export interface PingPayload {
  lat: number;
  lng: number;
  battery: number | null;
}

export interface ProofPayload {
  lat: number;
  lng: number;
  accuracy: number;
  photo_key?: string;
}

// ── Manager types ─────────────────────────────────────────────────────────────

export type UserRole = 'owner' | 'manager' | 'dispatcher';

export interface ManagerUser {
  id: string;
  establishment_id: string;
  name: string;
  email: string;
  role: UserRole;
}

export type OrderStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ManagerOrder {
  id: string;
  external_id: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  status: OrderStatus;
  created_at: string;
  ready_at: string | null;
  delivery?: {
    id: string;
    courier_id: string;
    status: string;
    eta_seconds: number | null;
    courier: {
      id: string;
      name: string;
    };
  } | null;
}

/** Courier status for manager dashboard — based on last ping timestamp */
export type CourierOnlineStatus = 'online' | 'background' | 'not_responding' | 'offline';

export interface ManagerCourier {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  transport_mode: TransportMode | null;
  // Flat fields (web compat)
  last_ping_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  // Nested object for mobile (battery + coordinates in one place)
  last_ping: {
    lat: number;
    lng: number;
    battery: number | null;
    created_at: string;
  } | null;
  active_shift: {
    id: string;
    started_at: string;
    planned_end_at: string | null;
  } | null;
  active_delivery: {
    id: string;
    order: {
      id: string;
      address: string;
      lat: number | null;
      lng: number | null;
    };
  } | null;
  /** Resolved online status from API */
  status: CourierOnlineStatus;
}

export interface ActiveShiftItem {
  id: string;
  started_at: string;
  planned_end_at: string | null;
  courier: {
    id: string;
    name: string;
    phone: string;
    transport_mode: TransportMode | null;
    last_ping: {
      lat: number;
      lng: number;
      battery: number | null;
      created_at: string;
    } | null;
    active_delivery: {
      id: string;
      order: { id: string; address: string };
    } | null;
  };
}

export interface ManagerKpi {
  onShiftCount: number;
  pendingOrdersCount: number;
  activeDeliveriesCount: number;
  notStartedCount: number;
  inRideCount: number;
  freeCount: number;
}

// ── Analytics types ────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  period: { from: string; to: string };
  totals: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    in_progress: number;
    pending: number;
    assigned: number;
  };
  metrics: {
    avg_delivery_minutes: number | null;
    completion_rate: number;
    geo_match_rate: number;
  };
}

export interface AnalyticsCourierStat {
  courier_id: string;
  courier_name: string;
  total: number;
  completed: number;
  failed: number;
  avg_delivery_minutes: number | null;
  completion_rate: number;
}

// ── Delivery Proofs ────────────────────────────────────────────────────────

export interface GeoFlags {
  proof_after_close?: true;
  low_accuracy?: true;
  no_destination_coords?: true;
  force_closed?: true;
  closed_by?: string;
}

export interface DeliveryProof {
  id: string;
  delivery_id: string;
  lat: number;
  lng: number;
  captured_at: string;
  geo_match: boolean;
  accuracy: number | null;
  geo_flags: GeoFlags;
  photo_key: string | null;
  photo_url: string | null;
}

// ── Manager History ────────────────────────────────────────────────────────

export interface HistoryOrder {
  id: string;
  external_id: string | null;
  address: string;
  status: 'completed' | 'failed' | 'cancelled';
  created_at: string;
  delivery?: {
    id: string;
    courier_id: string;
    status: string;
    completed_at: string | null;
    courier: {
      id: string;
      name: string;
    };
  } | null;
}

export interface InviteItem {
  id: string;
  courier_id: string;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  courier: { name: string };
}
