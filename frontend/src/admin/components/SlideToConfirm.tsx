import React, { useRef, useState, useCallback, useEffect } from 'react';

interface SlideToConfirmProps {
  /** Label shown on the track before confirmation (e.g. "Slide to force-cancel trip"). */
  label: string;
  /** Label shown once the gate has been satisfied. */
  confirmedLabel?: string;
  /** Fired once the thumb is dragged past the commit threshold. */
  onConfirm: () => void;
  /** Disables interaction (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** Tone of the satisfied track — destructive renders ink-filled, neutral stays soft. */
  tone?: 'destructive' | 'neutral';
}

const THUMB = 44; // px — thumb diameter, matches py-3 control rhythm
const COMMIT = 0.92; // fraction of track the thumb must cross to fire

/**
 * Multi-stage confirmation gate. Replaces a one-click destructive button with a
 * drag track so accidental clicks cannot trigger irreversible admin overrides.
 * Pure pointer events — no animation library, no per-frame React state churn
 * beyond the active drag.
 */
export const SlideToConfirm: React.FC<SlideToConfirmProps> = ({
  label,
  confirmedLabel = 'Confirmed',
  onConfirm,
  disabled = false,
  tone = 'destructive',
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [offset, setOffset] = useState(0); // px from left edge
  const [confirmed, setConfirmed] = useState(false);

  const maxOffset = useCallback(() => {
    const w = trackRef.current?.clientWidth ?? 0;
    return Math.max(0, w - THUMB - 8); // 8 = 4px inset each side
  }, []);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const limit = maxOffset();
    if (limit > 0 && offset / limit >= COMMIT) {
      setConfirmed(true);
      setOffset(limit);
      onConfirm();
    } else {
      setOffset(0); // snap back — gate not satisfied
    }
  }, [offset, maxOffset, onConfirm]);

  const moveTo = useCallback(
    (clientX: number) => {
      if (!draggingRef.current || !trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const next = Math.min(maxOffset(), Math.max(0, clientX - rect.left - THUMB / 2));
      setOffset(next);
    },
    [maxOffset],
  );

  useEffect(() => {
    if (disabled || confirmed) return;
    const onMove = (e: PointerEvent) => moveTo(e.clientX);
    const onUp = () => endDrag();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [disabled, confirmed, moveTo, endDrag]);

  // Reset the gate when it is disabled/re-enabled (e.g. selection changed).
  useEffect(() => {
    if (disabled) {
      setConfirmed(false);
      setOffset(0);
      draggingRef.current = false;
    }
  }, [disabled]);

  const pct = (() => {
    const limit = maxOffset();
    return limit > 0 ? offset / limit : 0;
  })();

  return (
    <div
      ref={trackRef}
      className={`relative h-[52px] w-full rounded-pill border select-none overflow-hidden ${
        confirmed
          ? tone === 'destructive'
            ? 'bg-content-primary border-content-primary'
            : 'bg-background-secondary border-surface-pressed'
          : 'bg-background-secondary border-background-secondary'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      {/* Fill trail that grows behind the thumb */}
      {!confirmed && (
        <div
          className="absolute inset-y-0 left-0 bg-surface-pressed/60"
          style={{ width: offset + THUMB / 2 }}
        />
      )}

      {/* Track label */}
      <div
        className={`absolute inset-0 flex items-center justify-center text-xs font-medium uppercase tracking-wider pointer-events-none ${
          confirmed
            ? tone === 'destructive'
              ? 'text-gray-0'
              : 'text-content-primary'
            : 'text-content-secondary'
        }`}
        style={{ opacity: confirmed ? 1 : 1 - pct * 0.8 }}
      >
        {confirmed ? confirmedLabel : label}
      </div>

      {/* Draggable thumb */}
      {!confirmed && (
        <div
          role="slider"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={(e) => {
            if (disabled) return;
            draggingRef.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onKeyDown={(e) => {
            // Keyboard fallback: Enter/Space commits the gate.
            if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              setConfirmed(true);
              setOffset(maxOffset());
              onConfirm();
            }
          }}
          className={`absolute top-1 left-1 h-[44px] w-[44px] rounded-full bg-content-primary flex items-center justify-center shadow-sm ${
            disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
          }`}
          style={{ transform: `translateX(${offset}px)`, transition: draggingRef.current ? 'none' : 'transform 160ms cubic-bezier(0.16,1,0.3,1)' }}
        >
          {/* Chevron primitive — no emoji */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-0">
            <path d="M5 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
};
