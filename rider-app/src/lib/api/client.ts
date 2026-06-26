import type { ApiEnvelope } from "./types";
import { useToastStore } from "../store/useToastStore";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8085";

export const TOKEN_STORAGE_KEY = "dfu_rider_token";

/** Thrown on a non-2xx API response. `code` is the backend error code. */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Thrown when the request never reached the server (offline / DNS / CORS). */
export class NetworkError extends Error {
  offline: boolean;
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
    this.offline = typeof navigator !== "undefined" ? !navigator.onLine : false;
  }
}

// Registered by authStore so the client can log out on a 401 without importing
// the store (avoids a circular dependency).
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export const REFRESH_STORAGE_KEY = "dfu_rider_refresh";

function readRefresh(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_STORAGE_KEY);
}

export function persistRefresh(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(REFRESH_STORAGE_KEY, token);
  else window.localStorage.removeItem(REFRESH_STORAGE_KEY);
}

// Single-flight refresh: a burst of 401s triggers one /auth/refresh; queued requests share it.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshRiderToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const rt = readRefresh();
    if (!rt) return false;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) {
        if (typeof window !== "undefined") {
          useToastStore.getState().show("Session expired. Please log in again.", "info");
        }
        return false;
      }
      const data = (await res.json()) as { token?: string; refresh_token?: string };
      if (!data.token || typeof window === "undefined") return false;
      window.localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      persistRefresh(data.refresh_token ?? null);
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  _retried = false,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  const token = readToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError(`Request to ${path} failed (offline?)`);
  }

  if (res.status === 401) {
    // Refresh-on-401: silently refresh once, then retry with the fresh token.
    if (!_retried && readRefresh()) {
      const ok = await refreshRiderToken();
      if (ok) return request<T>(method, path, body, extraHeaders, true);
    }
    if (onUnauthorized) {
      onUnauthorized();
    } else if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.location.href = "/login";
    }
    throw new ApiError("unauthorized", 401, "ERR_UNAUTHENTICATED");
  }

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!res.ok || (envelope && envelope.success === false)) {
    throw new ApiError(
      envelope?.error ?? `request failed (${res.status})`,
      res.status,
      envelope?.code,
    );
  }
  return (envelope?.data ?? (undefined as unknown)) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>("POST", path, body, headers),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};
