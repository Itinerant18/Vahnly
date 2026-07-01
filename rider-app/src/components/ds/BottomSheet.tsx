'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Heights in px. Last entry can be 'full' */
  snapPoints?: (number | 'full')[];
  initialSnap?: number;
  showHandle?: boolean;
  children: React.ReactNode;
  pinnedFooter?: React.ReactNode;
}

export function BottomSheet({
  isOpen,
  onClose,
  snapPoints = [320],
  initialSnap = 0,
  showHandle = true,
  children,
  pinnedFooter,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [currentSnap, setCurrentSnap] = useState(initialSnap);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartY = useRef(0);
  const dragStartOffset = useRef(0);
  const isDragging = useRef(false);
  const velocityTracker = useRef<{ y: number; t: number }[]>([]);

  const resolveHeight = useCallback((pt: number | 'full') => {
    if (pt === 'full') return window.innerHeight - 48;
    return pt;
  }, []);

  const currentHeight = resolveHeight(snapPoints[currentSnap] ?? snapPoints[0]);
  const translateY = isOpen ? dragOffset : currentHeight + 100;

  useEffect(() => {
    if (isOpen) {
      setCurrentSnap(initialSnap);
      setDragOffset(0);
    }
  }, [isOpen, initialSnap]);

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    dragStartOffset.current = dragOffset;
    isDragging.current = true;
    velocityTracker.current = [{ y: e.touches[0].clientY, t: Date.now() }];
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    const newOffset = Math.max(0, dragStartOffset.current + delta);
    setDragOffset(newOffset);
    velocityTracker.current.push({ y: e.touches[0].clientY, t: Date.now() });
    // Keep only last 5 samples
    if (velocityTracker.current.length > 5) velocityTracker.current.shift();
  };

  const handleTouchEnd = () => {
    isDragging.current = false;
    const samples = velocityTracker.current;
    let velocity = 0;
    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.t - first.t;
      if (dt > 0) velocity = (last.y - first.y) / dt; // px/ms
    }

    // Fast downward swipe → close
    if (velocity > 0.5) {
      onClose();
      setDragOffset(0);
      return;
    }

    // Snap to nearest point
    const currentY = dragOffset;
    const heights = snapPoints.map(resolveHeight);
    let nearestIdx = 0;
    let minDist = Infinity;
    heights.forEach((h, i) => {
      const sheetTop = currentHeight - currentY;
      const dist = Math.abs(h - sheetTop);
      if (dist < minDist) {
        minDist = dist;
        nearestIdx = i;
      }
    });

    // If dragged past the smallest snap → close
    const smallestHeight = Math.min(...heights);
    if (currentHeight - currentY < smallestHeight * 0.4) {
      onClose();
      setDragOffset(0);
      return;
    }

    setCurrentSnap(nearestIdx);
    setDragOffset(0);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-background-primary/95 backdrop-blur-xl rounded-t-[20px] shadow-elevation-3 will-change-transform border-t border-white/20"
        style={{
          height: `${currentHeight}px`,
          transform: `translateY(${translateY}px)`,
          transition: isDragging.current
            ? 'none'
            : 'transform 400ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        role="dialog"
        aria-modal="true"
      >
        {/* Handle — larger, softer */}
        {showHandle && (
          <div className="flex-shrink-0 flex justify-center pt-300 pb-500 cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1.5 rounded-pill bg-gray-300/60" />
          </div>
        )}

        {/* Scrollable content */}
        <div
          className={`flex-1 overflow-y-auto px-500 ${
            pinnedFooter ? 'pb-24' : 'pb-500'
          }`}
        >
          {children}
        </div>

        {/* Pinned footer (primary CTA) */}
        {pinnedFooter && (
          <div className="flex-shrink-0 px-500 pb-[calc(var(--space-500)+env(safe-area-inset-bottom,0px))] pt-300 border-t border-border-opaque/50 bg-background-primary/95 backdrop-blur-xl">
            {pinnedFooter}
          </div>
        )}
      </div>
    </>
  );
}
