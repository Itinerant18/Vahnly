import React from 'react';

interface SkeletonProps {
  /** Tailwind width class e.g. "w-24" or "w-full" */
  width?: string;
  /** Tailwind height class e.g. "h-4" or "h-12" */
  height?: string;
  rounded?: 'sm' | 'md' | 'pill';
  className?: string;
}

const roundedMap = {
  sm:   'rounded-sm',
  md:   'rounded-md',
  pill: 'rounded-pill',
};

/**
 * Skeleton — shimmer loading placeholder.
 * Uses the .skeleton CSS class (DS5 shimmer animation).
 * Always aria-hidden so screen readers skip it.
 */
export function Skeleton({
  width = 'w-full',
  height = 'h-4',
  rounded = 'sm',
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={[
        'skeleton',
        width,
        height,
        roundedMap[rounded],
        className,
      ].filter(Boolean).join(' ')}
      aria-hidden="true"
    />
  );
}
