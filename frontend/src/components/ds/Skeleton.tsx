
interface SkeletonProps {
  width?: string;
  height?: string;
  rounded?: 'sm' | 'md' | 'pill';
  className?: string;
}

const roundedMap = { sm: 'rounded-sm', md: 'rounded-md', pill: 'rounded-pill' };

export function Skeleton({
  width = 'w-full',
  height = 'h-4',
  rounded = 'sm',
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={['skeleton', width, height, roundedMap[rounded], className]
        .filter(Boolean).join(' ')}
      aria-hidden="true"
    />
  );
}
