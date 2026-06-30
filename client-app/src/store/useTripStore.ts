import { create } from 'zustand';
import { BASE_URL } from '@/api/client';
import { useAuthStore } from './useAuthStore';

interface TripState {
  waitTimerSeconds: number;
  isOTPValidating: boolean;
  activeRoutePolyline: string | null;
  
  markArrived: (orderId: string) => Promise<void>;
  startTrip: (orderId: string, otp: string, odo: number, fuel: number) => Promise<boolean>;
  logMidTripEvent: (orderId: string, type: 'TOLL' | 'PARKING', amount: number) => Promise<void>;
}

export const useTripStore = create<TripState>((set) => ({
  waitTimerSeconds: 0,
  isOTPValidating: false,
  activeRoutePolyline: null,

  markArrived: async (orderId) => {
    const token = useAuthStore.getState().token;
    await fetch(`${BASE_URL}/api/v1/driver/orders/${orderId}/arrived`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Region-Prefix': 'KOL'
      }
    });
  },

  startTrip: async (orderId, otp, odo, fuel) => {
    set({ isOTPValidating: true });
    const token = useAuthStore.getState().token;
    try {
      const response = await fetch(`${BASE_URL}/api/v1/driver/orders/${orderId}/verify-start`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Region-Prefix': 'KOL'
        },
        body: JSON.stringify({
          otp,
          start_odometer: odo,
          fuel_percentage: fuel
        })
      });
      if (!response.ok) {
        throw new Error('Verification failed');
      }
      return true;
    } catch (error) {
      console.error("OTP Invalid or Telemetry Error", error);
      return false;
    } finally {
      set({ isOTPValidating: false });
    }
  },

  logMidTripEvent: async (orderId, type, amount) => {
    const token = useAuthStore.getState().token;
    const eventType = type === 'TOLL' ? 'ADD_TOLL' : 'ADD_STOP';
    await fetch(`${BASE_URL}/api/v1/driver/orders/${orderId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Region-Prefix': 'KOL'
      },
      body: JSON.stringify({
        event_type: eventType,
        amount_paise: amount * 100,
        description: `Mid-trip mutation: ${type}`
      })
    });
  }
}));
