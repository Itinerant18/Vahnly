import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { saveOnboardingStep } from '@/api/client';

interface OnboardingState {
  step: number;
  data: Record<string, any>;
  isLoading: boolean;
  lastSyncError: string | null;
  updateData: (partialData: Record<string, any>) => void;
  setStep: (step: number) => void;
  clearStore: () => void;
  submitStepToServer: (token: string, stepId: number, payload: Record<string, any>) => Promise<boolean>;
}

export const useDriverOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      step: 1,
      data: {},
      isLoading: false,
      lastSyncError: null,

      updateData: (partialData) =>
        set((state) => ({ data: { ...state.data, ...partialData } })),

      setStep: (step) => set({ step }),

      clearStore: () => set({ step: 1, data: {}, isLoading: false, lastSyncError: null }),

      submitStepToServer: async (token: string, stepId: number, payload: Record<string, any>) => {
        set({ isLoading: true, lastSyncError: null });
        try {
          await saveOnboardingStep(token, stepId, payload);
          // Merge payload into local data on success
          const currentData = get().data;
          set({
            data: { ...currentData, ...payload },
            isLoading: false,
          });
          return true;
        } catch (err: any) {
          const errorMsg = err?.message || String(err);
          set({ isLoading: false, lastSyncError: errorMsg });
          // Cache the failed payload for offline retry
          try {
            const offlineQueue = JSON.parse(localStorage.getItem('driver-onboarding-offline-queue') || '[]');
            offlineQueue.push({
              stepId,
              payload,
              timestamp: new Date().toISOString(),
            });
            localStorage.setItem('driver-onboarding-offline-queue', JSON.stringify(offlineQueue));
          } catch {
            // localStorage unavailable — silently drop
          }
          return false;
        }
      },
    }),
    {
      name: 'driver-onboarding-storage',
    }
  )
);
