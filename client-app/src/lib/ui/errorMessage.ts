import { ApiClientError } from "@/api/client";

// Backend error code → friendly driver-facing copy.
const MESSAGES: Record<string, string> = {
  rate_limited: "Too many attempts. Please wait a bit and try again.",
};

export function friendlyError(e: unknown): string {
  if (e instanceof ApiClientError) {
    // Pull a code/message from the JSON error envelope in the body when present.
    try {
      const parsed = JSON.parse(e.body) as { code?: string; error?: string };
      if (parsed.code && MESSAGES[parsed.code]) return MESSAGES[parsed.code];
      if (parsed.error && parsed.error.length <= 140) return parsed.error;
    } catch {
      /* body wasn't JSON */
    }
    if (e.message && e.message.length <= 140) return e.message;
    return "Something went wrong. Please try again.";
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "No connection. Check your internet and try again.";
  }
  if (e instanceof Error && e.message && e.message.length <= 140) return e.message;
  return "Something went wrong. Please try again.";
}
