import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Order } from '../types/order';
import { setDriverDutyState, respondToOffer } from '@/api/client';
import { useAuthStore } from './useAuthStore';

export type DutyState =
  | 'OFFLINE'
  | 'ONLINE'
  | 'OFFER_PENDING'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'EMERGENCY';

interface DriverDutyStore {
  dutyState: DutyState; // Backward compatibility with page.tsx
  state: DutyState;     // Matches user's exact specification
  activeOrder: Order | null;
  currentOffer: any | null;
  setDutyState: (state: DutyState) => void;
  setActiveOrder: (order: Order | null) => void;
  toggleOnlineStatus: (lat: number, lng: number) => Promise<void>;
  receiveOffer: (offerData: any) => void;
  respondToOffer: (orderId: string, response: 'ACCEPT' | 'DECLINE', reason?: string) => Promise<void>;
}

const validTransitions: Record<DutyState, DutyState[]> = {
  OFFLINE: ['ONLINE'],
  ONLINE: ['OFFLINE', 'OFFER_PENDING'],
  OFFER_PENDING: ['ONLINE', 'EN_ROUTE'],
  EN_ROUTE: ['ARRIVED', 'ONLINE'], // ONLINE if cancelled
  ARRIVED: ['DELIVERING', 'ONLINE'], // ONLINE if cancelled/no-show
  DELIVERING: ['COMPLETED'],
  COMPLETED: ['ONLINE'],
  EMERGENCY: ['ONLINE', 'OFFLINE'],
};

const isTransitionValid = (from: DutyState, to: DutyState): boolean => {
  if (to === 'EMERGENCY' || from === 'EMERGENCY') {
    return true;
  }
  const allowed = validTransitions[from];
  return allowed ? allowed.includes(to) : false;
};

export const useDriverDutyStore = create<DriverDutyStore>()(
  persist(
    (set, get) => ({
      dutyState: 'OFFLINE',
      state: 'OFFLINE',
      activeOrder: null,
      currentOffer: null,

      setDutyState: (dutyState) => {
        const current = get().state;
        if (isTransitionValid(current, dutyState)) {
          set({ dutyState, state: dutyState });
        } else {
          console.warn(`[STATE_MACHINE] Illegal transition from ${current} to ${dutyState}`);
        }
      },

      setActiveOrder: (activeOrder) => set({ activeOrder }),

      toggleOnlineStatus: async (lat, lng) => {
        const token = useAuthStore.getState().token;
        if (!token) {
          console.warn('[DutyStore] Missing token for toggleOnlineStatus');
          return;
        }
        const currentState = get().state;
        const newState = currentState === 'OFFLINE' ? 'ONLINE' : 'OFFLINE';

        try {
          await setDriverDutyState(token, newState, lat, lng);
          if (isTransitionValid(currentState, newState)) {
            set({ dutyState: newState, state: newState });
          } else {
            set({ dutyState: newState, state: newState });
          }
        } catch (err) {
          console.error('[DutyStore] Failed toggle online status:', err);
          throw err;
        }
      },

      receiveOffer: (offerData) => {
        // Only accept offers if currently ONLINE (prevents race conditions)
        if (get().state === 'ONLINE') {
          set({ dutyState: 'OFFER_PENDING', state: 'OFFER_PENDING', currentOffer: offerData });
        }
      },

      respondToOffer: async (orderId, response, reason) => {
        const token = useAuthStore.getState().token;
        if (!token) {
          console.warn('[DutyStore] Missing token for respondToOffer');
          return;
        }

        try {
          const apiResponse = response === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
          const correlationId = `${orderId}-1`;
          await respondToOffer(token, orderId, apiResponse, reason, correlationId);
          if (response === 'ACCEPT') {
            set({ dutyState: 'EN_ROUTE', state: 'EN_ROUTE', currentOffer: null });
          } else {
            set({ dutyState: 'ONLINE', state: 'ONLINE', currentOffer: null }); // Go back to searching
          }
        } catch (err) {
          console.error("Offer expired or taken", err);
          set({ dutyState: 'ONLINE', state: 'ONLINE', currentOffer: null });
        }
      }
    }),
    {
      name: 'driver-duty-storage',
    }
  )
);
