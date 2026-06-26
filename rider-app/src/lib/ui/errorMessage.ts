import { ApiError, NetworkError } from "@/lib/api/client";

// Backend error code → friendly rider-facing copy. Unknown codes fall back to the backend
// message (if short) or a generic line.
const MESSAGES: Record<string, string> = {
  rate_limited: "Too many attempts. Please wait a bit and try again.",
  ERR_UNAUTHENTICATED: "Your session expired — please log in again.",
  outside_service_area: "Vahnly operates in Kolkata only for now.",
  active_order_exists: "You already have a trip in progress.",
  no_active_order: "No active trip found.",
  car_not_found: "No usable car for this booking — add one in your garage first.",
  invalid_booking: "Couldn't process that booking. Check the details and try again.",
};

export function friendlyError(e: unknown): string {
  if (e instanceof NetworkError) {
    return "No connection. Check your internet and try again.";
  }
  if (e instanceof ApiError) {
    if (e.code && MESSAGES[e.code]) return MESSAGES[e.code];
    if (e.message && e.message.length <= 140) return e.message;
    return "Something went wrong. Please try again.";
  }
  if (e instanceof Error && e.message && e.message.length <= 140) return e.message;
  return "Something went wrong. Please try again.";
}
