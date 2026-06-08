import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OnboardingState {
  step: number;
  data: Record<string, any>;
  updateData: (partialData: Record<string, any>) => void;
  setStep: (step: number) => void;
  clearStore: () => void;
}

export const useDriverOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      step: 1,
      data: {},
      updateData: (partialData) =>
        set((state) => ({ data: { ...state.data, ...partialData } })),
      setStep: (step) => set({ step }),
      clearStore: () => set({ step: 1, data: {} }),
    }),
    {
      name: 'driver-onboarding-storage',
    }
  )
);
