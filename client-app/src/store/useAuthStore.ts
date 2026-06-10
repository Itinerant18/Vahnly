import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  role: 'RIDER' | 'DRIVER' | 'ADMIN';
  name: string;
  phone: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      login: (token, user) => set({ token, user, isAuthenticated: true }),
      logout: () => {
        // Purge any session-scoped caches that may hold tokens or PII.
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem('onboarding-offline-queue');
          } catch {
            // ignore storage errors
          }
        }
        set({ token: null, user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'platform-auth-storage', // Persists to localStorage automatically
    }
  )
);
