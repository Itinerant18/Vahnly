import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAuthStore } from "./useAuthStore";

interface OfflineCachedPacket {
  type: "TELEMETRY" | "TRIP_EVENT" | "CHECKPOINT";
  payload: any;
  captured_at: string;
}

interface OfflineCacheState {
  cachedQueue: OfflineCachedPacket[];
  queueOfflinePacket: (type: "TELEMETRY" | "TRIP_EVENT" | "CHECKPOINT", payload: any) => void;
  flushOfflineCache: (orderId: string) => Promise<void>;
  clearCache: () => void;
}

export const useOfflineCacheStore = create<OfflineCacheState>()(
  persist(
    (set, get) => ({
      cachedQueue: [],
      queueOfflinePacket: (type, payload) => {
        const newPacket: OfflineCachedPacket = {
          type,
          payload,
          captured_at: new Date().toISOString(),
        };
        set((state) => ({ cachedQueue: [...state.cachedQueue, newPacket] }));
        console.warn(`[Network Offline] Intercepted packet type [${type}]. Buffered inside client memory.`);
      },
      flushOfflineCache: async (orderId) => {
        const queue = get().cachedQueue;
        if (queue.length === 0) return;

        console.log(`[Network Online] Reconnect detected. Flushing ${queue.length} cached packets...`);

        const token = useAuthStore.getState().token;
        if (!token) {
          console.warn("[Network Sync] No authenticated session; holding cache until login.");
          return;
        }
        // Driver identity is derived server-side from this JWT. Do not send X-Driver-ID.
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        };

        try {
          const response = await fetch("/api/v1/driver/sync/offline-payload", {
            method: "POST",
            headers,
            body: JSON.stringify({
              order_id: orderId,
              device_fingerprint: typeof navigator !== "undefined" ? navigator.userAgent : "NodeJS-App",
              packets: queue,
            }),
          });

          if (response.ok) {
            set({ cachedQueue: [] });
            console.log("[Network Sync] Cache flushed and synchronized with gateway.");
          }
        } catch (error) {
          console.error("[Network Sync] Flush operation failed, holding cache queue:", error);
        }
      },
      clearCache: () => set({ cachedQueue: [] }),
    }),
    { name: "driver-offline-telemetry-cache" }
  )
);
