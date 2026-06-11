import type { ReactNode } from "react";

// Passthrough layout for legacy [tripId] routes.
export default function TripSegmentLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
