"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-interactive-primary text-interactive-primary-text",
  secondary: "bg-interactive-secondary text-content-primary",
  danger: "bg-surface-negative text-content-negative",
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
