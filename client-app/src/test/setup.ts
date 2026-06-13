import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests so queries never see stale DOM.
afterEach(() => cleanup());

// ── Deterministic web storage ───────────────────────────────────────────────
// jsdom's localStorage is flaky under vitest v4 (setItem can be missing), which
// breaks zustand's persist middleware. Install a clean in-memory Storage so
// persistence behaves identically every run.
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

// ── Capacitor plugin mocks ──────────────────────────────────────────────────
// The driver app boots native plugins at import time; stub them so components
// render under jsdom (web, non-native) without touching device APIs.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  },
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn(async () => {}), notification: vi.fn(async () => {}) },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: vi.fn(async () => ({ uri: 'file://stub' })), readFile: vi.fn(async () => ({ data: '' })) },
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async () => {}) } }));
