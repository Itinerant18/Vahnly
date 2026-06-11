"use client";

import type { ReactNode } from "react";

export function BookingCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-[#1A1F3A] p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}
