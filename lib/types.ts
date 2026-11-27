// Order lifecycle states — mirror the deterministic state machine (Part 2).
export type OrderStatus =
  | "AVAILABLE"          // offered to the rider, not yet accepted
  | "ACCEPTED"           // rider accepted, heading to pickup
  | "NAVIGATING_PICKUP"  // en route to pickup
  | "PICKED_UP"          // parcel in hand, heading to drop
  | "NAVIGATING_DROP"    // en route to drop
  | "DELIVERED"          // handed over (geofence-verified)
  | "PAID";              // cash/settlement recorded — terminal

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Rider {
  id: string;
  name: string;
  city: string;
  phone: string;
  lang_pref: string; // e.g. "kn", "hi", "en"
  available: boolean;
}

export interface Order {
  id: string;
  rider_id: string | null;
  status: OrderStatus;
  pickup_name: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_name: string;
  drop_lat: number;
  drop_lng: number;
  distance_km: number;
  earnings: number;        // rupees
  customer_name: string;
  customer_phone: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  order_id: string;
  amount: number;          // rupees
  method: string;          // "CASH" | "ONLINE"
  recorded_at: string;
}

// An append-only audit trail of everything that happened to an order.
// Powers the judge decision panel + metrics (Part 4).
export interface TaskEvent {
  id: string;
  order_id: string | null;
  event_type: string;      // e.g. "ACCEPT", "PICKUP", "DELIVER_BLOCKED", "CASH_RECORDED"
  payload: Record<string, unknown>;
  created_at: string;
}
