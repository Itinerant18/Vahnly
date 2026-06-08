import { create } from 'zustand';
import { OrderOffer, respondToOffer } from '@/api/client';
import { useDriverDutyStore } from './useDriverDutyStore';

interface OfferState {
  currentOffer: OrderOffer | null;
  status: 'IDLE' | 'OFFER_PENDING' | 'ACCEPTED' | 'DECLINED';
  offerReceivedTs: string | null;
  offerRespondedTs: string | null;
  declineReason: string | null;
  latencySeconds: number | null;
  setOffer: (offer: OrderOffer) => void;
  clearOffer: () => void;
  acceptOffer: (token: string, driverID: string) => Promise<boolean>;
  declineOffer: (token: string, driverID: string, reason: string) => Promise<boolean>;
}

export const useOfferStore = create<OfferState>((set, get) => ({
  currentOffer: null,
  status: 'IDLE',
  offerReceivedTs: null,
  offerRespondedTs: null,
  declineReason: null,
  latencySeconds: null,

  setOffer: (offer) => set({
    currentOffer: offer,
    status: 'OFFER_PENDING',
    offerReceivedTs: new Date().toISOString(),
    offerRespondedTs: null,
    declineReason: null,
    latencySeconds: null,
  }),

  clearOffer: () => set({
    currentOffer: null,
    status: 'IDLE',
    offerReceivedTs: null,
    offerRespondedTs: null,
    declineReason: null,
    latencySeconds: null,
  }),

  acceptOffer: async (token, driverID) => {
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
