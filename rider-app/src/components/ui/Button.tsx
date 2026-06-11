"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-[#0073E6] text-white",
  secondary: "bg-[#252D48] text-slate-200",
  danger: "bg-[#EF4444]/20 text-[#EF4444]",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`w-full rounded-lg py-3 text-sm font-semibold disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}
