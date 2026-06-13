"use client";

import { useEffect, useState } from "react";
import { RiderStreamManager } from "@/lib/websocket/RiderStreamManager";
import type { RiderWebSocketMessage } from "@/lib/websocket/types";
import { useTripStore } from "@/lib/store/tripStore";
import { useNotificationStore } from "@/lib/store/notificationStore";
import { LiveMap } from "@/components/map/LiveMap";
import { StatusBanner } from "@/components/trip/StatusBanner";
import { DriverCard } from "@/components/trip/DriverCard";
import { OTPDisplay } from "@/components/trip/OTPDisplay";
import { TripActions } from "@/components/trip/TripActions";

export default function LiveTripView({ tripId }: { tripId: string }) {
  const driverLocation = useTripStore((s) => s.driverLocation);
  const tripStatus = useTripStore((s) => s.tripStatus);
  const [rideCheck, setRideCheck] = useState<string | null>(null);

  useEffect(() => {
    // Use getState() inside handlers so the effect needs no store deps.
    const trip = useTripStore.getState();
    const notif = useNotificationStore.getState();

    const manager = new RiderStreamManager({
      onStatusChange: (s) => useTripStore.getState().setWsConnected(s === "CONNECTED"),
      onMessage: (msg: RiderWebSocketMessage) => {
        switch (msg.type) {
          case "rider.driver.location":
            trip.updateDriverLocation({ lat: msg.data.lat, lng: msg.data.lng }, msg.data.eta_minutes);
            break;
          case "rider.order.assigned":
            trip.updateStatus("ASSIGNED");
            break;
          case "rider.driver.arrived":
            trip.updateStatus("ARRIVED_AT_PICKUP");
            break;
          case "rider.trip.started":
            trip.updateStatus("DELIVERING");
            break;
          case "rider.trip.completed":
            trip.updateStatus("COMPLETED");
            break;
          case "rider.trip.cancelled":
            trip.updateStatus("CANCELLED");
            break;
          case "rider.notification":
            notif.addNotification({
              id: crypto.randomUUID(),
              rider_id: "",
              type: msg.data.type,
              title: msg.data.title,
              body: msg.data.body,
              data: msg.data.data,
              is_read: false,
              created_at: new Date().toISOString(),
            });
            break;
          case "rider.ride_check":
            setRideCheck(msg.data.message);
            break;
        }
      },
    });
    manager.connect();
    return () => manager.disconnect();
  }, [tripId]);

  return (
    <main className="relative min-h-screen">
      <LiveMap driver={driverLocation} />
      <div className="absolute inset-x-0 top-0 p-4">
        <StatusBanner status={tripStatus} />
      </div>
      <div className="absolute inset-x-0 bottom-0 space-y-3 p-4">
        <DriverCard />
        <OTPDisplay />
        <TripActions tripId={tripId} />
      </div>

      {rideCheck && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-xl bg-background-secondary p-5">
            <h2 className="text-lg font-semibold">Everything OK?</h2>
            <p className="mt-1 text-sm text-content-secondary">{rideCheck}</p>
            <div className="mt-4 flex gap-3">
              <button
                className="flex-1 rounded-lg bg-surface-positive py-2 text-content-positive"
                onClick={() => setRideCheck(null)}
              >
                I&apos;m OK
              </button>
              <button className="flex-1 rounded-lg bg-surface-negative py-2 text-content-negative">
                Get help
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
