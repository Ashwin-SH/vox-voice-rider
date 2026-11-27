import type { Decision, IntentInput } from "./intents";
import { CONFIDENCE_FLOOR, MAX_CASH } from "./intents";
import type { Order } from "./types";
import { distanceMeters, DELIVERY_GEOFENCE_M } from "./geo";

// Pure decision function: given the current order and a (possibly multilingual,
// possibly misheard) intent, decide what is ALLOWED. No DB, no I/O — fully
// testable. The LLM interprets speech into an intent; THIS decides permission.
export function decide(order: Order | null, input: IntentInput): Decision {
  const base: Decision = {
    intent: input.intent,
    language: input.language,
    confidence: input.confidence,
    orderId: order?.id ?? null,
    statusBefore: order?.status ?? null,
    statusAfter: null,
    validation: "NOOP",
    action: "NOOP",
    feedback: "",
  };

  // Low-confidence recognitions never execute a command — VOX asks again rather
  // than guess. EMERGENCY is exempt: for a rider-safety trigger, a false alarm is
  // safer than a missed real emergency.
  if (
    input.intent !== "EMERGENCY" &&
    typeof input.confidence === "number" &&
    input.confidence < CONFIDENCE_FLOOR
  ) {
    return { ...base, validation: "NOOP", action: "CLARIFY", feedback: "I didn't catch that — say it again." };
  }

  const block = (reason: string, feedback: string, extra: Partial<Decision> = {}): Decision => ({
    ...base, validation: "BLOCKED", action: "BLOCKED", reason, feedback, ...extra,
  });
  const pass = (statusAfter: Order["status"] | null, action: string, feedback: string, extra: Partial<Decision> = {}): Decision => ({
    ...base, validation: "PASSED", action, statusAfter, feedback, ...extra,
  });

  switch (input.intent) {
    case "ACCEPT_ORDER": {
      if (!order) return block("No order on offer.", "There's no order to accept right now.");
      if (order.status !== "AVAILABLE")
        return block("Order already accepted.", "You've already taken this order.");
      return pass("ACCEPTED", "ACCEPT_ORDER", `Order accepted. Head to ${order.pickup_name}.`);
    }

    case "START_NAVIGATION": {
      if (!order) return block("No active order.", "No order to navigate to.");
      if (order.status === "ACCEPTED" || order.status === "NAVIGATING_PICKUP")
        return pass("NAVIGATING_PICKUP", "NAVIGATE_PICKUP", `Navigating to pickup — ${order.pickup_name}.`);
      if (order.status === "PICKED_UP" || order.status === "NAVIGATING_DROP")
        return pass("NAVIGATING_DROP", "NAVIGATE_DROP", `Navigating to drop — ${order.drop_name}.`);
      return block("Nothing to navigate to in this state.", "There's nothing to navigate to yet.");
    }

    case "CALL_CUSTOMER": {
      if (!order || order.status === "AVAILABLE" || order.status === "PAID")
        return block("No active customer.", "There's no active customer to call.");
      return { ...base, validation: "PASSED", action: "CALL_CUSTOMER",
        sideEffect: { type: "CALL", value: order.customer_phone },
        feedback: `Calling ${order.customer_name}.` };
    }

    case "MARK_PICKED_UP": {
      if (!order || order.status === "AVAILABLE")
        return block("Order not accepted yet.", "Accept the order before pickup.");
      if (order.status === "ACCEPTED" || order.status === "NAVIGATING_PICKUP")
        return pass("PICKED_UP", "MARK_PICKED_UP", `Pickup confirmed. Deliver to ${order.drop_name}.`);
      return block("Parcel already picked up.", "You've already picked up this parcel.");
    }

    case "MARK_DELIVERED": {
      if (!order) return block("No active order.", "There's no order to deliver.");
      // Context: the SAME word means different things by state.
      if (order.status === "AVAILABLE" || order.status === "ACCEPTED" || order.status === "NAVIGATING_PICKUP")
        return block("Parcel not picked up yet.", "You haven't picked up the parcel yet — I can't mark this delivered.");
      if (order.status === "DELIVERED" || order.status === "PAID")
        return block("Order already delivered.", "This order is already delivered."); // duplicate prevention

      // PICKED_UP or NAVIGATING_DROP → must verify location.
      if (
        typeof input.riderLat !== "number" || !Number.isFinite(input.riderLat) ||
        typeof input.riderLng !== "number" || !Number.isFinite(input.riderLng)
      )
        return block("Rider location unavailable.", "I can't confirm your location, so I haven't marked it delivered.");
      const distanceM = distanceMeters(
        { lat: input.riderLat, lng: input.riderLng },
        { lat: order.drop_lat, lng: order.drop_lng }
      );
      const geo = { distanceM, thresholdM: DELIVERY_GEOFENCE_M, within: distanceM <= DELIVERY_GEOFENCE_M };
      if (!geo.within)
        return block(
          `Rider ${distanceM}m from drop (> ${DELIVERY_GEOFENCE_M}m geofence).`,
          `You're still ${distanceM} metres away. I haven't marked this delivered.`,
          { geo }
        );
      return pass("DELIVERED", "MARK_DELIVERED", `Delivered. Did you collect the cash?`, { geo });
    }

    case "RECORD_CASH": {
      if (!order || order.status === "PAID")
        return block("No delivered order awaiting payment.", "There's no payment to record.");
      if (order.status !== "DELIVERED")
        return block("Delivery not completed.", "Finish the delivery before recording cash.");
      if (
        typeof input.amount !== "number" ||
        !Number.isInteger(input.amount) ||
        input.amount <= 0 ||
        input.amount > MAX_CASH
      )
        return { ...base, validation: "CONFIRM_REQUIRED", action: "ASK_AMOUNT", feedback: "How much did you collect?" };
      if (input.confirmed !== true)
        return { ...base, validation: "CONFIRM_REQUIRED", action: "CONFIRM_AMOUNT", amount: input.amount,
          feedback: `₹${input.amount} collected — say yes to confirm.` };
      return pass("PAID", "RECORD_CASH", `₹${input.amount} recorded. Ready for your next order.`, { amount: input.amount });
    }

    case "NEXT_ORDER": {
      if (order && order.status !== "PAID" && order.status !== "AVAILABLE")
        return block("Current order not finished.", "Finish your current order first.");
      return { ...base, validation: "PASSED", action: "NEXT_ORDER", feedback: "Loading your next order." };
    }

    case "REPORT_HAZARD":
      return { ...base, validation: "PASSED", action: "REPORT_HAZARD",
        sideEffect: { type: "HAZARD" }, feedback: "Hazard noted. Ride safe." };

    case "EMERGENCY":
      return { ...base, validation: "PASSED", action: "EMERGENCY",
        sideEffect: { type: "EMERGENCY" }, feedback: "Emergency alert sent. Help is on the way." };

    default:
      return { ...base, validation: "NOOP", action: "CLARIFY", feedback: "Sorry, I didn't understand. Could you repeat?" };
  }
}
