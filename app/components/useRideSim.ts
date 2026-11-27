"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Order, GeoPoint } from "@/lib/types";
import { distanceMeters } from "@/lib/geo";

// The rider's simulated world: going online, ride requests arriving on their own,
// a marker that moves along the route, and live earnings. This is the DEMO layer —
// it never decides anything safety-critical. Every real state change still goes
// through the engine (/api/intent); the sim just feeds it the rider's current
// simulated GPS, so the geofence stays genuinely enforced.

// Rider's home base (Jayanagar, Bengaluru) — where a pickup leg starts from.
const HOME: GeoPoint = { lat: 12.9308, lng: 77.5838 };

const OFFER_SECONDS = 22; // how long a request stays on offer
const TICK_MS = 200; // movement update cadence
const SIM_MPS = 30; // demo marker speed (fast, so legs take seconds)
const REAL_MPS = 5.5; // ~20 km/h, used only for a believable ETA in minutes
const ARRIVE_M = 25; // snap-to-target distance that counts as "arrived"

export type RidePhase =
  | "OFFLINE"
  | "SEARCHING" // online, waiting for a request
  | "OFFER" // a request is on the table with a countdown
  | "TO_PICKUP"
  | "AT_PICKUP"
  | "TO_DROP"
  | "AT_DROP"
  | "NO_RIDES"; // online but the scenario is exhausted

export interface RideSim {
  online: boolean;
  phase: RidePhase;
  offer: Order | null;
  offerSecsLeft: number;
  rider: GeoPoint;
  navTarget: "pickup" | "drop" | null;
  distanceToTargetM: number | null;
  etaMin: number | null;
  moving: boolean;
  speedMult: number;
  earnings: number;
  rides: number;
  // actions
  goOnline: () => void;
  goOffline: () => void;
  rejectOffer: () => void;
  triggerRequest: () => void;
  setSpeed: (m: number) => void;
  togglePause: () => void;
  jumpToPickup: () => void;
  jumpToDrop: () => void;
  setFarFromDrop: () => void;
  refreshStats: () => void;
  reset: () => Promise<void>;
}

