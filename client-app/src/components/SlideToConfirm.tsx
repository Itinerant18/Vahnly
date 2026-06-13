'use client';
import { motion } from 'framer-motion';
import React, { useRef, useState } from 'react';
import { Haptics } from '@capacitor/haptics';

interface SlideToConfirmProps {
  label: string;
  onConfirm: () => Promise<void>;
  color?: 'emerald' | 'red' | 'blue';
  disabled?: boolean;
}

export function SlideToConfirm({
  label,
  onConfirm,
  color = 'emerald',
  disabled = false,
}: SlideToConfirmProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [dragX, setDragX] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const trackWidth = 300;
  const thumbWidth = 60;
  const threshold = trackWidth - thumbWidth; // Must drag to 80%+

  const colorMap = {
    emerald: 'bg-positive-400 hover:bg-positive-400',
    red: 'bg-negative-400 hover:bg-negative-400',
    blue: 'bg-accent-400 hover:bg-accent-400',
  };

  const handleDragEnd = async () => {
    if (dragX >= threshold * 0.8) {
      // Confirm action
      setIsLoading(true);

      try {
        // Haptic feedback on confirm (fail-safe for desktop tests)
        await Haptics.impact({ style: 'Medium' as any }).catch(() => {});

        // Call the async action
        await onConfirm();

        // Success feedback
        await Haptics.notification({ type: 'Success' as any }).catch(() => {});
        setDragX(0);
      } catch (error) {
        console.error('Action failed:', error);
        await Haptics.notification({ type: 'Error' as any }).catch(() => {});
        setDragX(0);
      } finally {
        setIsLoading(false);
      }
    } else {
      // Snap back
      setDragX(0);
    }
  };

  const progress = dragX / (threshold * 0.8);

  return (
    <div ref={trackRef} className="w-full">
      <motion.div
        className={`relative h-16 rounded-lg ${colorMap[color]} flex items-center justify-center overflow-hidden ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        {/* Background tint at threshold */}
        {progress > 0.7 && (
          <div
            className="absolute inset-0 bg-white opacity-10"
            style={{
              backgroundColor: `rgba(255, 255, 255, ${(progress - 0.7) * 0.5})`,
            }}
          />
        )}

        {/* Label text */}
        <span className="text-white font-bold text-lg z-10 pointer-events-none">
          {isLoading ? 'Processing...' : label}
        </span>

        {/* Draggable thumb */}
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: threshold }}
          onDrag={(_, info) => setDragX(info.point.x - (trackRef.current?.getBoundingClientRect().left ?? 0) - 30)}
          onDragEnd={handleDragEnd}
          className={`absolute left-2 w-12 h-12 bg-white rounded-lg z-20 ${
            isLoading ? 'opacity-50' : 'cursor-grab active:cursor-grabbing'
          }`}
          animate={{
            x: dragX,
            opacity: isLoading ? 0.5 : 1,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          {/* Inner indicator */}
          <div className="absolute inset-2 flex items-center justify-center">
            <div className="text-sm font-bold text-content-secondary">{'→'}</div>
          </div>
        </motion.div>
      </motion.div>

      {/* Progress indicator text */}
      {dragX > 0 && (
        <p className="text-xs text-content-secondary mt-2">
          {Math.round(progress * 100)}% — {Math.round(Math.max(0, threshold * 0.8 - dragX))}px to go
        </p>
      )}
    </div>
  );
}
