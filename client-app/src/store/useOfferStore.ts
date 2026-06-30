import { create } from 'zustand';
import { OrderOffer, respondToOffer, getPendingOffer } from '@/api/client';
import { useDriverDutyStore } from './useDriverDutyStore';

const DEFAULT_OFFER_WINDOW_SECONDS = 15;

interface OfferState {
  currentOffer: OrderOffer | null;
  status: 'IDLE' | 'OFFER_PENDING' | 'ACCEPTED' | 'DECLINED';
  offerReceivedTs: string | null;
  offerRespondedTs: string | null;
  declineReason: string | null;
  latencySeconds: number | null;
  // Absolute expiry timestamp (ms). Drives a clock-based countdown that survives tab
  // backgrounding and component remounts, unlike a decrementing counter.
  offerExpiresAt: number | null;
  setOffer: (offer: OrderOffer, expiresInSeconds?: number) => void;
  clearOffer: () => void;
  acceptOffer: (token: string, driverID: string) => Promise<boolean>;
  declineOffer: (token: string, driverID: string, reason: string) => Promise<boolean>;
  // Re-sync local offer state with the server (used on reconnect / popup mount) so a
  // dropped WS connection cannot leave the driver stuck on a stale OFFER_PENDING.
  reconcilePendingOffer: (token: string) => Promise<void>;
}

export const useOfferStore = create<OfferState>((set, get) => ({
  currentOffer: null,
  status: 'IDLE',
  offerReceivedTs: null,
  offerRespondedTs: null,
  declineReason: null,
  latencySeconds: null,
  offerExpiresAt: null,

  setOffer: (offer, expiresInSeconds) => set({
    currentOffer: offer,
    status: 'OFFER_PENDING',
    offerReceivedTs: new Date().toISOString(),
    offerRespondedTs: null,
    declineReason: null,
    latencySeconds: null,
    offerExpiresAt: Date.now() + (expiresInSeconds ?? DEFAULT_OFFER_WINDOW_SECONDS) * 1000,
  }),

  clearOffer: () => set({
    currentOffer: null,
    status: 'IDLE',
    offerReceivedTs: null,
    offerRespondedTs: null,
    declineReason: null,
    latencySeconds: null,
    offerExpiresAt: null,
  }),

  reconcilePendingOffer: async (token) => {
    if (get().status !== 'OFFER_PENDING') return;
    try {
      const res = await getPendingOffer(token);
      if (!res.order) {
        // Server no longer holds an offer for this driver (expired or reassigned). Clear
        // the stale local state and return the driver to ONLINE instead of hanging.
        get().clearOffer();
        useDriverDutyStore.getState().setDutyState('ONLINE');
      } else if (res.offer_expires_in_seconds != null) {
        // Re-anchor the countdown to the server's authoritative remaining window.
        set({ offerExpiresAt: Date.now() + res.offer_expires_in_seconds * 1000 });
      }
    } catch (err) {
      console.warn('Failed to reconcile pending offer:', err);
    }
  },

  acceptOffer: async (token) => {
    const { currentOffer, offerReceivedTs } = get();
    if (!currentOffer) return false;

    const respondedTs = new Date().toISOString();
    const latency = offerReceivedTs ? (new Date(respondedTs).getTime() - new Date(offerReceivedTs).getTime()) / 1000 : 0;

    // Optimistic UI state updates
    set({
      status: 'ACCEPTED',
      offerRespondedTs: respondedTs,
      latencySeconds: latency,
    });

    // Optimistically transition main duty state to EN_ROUTE
    useDriverDutyStore.getState().setDutyState('EN_ROUTE');

    try {
      const correlationId = `${currentOffer.orderId}-1`;
      const res = await respondToOffer(token, currentOffer.orderId, 'ACCEPTED', undefined, correlationId);
      return res.success;
    } catch (err) {
      console.error('Failed to accept offer:', err);
      // Revert if API failed
      set({ status: 'OFFER_PENDING' });
      useDriverDutyStore.getState().setDutyState('OFFER_PENDING');
      return false;
    }
  },

  declineOffer: async (token, driverID, reason) => {
    const { currentOffer, offerReceivedTs } = get();
    if (!currentOffer) return false;

    const respondedTs = new Date().toISOString();
    const latency = offerReceivedTs ? (new Date(respondedTs).getTime() - new Date(offerReceivedTs).getTime()) / 1000 : 0;

    set({
      status: 'DECLINED',
      offerRespondedTs: respondedTs,
      declineReason: reason,
      latencySeconds: latency,
    });

    useDriverDutyStore.getState().setDutyState('ONLINE');

    try {
      const correlationId = `${currentOffer.orderId}-1`;
      const res = await respondToOffer(token, currentOffer.orderId, 'DECLINED', reason, correlationId);
      set({ currentOffer: null, status: 'IDLE' });
      return res.success;
    } catch (err) {
      console.error('Failed to decline offer:', err);
      return false;
    }
  },
}));
