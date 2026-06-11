"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RiderStreamManager } from "@/lib/websocket/RiderStreamManager";
import type { RiderWebSocketMessage } from "@/lib/websocket/types";
import { useTripStore } from "@/lib/store/tripStore";
import { useNotificationStore } from "@/lib/store/notificationStore";
import { ordersApi } from "@/lib/api/orders";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { StatusBanner } from "@/components/trip/StatusBanner";
import { DriverCard } from "@/components/trip/DriverCard";
import { OTPDisplay } from "@/components/trip/OTPDisplay";
import { SOSModal } from "@/components/trip/SOSModal";
import { RideCheckModal } from "@/components/trip/RideCheckModal";
import { ShareTripSheet } from "@/components/trip/ShareTripSheet";

const TripMap = dynamic(() => import("@/components/trip/TripMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#0A0A0A]" />,
});

function FAB({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-3 ${danger ? "bg-[#EF4444] shadow-lg shadow-[#EF4444]/30" : "bg-[#141414]/90 ring-1 ring-white/10"}`}
    >
      <span className="text-xl leading-none">{icon}</span>
      <span className={`text-[9px] font-medium ${danger ? "text-white" : "text-[#9CA3AF]"}`}>{label}</span>
    </button>
  );
}

function CancelConfirmSheet({ onCancel, onClose }: { onCancel: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-[#141414] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <h3 className="text-base font-bold text-white">Cancel Trip?</h3>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Cancellations within 3 minutes of assignment are free. After that, a ₹50 fee may apply.
        </p>
        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl bg-[#1E1E1E] py-3 text-sm text-[#9CA3AF]">Keep trip</button>
          <button onClick={onCancel} className="flex-1 rounded-xl bg-[#EF4444]/10 py-3 text-sm font-semibold text-[#EF4444]">Cancel trip</button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}

export default function LiveTripView({ tripId }: { tripId: string }) {
  const router = useRouter();

  // Store selectors
  const activeOrder = useTripStore((s) => s.activeOrder);
  const driverLocation = useTripStore((s) => s.driverLocation);
  const driverBearing = useTripStore((s) => s.driverBearing);
  const driverETA = useTripStore((s) => s.driverETA);
  const tripStatus = useTripStore((s) => s.tripStatus);

  // UI state
  const [showSOS, setShowSOS] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [rideCheckMsg, setRideCheckMsg] = useState<string | null>(null);
  const [addStopInput, setAddStopInput] = useState(false);

  const pickup = activeOrder
    ? { lat: activeOrder.pickup_lat, lng: activeOrder.pickup_lng }
    : null;
  const dropoff =
    activeOrder?.dropoff_lat && activeOrder?.dropoff_lng
      ? { lat: activeOrder.dropoff_lat, lng: activeOrder.dropoff_lng }
      : null;

  // WS + event handlers
  useEffect(() => {
    const trip = useTripStore.getState();
    const notif = useNotificationStore.getState();

    const manager = new RiderStreamManager({
      onStatusChange: (s) => trip.setWsConnected(s === "CONNECTED"),
      onMessage: (msg: RiderWebSocketMessage) => {
        switch (msg.type) {
          case "rider.order.assigned":
            trip.updateStatus("ASSIGNED");
            trip.setDriverInfo({
              driverId: msg.data.driver_id,
              name: msg.data.driver_name,
              photo: msg.data.driver_photo,
              rating: msg.data.driver_rating,
              tripsCount: msg.data.driver_trips_count,
              vehicleContext: msg.data.vehicle_context,
              etaMinutes: msg.data.eta_minutes,
              bearing: 0,
            });
            break;
          case "rider.driver.location":
            trip.updateDriverLocation(
              { lat: msg.data.lat, lng: msg.data.lng },
              msg.data.eta_minutes,
              msg.data.bearing,
            );
            break;
          case "rider.driver.arrived":
            trip.updateStatus("ARRIVED_AT_PICKUP");
            break;
          case "rider.trip.started":
            trip.updateStatus("DELIVERING");
            break;
          case "rider.trip.completed":
            trip.updateStatus("COMPLETED");
            trip.setCompletedFare({
              orderId: msg.data.order_id,
              totalFarePaise: msg.data.total_fare_paise,
              fareBreakdown: msg.data.fare_breakdown,
              distanceKm: msg.data.distance_km,
              durationMinutes: msg.data.duration_minutes,
            });
            // Navigate to bill screen
            setTimeout(() => router.replace("/trip/bill"), 800);
            break;
          case "rider.trip.cancelled":
            trip.updateStatus("CANCELLED");
            setTimeout(() => router.replace("/home"), 1500);
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
            setRideCheckMsg(msg.data.message);
            break;
        }
      },
    });
    manager.connect();
    return () => manager.disconnect();
  }, [tripId, router]);

  const handleCancel = useCallback(async () => {
    setShowCancel(false);
    try {
      await useTripStore.getState().cancelTrip("RIDER_CHANGED_MIND");
      router.replace("/home");
    } catch {}
  }, [router]);

  const handleAddStop = async (address: string) => {
    if (!activeOrder) return;
    setAddStopInput(false);
    try {
      await ordersApi.addStop(activeOrder.id, { lat: pickup?.lat ?? 0, lng: pickup?.lng ?? 0, address });
    } catch {}
  };

  const inTrip = tripStatus === "DELIVERING";

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#0A0A0A]">
      {/* Full-screen map */}
      <div className="absolute inset-0 z-0">
        <TripMap
          pickup={pickup}
          dropoff={dropoff}
          driverLat={driverLocation?.lat ?? null}
          driverLng={driverLocation?.lng ?? null}
          driverBearing={driverBearing}
          tripStatus={tripStatus}
          etaMinutes={driverETA}
        />
      </div>

      {/* Status banner — top */}
      <div className="absolute inset-x-4 top-4 z-20">
        <StatusBanner status={tripStatus} />
      </div>

      {/* Right-side FABs (DELIVERING only) + SOS always */}
      <div className="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2">
        {inTrip && (
          <>
            <FAB icon="+" label="Stop" onClick={() => setAddStopInput(true)} />
            <FAB icon="↗" label="Drop" onClick={() => {}} />
            <FAB icon="⏱" label="Extend" onClick={() => {}} />
          </>
        )}
        <FAB icon="🆘" label="SOS" onClick={() => setShowSOS(true)} danger />
      </div>

      {/* Bottom panel */}
      <div className="absolute inset-x-0 bottom-0 z-20 space-y-2 pb-[80px] pt-2 px-4">

        {/* In-trip fare */}
        {inTrip && activeOrder && (
          <div className="flex items-center justify-between rounded-2xl bg-[#141414]/90 px-4 py-2.5 backdrop-blur-sm ring-1 ring-white/8">
            <span className="text-xs text-[#9CA3AF]">Est. fare</span>
            <span className="text-sm font-semibold text-white">
              {formatCurrency(activeOrder.base_fare_paise)}
            </span>
          </div>
        )}

        {/* OTP (ARRIVED_AT_PICKUP) */}
        <OTPDisplay />

        {/* Driver card */}
        <DriverCard
          onCall={() => {
            // No phone number exposed in WS — stub
            if (typeof window !== "undefined") window.open("tel:", "_self");
          }}
          onShare={() => setShowShare(true)}
          onCancel={() => setShowCancel(true)}
        />
      </div>

      {/* Add Stop input */}
      {addStopInput && (
        <div className="absolute inset-x-4 bottom-48 z-30">
          <div className="flex overflow-hidden rounded-xl bg-[#141414] ring-1 ring-white/10">
            <input
              autoFocus
              className="flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder:text-[#9CA3AF] outline-none"
              placeholder="Enter stop address"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddStop((e.target as HTMLInputElement).value);
                if (e.key === "Escape") setAddStopInput(false);
              }}
            />
            <button onClick={() => setAddStopInput(false)} className="px-3 text-[#9CA3AF]">✕</button>
          </div>
        </div>
      )}

      {/* SOS Modal */}
      {showSOS && <SOSModal onClose={() => setShowSOS(false)} />}

      {/* Share Trip Sheet */}
      {showShare && <ShareTripSheet onClose={() => setShowShare(false)} />}

      {/* Cancel Confirm Sheet */}
      {showCancel && (
        <CancelConfirmSheet onCancel={handleCancel} onClose={() => setShowCancel(false)} />
      )}

      {/* Ride Check Modal */}
      {rideCheckMsg && (
        <RideCheckModal
          message={rideCheckMsg}
          onOk={() => setRideCheckMsg(null)}
          onSOS={() => { setRideCheckMsg(null); setShowSOS(true); }}
        />
      )}
    </div>
  );
}
