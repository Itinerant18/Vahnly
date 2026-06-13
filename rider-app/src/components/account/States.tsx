"use client";

import type { ReactNode } from "react";

/** Shimmer block — pulsing placeholder, never a spinner. */
export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-background-tertiary ${className}`} />;
}

export function SkeletonList({ rows = 4, height = "h-20" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Shimmer key={i} className={`w-full ${height}`} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon = "📭",
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="text-5xl">{icon}</div>
      <p className="text-base font-semibold text-content-primary">{title}</p>
      {message && <p className="max-w-xs text-sm text-content-secondary">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="text-5xl">⚠️</div>
      <p className="text-base font-semibold text-content-primary">Something went wrong</p>
      <p className="max-w-xs text-sm text-content-secondary">{message ?? "Please try again."}</p>
      <button
        onClick={onRetry}
        className="mt-2 rounded-xl bg-background-tertiary px-5 py-2.5 text-sm font-semibold text-content-accent ring-1 ring-border-accent"
      >
        Retry
      </button>
    </div>
  );
}
