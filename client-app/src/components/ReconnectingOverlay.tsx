'use client';
import React from 'react';
import { useAppState } from '@/lib/store/useAppState';

export function ReconnectingOverlay() {
  const isReconnecting = useAppState((s) => s.isReconnecting);

  if (!isReconnecting) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Glassmorphic overlay */}
      <div className="absolute inset-0 bg-gray-0/20 backdrop-blur-sm" />

      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center bg-background-primary p-6 rounded-xl border border-border-opaque shadow-xl pointer-events-auto">
          {/* Pulsing dot animation */}
          <div className="flex gap-2 justify-center mb-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-3 h-3 bg-gray-1000 rounded-full animate-pulse"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>

          <p className="text-content-primary font-bold text-sm uppercase tracking-wider">Acquiring GPS Signal...</p>
          <p className="text-xs text-content-secondary mt-2">Connection re-establishing cleanly</p>
        </div>
      </div>
    </div>
  );
}
