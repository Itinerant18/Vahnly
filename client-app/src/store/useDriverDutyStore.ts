import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Order } from '../types/order';

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
  setDutyState: (state: DutyState) => void;
  setActiveOrder: (order: Order | null) => void;
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
      setDutyState: (dutyState) => {
        const current = get().state;
        if (isTransitionValid(current, dutyState)) {
          set({ dutyState, state: dutyState });
        } else {
          console.warn(`[STATE_MACHINE] Illegal transition from ${current} to ${dutyState}`);
        }
      },
      setActiveOrder: (activeOrder) => set({ activeOrder }),
    }),
    {
      name: 'driver-duty-storage',
    }
  )
);
