import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// ── Deterministic web storage ───────────────────────────────────────────────
// jsdom's storage is flaky under vitest v4; the rider auth store reads/writes
// localStorage (token) and sessionStorage (rider profile), so give both a clean
// in-memory implementation.
class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, { value: new MemStorage(), configurable: true, writable: true });
}

// ── Canvas 2D stub ──────────────────────────────────────────────────────────
// jsdom has no canvas backend. lottie-web (loaded eagerly by the ds/Icon barrel)
// probes a 2D context at import, and MagicUI effects (CoolMode, particles) paint
// on <canvas>. Return a no-op context so these modules load and render under jsdom.
const gradientStub = { addColorStop: vi.fn() };
const ctx2dStub = new Proxy(
  {
    getImageData: () => ({ data: [] }),
    createLinearGradient: () => gradientStub,
    createRadialGradient: () => gradientStub,
    measureText: () => ({ width: 0 }),
  } as Record<string, unknown>,
  { get: (t, p) => (p in t ? t[p as string] : vi.fn()), set: () => true },
);
HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx2dStub) as unknown as HTMLCanvasElement['getContext'];

// ── Observer stubs ──────────────────────────────────────────────────────────
// jsdom ships neither ResizeObserver (used by AnimatedBeam) nor
// IntersectionObserver (used by BlurFade via framer-motion useInView).
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver = ObserverStub as unknown as typeof IntersectionObserver;

// ── Capacitor plugin mocks ──────────────────────────────────────────────────
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    getCurrentPosition: vi.fn(async () => ({ coords: { latitude: 22.5726, longitude: 88.3639, accuracy: 10 } })),
    watchPosition: vi.fn(async () => 'watch-1'),
    clearWatch: vi.fn(async () => {}),
    checkPermissions: vi.fn(async () => ({ location: 'granted' })),
    requestPermissions: vi.fn(async () => ({ location: 'granted' })),
  },
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    register: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    removeAllListeners: vi.fn(async () => {}),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
    checkPermissions: vi.fn(async () => ({ receive: 'granted' })),
  },
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn(async () => {}), notification: vi.fn(async () => {}) },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async () => {}) } }));
