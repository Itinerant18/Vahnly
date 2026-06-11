"use client";

export function DriverMarker({
  lat,
  lng,
  bearing = 0,
}: {
  lat: number;
  lng: number;
  bearing?: number;
}) {
  return (
    <div
      className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0073E6] ring-4 ring-[#0073E6]/30"
      style={{ transform: `rotate(${bearing}deg)` }}
      title={`${lat.toFixed(4)}, ${lng.toFixed(4)}`}
    />
  );
}
