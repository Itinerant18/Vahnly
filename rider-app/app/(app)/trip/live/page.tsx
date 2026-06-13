"use client";

import { useTripStore } from "@/lib/store/tripStore";
import LiveTripView from "../LiveTripView";
import { SentryErrorBoundary } from "@/components/SentryErrorBoundary";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LiveTripPage() {
  const activeOrder = useTripStore((s) => s.activeOrder);
  const router = useRouter();

  useEffect(() => {
    if (!activeOrder) router.replace("/home");
  }, [activeOrder, router]);

  if (!activeOrder) return null;
  return (
    <SentryErrorBoundary name="rider-live-trip">
      <LiveTripView tripId={activeOrder.id} />
    </SentryErrorBoundary>
  );
}
