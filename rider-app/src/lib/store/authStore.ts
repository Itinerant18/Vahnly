import { create } from "zustand";
import { authApi } from "../api/auth";
import { setUnauthorizedHandler, TOKEN_STORAGE_KEY } from "../api/client";
import type { Rider } from "../api/types";

const RIDER_STORAGE_KEY = "dfu_rider_profile";

function loadToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

function loadRider(): Rider | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(RIDER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Rider;
  } catch {
    return null;
  }
}

function persistToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function persistRider(rider: Rider | null): void {
  if (typeof window === "undefined") return;
  if (rider) window.sessionStorage.setItem(RIDER_STORAGE_KEY, JSON.stringify(rider));
  else window.sessionStorage.removeItem(RIDER_STORAGE_KEY);
}

export interface AuthState {
  rider: Rider | null;
  token: string | null;
  isNewRider: boolean;
  isLoading: boolean;

  sendOTP: (phone: string) => Promise<void>;
  verifyOTP: (
    phone: string,
    otp: string,
    referredByCode?: string,
  ) => Promise<{ isNew: boolean }>;
  googleLogin: (
    idToken: string,
    regData?: { phone: string; otp: string; name?: string; referred_by_code?: string },
  ) => Promise<{
    registered: boolean;
    isNew?: boolean;
    email?: string;
    name?: string;
  }>;
  fetchMe: () => Promise<void>;
  logout: () => void;
  setToken: (token: string) => void;
  setRider: (rider: Rider) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  rider: loadRider(),
  token: loadToken(),
  isNewRider: false,
  isLoading: false,

  sendOTP: async (phone: string) => {
    set({ isLoading: true });
    try {
      await authApi.sendOTP(phone);
    } finally {
      set({ isLoading: false });
    }
  },

  verifyOTP: async (phone: string, otp: string, referredByCode?: string) => {
    set({ isLoading: true });
    try {
      const res = await authApi.verifyOTP(phone, otp, referredByCode);
      persistToken(res.token);
      persistRider(res.rider);
      set({ token: res.token, rider: res.rider, isNewRider: res.is_new_rider });
      return { isNew: res.is_new_rider };
    } finally {
      set({ isLoading: false });
    }
  },

  googleLogin: async (
    idToken: string,
    regData?: { phone: string; otp: string; name?: string; referred_by_code?: string },
  ) => {
    set({ isLoading: true });
    try {
      const res = await authApi.googleLogin(idToken, regData);
      if (res.registered === false) {
        return {
          registered: false,
          email: res.email,
          name: res.name,
        };
      }
      persistToken(res.token ?? null);
      persistRider(res.rider ?? null);
      set({
        token: res.token ?? null,
        rider: res.rider ?? null,
        isNewRider: res.is_new_rider ?? false,
      });
      return { registered: true, isNew: res.is_new_rider };
    } finally {
      set({ isLoading: false });
    }
  },

  fetchMe: async () => {
    const rider = await authApi.me();
    persistRider(rider);
    set({ rider });
  },

  logout: () => {
    persistToken(null);
    persistRider(null);
    set({ token: null, rider: null, isNewRider: false });
    if (typeof window !== "undefined") window.location.href = "/login";
  },

  setToken: (token: string) => {
    persistToken(token);
    set({ token });
  },

  setRider: (rider: Rider) => {
    persistRider(rider);
    set({ rider });
  },
}));

// Wire the API client's 401 handler to the store logout (no import cycle).
setUnauthorizedHandler(() => useAuthStore.getState().logout());
