'use client';
import React, { useEffect, useState } from 'react';

interface RadialCountdownProps {
  expiresAt: number; // Unix timestamp (ms) when offer expires
  onExpire: () => void;
}

export function RadialCountdown({ expiresAt, onExpire }: RadialCountdownProps) {
  const [remaining, setRemaining] = useState(0);

  const radius = 60;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const delta = expiresAt - now;

      if (delta <= 0) {
        setRemaining(0);
        onExpire();
        return;
      }

      setRemaining(delta);
    };

    tick(); // Initial call
    const interval = setInterval(tick, 100);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const duration = 15000; // 15 seconds in ms
  const progress = Math.max(0, Math.min(1, (duration - remaining) / duration));
  const strokeDashoffset = circumference * (1 - progress);

  // Color gradient: Green → Amber → Red
  let color = 'var(--positive-400)'; // Emerald
  if (remaining < 10000) color = 'var(--warning-400)'; // Amber
  if (remaining < 5000) color = 'var(--negative-400)'; // Red

  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="150" height="150" viewBox="0 0 150 150" className="mb-4">
        {/* Background circle */}
        <circle
          cx="75"
          cy="75"
          r={radius}
          fill="none"
          stroke="var(--border-opaque)"
          strokeWidth="4"
        />

        {/* Progress circle */}
        <circle
          cx="75"
          cy="75"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.1s linear, stroke 0.3s ease',
            transform: 'rotate(-90deg)',
            transformOrigin: '75px 75px',
          }}
        />

        {/* Center text */}
        <text
          x="75"
          y="75"
          textAnchor="middle"
          dy="0.3em"
          fontSize="32"
          fontWeight="bold"
          fill={color}
          style={{ transition: 'fill 0.3s ease' }}
        >
          {seconds}s
        </text>
      </svg>

      <p className="text-sm text-content-secondary">Time remaining to accept offer</p>
    </div>
  );
}
