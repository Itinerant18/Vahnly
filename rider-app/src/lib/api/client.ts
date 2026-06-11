import type { ApiEnvelope } from "./types";

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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};