// A point `meters` from `a` in the direction of `b` (small-distance linear approx).
function pointTowards(a: GeoPoint, b: GeoPoint, meters: number): GeoPoint {
  const total = distanceMeters(a, b);
  if (total <= 0) return { ...a };
  const f = Math.min(1, meters / total);
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

export function useRideSim(opts: {
  activeOrder: Order | null; // the accepted ride in flight (null when none)
  onOffer: (o: Order) => void; // chime + spoken read-out of a new request
  onArrive: (where: "pickup" | "drop", o: Order) => void; // spoken arrival cue
}): RideSim {
  const { activeOrder, onOffer, onArrive } = opts;

  const [online, setOnline] = useState(false);
  const [offer, setOffer] = useState<Order | null>(null);
  const [offerSecsLeft, setOfferSecsLeft] = useState(0);
  const [rider, setRider] = useState<GeoPoint>(HOME);
  const [navTarget, setNavTarget] = useState<"pickup" | "drop" | null>(null);
  const [distanceToTargetM, setDistanceToTargetM] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [speedMult, setSpeedMult] = useState(4);
  const [earnings, setEarnings] = useState(0);
  const [rides, setRides] = useState(0);

  // Latest values for use inside intervals/timeouts without re-subscribing.
  const offerRef = useRef<Order | null>(null);
  offerRef.current = offer;
  const skipRef = useRef<Set<string>>(new Set()); // declined/expired request ids
  const offerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<number>(0);
  const onlineRef = useRef(false);
  onlineRef.current = online;
  const onOfferRef = useRef(onOffer);
  onOfferRef.current = onOffer;
  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;
  const speedRef = useRef(speedMult);
  speedRef.current = speedMult;
  const movingRef = useRef(false);
  movingRef.current = moving;
  const navTargetRef = useRef(navTarget);
  navTargetRef.current = navTarget;
  const riderRef = useRef(rider);
  riderRef.current = rider;
  const activeRef = useRef(activeOrder);
  activeRef.current = activeOrder;

  const refreshStats = useCallback(() => {
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setEarnings(Number(d.earnings) || 0);
          setRides(Number(d.rides) || 0);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Present the next eligible AVAILABLE request after `delayMs` (a request "arriving").
  const presentNextOffer = useCallback(
    (delayMs: number) => {
      if (offerTimerRef.current) clearTimeout(offerTimerRef.current);
      offerTimerRef.current = setTimeout(async () => {
        if (!onlineRef.current || activeRef.current) return; // went offline / busy
        let list: Order[] = [];
        try {
          const r = await fetch("/api/orders?status=AVAILABLE", { cache: "no-store" });
          const d = await r.json();
          list = Array.isArray(d.orders) ? d.orders : [];
        } catch {
          /* leave empty */
        }
        if (!onlineRef.current || activeRef.current) return;
        const cand = list
          .filter((o) => !skipRef.current.has(o.id))
          .sort((a, b) => a.id.localeCompare(b.id))[0];
        if (!cand) {
          setOffer(null);
          setOfferSecsLeft(0);
          return; // phase derives to NO_RIDES
        }
        deadlineRef.current = Date.now() + OFFER_SECONDS * 1000;
        setOffer(cand);
        setOfferSecsLeft(OFFER_SECONDS);
        onOfferRef.current(cand);
      }, delayMs);
    },
    []
  );

  // Offer countdown — expire → decline and look for the next one.
  useEffect(() => {
    if (!offer) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setOfferSecsLeft(left);
      if (left <= 0) {
        skipRef.current.add(offer.id);
        setOffer(null);
        presentNextOffer(900);
      }
    }, 250);
    return () => clearInterval(id);
  }, [offer, presentNextOffer]);

  // React to the active ride's status: start the right leg once per status change.
  const legStartedRef = useRef<string>("");
  const prevActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    const o = activeOrder;
    const prevId = prevActiveIdRef.current;

    if (!o) {
      // Ride ended (or none). If we just finished one, bank it and look for the next.
      navTargetRef.current = null;
      setNavTarget(null);
      setMoving(false);
      setDistanceToTargetM(null);
      legStartedRef.current = "";
      if (prevId) {
        refreshStats();
        if (onlineRef.current) presentNextOffer(2500);
      }
      prevActiveIdRef.current = null;
      return;
    }
    prevActiveIdRef.current = o.id;
    setOffer(null); // accepting clears the request card

    const leg =
      o.status === "ACCEPTED" || o.status === "NAVIGATING_PICKUP"
        ? "pickup"
        : o.status === "PICKED_UP" || o.status === "NAVIGATING_DROP"
        ? "drop"
        : o.status === "DELIVERED"
        ? "done"
        : "";
    const key = `${o.id}:${leg}`;
    if (leg && key !== legStartedRef.current) {
      legStartedRef.current = key;
      if (leg === "pickup") {
        const start = HOME;
        setRider(start);
        setNavTarget("pickup");
        setDistanceToTargetM(distanceMeters(start, { lat: o.pickup_lat, lng: o.pickup_lng }));
        setMoving(true);
      } else if (leg === "drop") {
        const start = { lat: o.pickup_lat, lng: o.pickup_lng };
        setRider(start);
        setNavTarget("drop");
        setDistanceToTargetM(distanceMeters(start, { lat: o.drop_lat, lng: o.drop_lng }));
        setMoving(true);
      } else if (leg === "done") {
        setNavTarget(null);
        setMoving(false);
      }
    }
  }, [activeOrder, presentNextOffer, refreshStats]);

  // Movement tick: step the marker toward the current leg's target.
  useEffect(() => {
    const id = setInterval(() => {
      if (!movingRef.current) return;
      const o = activeRef.current;
      const target = navTargetRef.current;
      if (!o || !target) return;
      const dest: GeoPoint =
        target === "pickup" ? { lat: o.pickup_lat, lng: o.pickup_lng } : { lat: o.drop_lat, lng: o.drop_lng };
      const cur = riderRef.current;
      const remaining = distanceMeters(cur, dest);
      const step = SIM_MPS * speedRef.current * (TICK_MS / 1000);
      if (remaining <= ARRIVE_M || remaining <= step) {
        riderRef.current = dest;
        setRider(dest);
        setDistanceToTargetM(0);
        setMoving(false);
        onArriveRef.current(target, o);
        return;
      }
      const next = pointTowards(cur, dest, step);
      riderRef.current = next;
      setRider(next);
      setDistanceToTargetM(Math.round(remaining - step));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Clean up the pending offer timer on unmount.
  useEffect(() => () => { if (offerTimerRef.current) clearTimeout(offerTimerRef.current); }, []);

  const goOnline = useCallback(() => {
    setOnline(true);
    onlineRef.current = true;
    presentNextOffer(2200);
  }, [presentNextOffer]);

  const goOffline = useCallback(() => {
    setOnline(false);
    onlineRef.current = false;
    if (offerTimerRef.current) clearTimeout(offerTimerRef.current);
    setOffer(null);
    setOfferSecsLeft(0);
  }, []);

  const rejectOffer = useCallback(() => {
    const o = offerRef.current;
    if (o) skipRef.current.add(o.id);
    setOffer(null);
    setOfferSecsLeft(0);
    if (onlineRef.current) presentNextOffer(1200);
  }, [presentNextOffer]);

  const triggerRequest = useCallback(() => {
    if (!onlineRef.current || activeRef.current) return;
    presentNextOffer(200);
  }, [presentNextOffer]);

  const setSpeed = useCallback((m: number) => setSpeedMult(m), []);
  const togglePause = useCallback(() => setMoving((v) => !v), []);

  const jumpToPickup = useCallback(() => {
    const o = activeRef.current;
    if (!o) return;
    const p = { lat: o.pickup_lat, lng: o.pickup_lng };
    setRider(p);
    setMoving(false);
    setDistanceToTargetM(navTargetRef.current === "pickup" ? 0 : distanceMeters(p, { lat: o.drop_lat, lng: o.drop_lng }));
  }, []);

  const jumpToDrop = useCallback(() => {
    const o = activeRef.current;
    if (!o) return;
    const d = { lat: o.drop_lat, lng: o.drop_lng };
    setRider(d);
    setMoving(false);
    setDistanceToTargetM(0);
  }, []);

  const setFarFromDrop = useCallback(() => {
    const o = activeRef.current;
    if (!o) return;
    // 180 m from the drop, toward the pickup — clearly outside the 100 m geofence.
    const far = pointTowards({ lat: o.drop_lat, lng: o.drop_lng }, { lat: o.pickup_lat, lng: o.pickup_lng }, 180);
    setRider(far);
    setMoving(false);
    setDistanceToTargetM(distanceMeters(far, { lat: o.drop_lat, lng: o.drop_lng }));
  }, []);

  const reset = useCallback(async () => {
    try {
      await fetch("/api/orders/reset", { method: "POST" });
    } catch {
      /* ignore */
    }
    if (offerTimerRef.current) clearTimeout(offerTimerRef.current);
    skipRef.current.clear();
    legStartedRef.current = "";
    prevActiveIdRef.current = null;
    setOnline(false);
    onlineRef.current = false;
    setOffer(null);
    setOfferSecsLeft(0);
    setRider(HOME);
    setNavTarget(null);
    setMoving(false);
    setDistanceToTargetM(null);
    setSpeedMult(4);
    refreshStats();
  }, [refreshStats]);

  // Derived phase label for the UI.
  const phase: RidePhase = !online
    ? "OFFLINE"
    : activeOrder
    ? activeOrder.status === "DELIVERED"
      ? "AT_DROP"
      : navTarget === "drop"
      ? moving
        ? "TO_DROP"
        : "AT_DROP"
      : moving
      ? "TO_PICKUP"
      : "AT_PICKUP"
    : offer
    ? "OFFER"
    : "SEARCHING";

  const etaMin =
    distanceToTargetM != null && distanceToTargetM > 0 ? Math.max(1, Math.ceil(distanceToTargetM / REAL_MPS / 60)) : distanceToTargetM === 0 ? 0 : null;

  return {
    online, phase, offer, offerSecsLeft, rider, navTarget, distanceToTargetM, etaMin, moving, speedMult, earnings, rides,
    goOnline, goOffline, rejectOffer, triggerRequest, setSpeed, togglePause, jumpToPickup, jumpToDrop, setFarFromDrop, refreshStats, reset,
  };
}
