// ── Auth ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  role: 'owner' | 'manager' | 'dispatcher';
  establishment_id: string;
  is_platform_admin: boolean;
}

// ── Establishment ──────────────────────────────────────────────────────────

export interface Establishment {
  id: string;
  name: string;
  plan: 'pilot' | 'trial' | 'starter' | 'business' | 'pro';
  trial_ends_at: string | null;
  paid_until: string | null;
  onboarding_status: 'pending' | 'couriers_added' | 'first_order' | 'completed';
  settings: {
    retention_orders_days?: number;
    retention_pings_days?: number;
    courier_not_responding_min?: number;
    show_sla_on_dashboard?: boolean;
    eta_alert_enabled?: boolean;
    eta_alert_delay_minutes?: number;
    [key: string]: unknown;
  } | null;
  timezone?: string;
  delivery_sla_minutes?: number | null;
  lat?: number | null;
  lng?: number | null;
  dispatch_mode: 'manual' | 'recommend' | 'auto';
  ready_at?: string | null;
}

// ── Couriers ───────────────────────────────────────────────────────────────

export interface Courier {
  id: string;
  establishment_id: string;
  name: string;
  phone: string;
  active: boolean;
  device_token: string | null;
  device_platform: 'ios' | 'android' | null;
}

export type CourierStatus = 'online' | 'background' | 'not_responding' | 'offline';

export interface Shift {
  id: string;
  courier_id: string;
  establishment_id: string;
  started_at: string;
  ended_at: string | null;
  ended_by: 'courier' | 'manager' | 'auto' | null;
  planned_end_at: string | null;
  total_deliveries: number;
  total_distance_km: number | null;
}

export interface CourierWithStatus extends Courier {
  status: CourierStatus;
  /** true when courier has an active shift (ended_at IS NULL) */
  on_shift: boolean;
  /** Populated when on_shift=true */
  active_shift: Pick<Shift, 'id' | 'started_at' | 'planned_end_at'> | null;
  last_ping_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
}

// ── Orders ─────────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type OrderSource = 'manual' | 'poster' | 'iiko';

export interface Order {
  id: string;
  establishment_id: string;
  external_id: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  status: OrderStatus;
  source: OrderSource;
  notes: string | null;
  created_at: string;
  ready_at: string | null;
  delivery: Delivery | null;
}

// ── Deliveries ─────────────────────────────────────────────────────────────

export type DeliveryStatus = 'assigned' | 'in_progress' | 'completed' | 'failed';

export interface Delivery {
  id: string;
  order_id: string;
  courier_id: string;
  status: DeliveryStatus;
  assigned_at: string;
  assignment_timeout_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  eta_seconds: number | null;
  eta_started_at: string | null;
  courier: { id: string; name: string } | null;
}

// ── Analytics ──────────────────────────────────────────────────────────────

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
    completion_rate: number | null;
    geo_match_rate: number | null;
  };
}

export interface CourierAnalytics {
  courier_id: string;
  courier_name: string;
  total: number;
  completed: number;
  failed: number;
  avg_delivery_minutes: number | null;
  completion_rate: number | null;
}

// ── Onboarding ─────────────────────────────────────────────────────────────

export interface InviteToken {
  id: string;
  courier_id: string;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  courier: { name: string };
}

// ── Webhooks ───────────────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  establishment_id: string;
  url: string;
  events: string[];
  active: boolean;
  consecutive_failures: number;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── WebSocket events ───────────────────────────────────────────────────────

export interface CourierMovedEvent {
  courier_id: string;
  lat: number;
  lng: number;
  battery: number | null;
  ts: number;
}

// ── API responses ──────────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}
