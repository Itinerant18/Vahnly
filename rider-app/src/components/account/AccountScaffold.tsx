"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function AccountScaffold({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const router = useRouter();
  return (
    <main className="min-h-screen bg-background-primary pb-24">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border-opaque bg-background-primary/95 px-4 py-4 backdrop-blur">
        <button onClick={() => router.back()} aria-label="Back" className="text-content-primary">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M19 12H5M5 12L12 19M5 12L12 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-content-primary">{title}</h1>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="p-4">{children}</div>
    </main>
  );
}
