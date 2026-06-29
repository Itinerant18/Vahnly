const API_BASE_URL =
  (import.meta.env.VITE_GATEWAY_BASE_URL as string | undefined) || 'http://localhost:8085';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem('admin_token');
  } catch {
    return null;
  }
}

function showServerToast(message: string): void {
  if (typeof document === 'undefined') return;
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = [
    'position:fixed',
    'right:24px',
    'bottom:24px',
    'z-index:99999',
    'background:#111827',
    'color:#fff',
    'border:1px solid rgba(255,255,255,.16)',
    'border-radius:8px',
    'padding:12px 14px',
    'font:12px system-ui,sans-serif',
    'box-shadow:0 12px 32px rgba(0,0,0,.28)',
  ].join(';');
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (response.status === 401) {
    window.location.href = '/admin/login';
    throw new ApiError('unauthorized', response.status, text);
  }
  if (response.status >= 500) {
    showServerToast('Admin API error. Please retry.');
  }
  if (!response.ok) {
    throw new ApiError(text || `request_failed_${response.status}`, response.status, text);
  }
  if (!text) return undefined as T;

  const payload = JSON.parse(text);
  return (payload?.data ?? payload) as T;
}

export const apiClient = {
  get: <T>(path: string, headers?: Record<string, string>) => request<T>('GET', path, undefined, headers),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body, headers),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('PUT', path, body, headers),
  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('PATCH', path, body, headers),
  del: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('DELETE', path, body, headers),
};
