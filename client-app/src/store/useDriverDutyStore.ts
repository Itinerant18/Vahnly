import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  dutyState: DutyState;
  setDutyState: (state: DutyState) => void;
}

export const useDriverDutyStore = create<DriverDutyStore>()(
  persist(
    (set) => ({
      dutyState: 'OFFLINE',
      setDutyState: (dutyState) => set({ dutyState }),
    }),
    {
      name: 'driver-duty-storage',
    }
  )
);
