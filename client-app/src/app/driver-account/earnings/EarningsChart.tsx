'use client';

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

export interface EarningsChartDatum {
  label: string;
  rupees: number;
}

// Isolated so recharts is code-split out of the earnings route's initial bundle.
// Loaded via next/dynamic({ ssr: false }) from the page.
export default function EarningsChart({ data }: { data: EarningsChartDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <XAxis dataKey="label" stroke="#52525b" tick={{ fontSize: 10, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
        <YAxis stroke="#52525b" tick={{ fontSize: 10, fontFamily: 'monospace' }} tickLine={false} axisLine={false}
          tickFormatter={(v) => `₹${v}`} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          contentStyle={{ background: '#09090b', border: '1px solid #27272a', borderRadius: 12, fontFamily: 'monospace', fontSize: 11 }}
          labelStyle={{ color: '#a1a1aa' }}
          formatter={(value) => `₹${Number(value ?? 0).toFixed(2)}`}
        />
        <Bar dataKey="rupees" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill="#34d399" />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
