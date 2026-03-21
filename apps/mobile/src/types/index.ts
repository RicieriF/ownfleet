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
  assignment_timeout_at: string | null;
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
