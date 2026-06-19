'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type TrendPoint = Record<string, number | string>;

const TOOLTIP_STYLE = {
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
} as const;

const AXIS_PROPS = {
  stroke: 'currentColor',
  className: 'text-muted-foreground text-xs',
  tickLine: false,
  axisLine: false,
} as const;

/**
 * Weekly conversion trend: a faint volume series (bars, left axis) behind one or
 * more rate lines as % of that volume (right axis, 0–100). Slopes read as the
 * week-over-week trend; the gap between nested lines is the per-stage drop-off.
 */
export function RateTrendChart({
  data,
  volumeKey,
  volumeLabel,
  series,
  height = 230,
}: {
  data: TrendPoint[];
  volumeKey: string;
  volumeLabel: string;
  series: { key: string; label: string; color: string; dash?: string }[];
  height?: number;
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis dataKey="week" {...AXIS_PROPS} />
          <YAxis yAxisId="left" allowDecimals={false} width={32} {...AXIS_PROPS} />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            width={40}
            tickFormatter={(v: number) => `${v}%`}
            {...AXIS_PROPS}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            yAxisId="left"
            dataKey={volumeKey}
            name={volumeLabel}
            fill="var(--muted-foreground)"
            fillOpacity={0.18}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
          {series.map(s => (
            <Line
              key={s.key}
              yAxisId="right"
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dash}
              unit="%"
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Weekly volume + composition: a stacked bar per week whose total height is the
 * top-of-funnel count, split into where each cohort ended up. Segments must be
 * non-negative (the funnel is nested: quality ≤ played ≤ filled ≤ created).
 */
export function StackedFunnelChart({
  data,
  segments,
  height = 230,
}: {
  data: TrendPoint[];
  segments: { key: string; label: string; color: string; opacity?: number }[];
  height?: number;
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis dataKey="week" {...AXIS_PROPS} />
          <YAxis allowDecimals={false} width={32} {...AXIS_PROPS} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {segments.map(seg => (
            <Bar
              key={seg.key}
              dataKey={seg.key}
              name={seg.label}
              stackId="funnel"
              fill={seg.color}
              fillOpacity={seg.opacity ?? 1}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
