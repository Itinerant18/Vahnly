import React from 'react';

interface DataPoint {
  label: string;
  value: number;
}

interface SvgAreaChartProps {
  data:          DataPoint[];
  width?:        number;
  height?:       number;
  showGrid?:     boolean;
  title?:        string;
  valuePrefix?:  string;
  valueSuffix?:  string;
  /** @deprecated — ignored; chart now uses CSS vars for theming */
  strokeColor?:  string;
  /** @deprecated — ignored; chart now uses CSS vars for theming */
  fillColor?:    string;
}

export const SvgAreaChart: React.FC<SvgAreaChartProps> = ({
  data,
  width       = 400,
  height      = 180,
  showGrid    = true,
  title,
  valuePrefix = '',
  valueSuffix = '',
}) => {
  if (data.length < 2) return null;

  const paddingLeft   = 48;
  const paddingRight  = 16;
  const paddingTop    = title ? 32 : 12;
  const paddingBottom = 28;

  const chartW = width  - paddingLeft  - paddingRight;
  const chartH = height - paddingTop   - paddingBottom;

  const values = data.map((d) => d.value);
  const minVal = Math.min(...values) * 0.9;
  const maxVal = Math.max(...values) * 1.1 || 1;
  const range  = maxVal - minVal || 1;

  const scaleX = (i: number) => paddingLeft + (i / (data.length - 1)) * chartW;
  const scaleY = (v: number) => paddingTop  + chartH - ((v - minVal) / range) * chartH;

  const points = data.map((d, i) => ({ x: scaleX(i), y: scaleY(d.value) }));

  let linePath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
    const cpx2 = curr.x - (curr.x - prev.x) * 0.4;
    linePath += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
  }

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartH} L ${points[0].x} ${paddingTop + chartH} Z`;

  const gridLines: number[] = [];
  const gridLabels: { y: number; label: string }[] = [];
  for (let i = 0; i <= 4; i++) {
    const val = minVal + (range * i) / 4;
    const y   = scaleY(val);
    gridLines.push(y);
    gridLabels.push({ y, label: `${valuePrefix}${formatCompact(val)}${valueSuffix}` });
  }

  const xLabelStep = Math.max(1, Math.floor(data.length / 5));
  const xLabels    = data
    .map((d, i) => ({ x: scaleX(i), label: d.label, i }))
    .filter((_, i) => i % xLabelStep === 0 || i === data.length - 1);

  const latest    = points[points.length - 1];
  const latestVal = data[data.length - 1].value;

  // Token-referenced fill: use CSS var so it respects dark mode
  const fillColor   = 'var(--border-opaque)';
  const strokeColor = 'var(--content-primary)';
  const gridColor   = 'var(--border-opaque)';
  const labelColor  = 'var(--content-tertiary)';
  const monoFont    = 'var(--font-mono, JetBrains Mono, Fira Code, monospace)';
  const bodyFont    = 'var(--font-display, Inter, system-ui, sans-serif)';

  return (
    <div className="card p-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="overflow-visible"
      >
        {/* Title */}
        {title && (
          <text x={paddingLeft} y={16} fill={strokeColor} fontSize="13" fontWeight="600" fontFamily={bodyFont}>
            {title}
          </text>
        )}

        {/* Grid lines */}
        {showGrid && gridLines.map((y, i) => (
          <line key={`grid-${i}`} x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke={gridColor} strokeWidth="1" />
        ))}

        {/* Y-axis labels */}
        {gridLabels.map((g, i) => (
          <text key={`ylabel-${i}`} x={paddingLeft - 6} y={g.y + 4} fill={labelColor} fontSize="10" textAnchor="end" fontFamily={monoFont}>
            {g.label}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map((xl, i) => (
          <text key={`xlabel-${i}`} x={xl.x} y={height - 4} fill={labelColor} fontSize="10" textAnchor="middle" fontFamily={monoFont}>
            {xl.label}
          </text>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill={fillColor} fillOpacity="0.35" />

        {/* Line stroke */}
        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />

        {/* Latest value dot */}
        <circle cx={latest.x} cy={latest.y} r="4" fill={strokeColor} stroke="var(--background-primary)" strokeWidth="2" />

        {/* Latest value label */}
        <text x={latest.x - 8} y={latest.y - 10} fill={strokeColor} fontSize="11" fontWeight="600" fontFamily={monoFont}>
          {valuePrefix}{formatCompact(latestVal)}{valueSuffix}
        </text>
      </svg>
    </div>
  );
};

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  if (n % 1 !== 0)    return n.toFixed(1);
  return n.toString();
}
