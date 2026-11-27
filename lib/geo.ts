import type { GeoPoint } from "./types";

// Great-circle distance in metres between two lat/lng points (haversine).
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000; // Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// How close the rider must be to the drop for a delivery to be allowed.
export const DELIVERY_GEOFENCE_M = 100;
