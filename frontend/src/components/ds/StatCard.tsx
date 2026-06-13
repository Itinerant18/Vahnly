

interface TrendProps {
  value: number;
  suffix?: string;
}

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: TrendProps | null;
  mono?: boolean;
  loading?: boolean;
  className?: string;
}

function Trend({ value, suffix = '%' }: TrendProps) {
  const isPos = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-label-small font-mono ${
        isPos ? 'text-content-positive' : 'text-content-negative'
      }`}
    >
      {isPos ? '↑' : '↓'}
      {Math.abs(value)}{suffix}
    </span>
  );
}

export function StatCard({ label, value, trend, mono = true, loading = false, className = '' }: StatCardProps) {
  return (
    <div
      className={`bg-background-primary rounded-md shadow-elevation-1 p-600 flex flex-col gap-2 hover:shadow-elevation-2 transition-base ${
        className
      }`}
    >
      <span className="text-label-small text-content-secondary uppercase tracking-wider">{label}</span>
      {loading ? (
        <div className="h-8 w-24 animate-pulse rounded-sm bg-background-tertiary" />
      ) : (
        <span className={`text-display-small text-content-primary ${
          mono ? 'font-mono' : ''
        }`}>
          {value}
        </span>
      )}
      {trend != null && !loading && <Trend value={trend.value} suffix={trend.suffix} />}
    </div>
  );
}
