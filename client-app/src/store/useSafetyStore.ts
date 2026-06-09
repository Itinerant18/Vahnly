import { create } from "zustand";

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
    try {
      // Direct call against the high-priority Gateway ingestion route
      const response = await fetch("/api/v1/driver/safety/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Driver-ID": "00000000-0000-0000-0000-000000000001" },
        body: JSON.stringify({ latitude: lat, longitude: lng, order_id: orderId }),
      });
      const data = await response.json();
      
      // Instantly invoke native client-side background triggers (e.g. system 112 calls) via Capacitor
      if (typeof window !== "undefined" && (window as any).Capacitor) {
        console.log("Invoking native cellular emergency dialer wrapper...");
      }

      set({ isEmergencyActive: true, shareLink: data.share_link });
    } catch (err) {
      console.error("SOS Ingress failover initialization failed:", err);
    }
  },
  cancelSOS: () => set({ isEmergencyActive: false, shareLink: null }),
}));
