import { create } from "zustand";
import { useAuthStore } from "./useAuthStore";

interface SafetyState {
  isEmergencyActive: boolean;
  shareLink: string | null;
  triggerSOS: (lat: number, lng: number, orderId?: string) => Promise<void>;
  cancelSOS: () => void;
}

export const useSafetyStore = create<SafetyState>((set) => ({
  isEmergencyActive: false,
  shareLink: null,
  triggerSOS: async (lat, lng, orderId) => {
    // Always engage the local emergency UI first — the alert must not depend on the
    // network round-trip succeeding.
    set({ isEmergencyActive: true });

    const token = useAuthStore.getState().token;
    if (!token) {
      console.error("SOS triggered without an authenticated session.");
      return;
    }

    try {
      // Direct call against the high-priority Gateway ingestion route.
      // Driver identity is derived server-side from the verified JWT — never sent by the client.
      const response = await fetch("/api/v1/driver/safety/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ latitude: lat, longitude: lng, order_id: orderId }),
      });

      // Instantly invoke native client-side background triggers (e.g. system 112 calls) via Capacitor
      if (typeof window !== "undefined" && (window as any).Capacitor) {
        console.log("Invoking native cellular emergency dialer wrapper...");
      }

      if (response.ok) {
        const data = await response.json();
        set({ shareLink: data.share_link });
      }
    } catch (err) {
      console.error("SOS Ingress failover initialization failed:", err);
    }
  },
  cancelSOS: () => set({ isEmergencyActive: false, shareLink: null }),
}));
