import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  role: 'RIDER' | 'DRIVER' | 'ADMIN';
  name: string;
  phone: string;
  phone_verified?: boolean;
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (token: string, user: User, refreshToken?: string) => void;
  updateTokens: (token: string, refreshToken?: string) => void;
  logout: () => void;
  setPhoneVerified: (verified: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      login: (token, user, refreshToken) =>
        set({ token, user, refreshToken: refreshToken ?? null, isAuthenticated: true }),
      // Swap in a freshly-refreshed access token (and rotated refresh token) without disturbing
      // the user object — called by the request() refresh-on-401 path.
      updateTokens: (token, refreshToken) =>
        set((s) => ({ token, refreshToken: refreshToken ?? s.refreshToken })),
      logout: () => {
        // Purge any session-scoped caches that may hold tokens or PII.
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem('onboarding-offline-queue');
          } catch {
            // ignore storage errors
          }
        }
        set({ token: null, refreshToken: null, user: null, isAuthenticated: false });
      },
      setPhoneVerified: (verified) => {
        set((state) => {
          if (!state.user) return {};
          return {
            user: {
              ...state.user,
              phone_verified: verified,
            },
          };
        });
      },
    }),
    {
      name: 'platform-auth-storage', // Persists to localStorage automatically
    }
  )
);
