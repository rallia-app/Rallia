'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ChartSeries {
  /** Key used to identify this series in the data rows */
  name: string;
  /** Display label in legend / tooltip */
  label: string;
  /** chart-N CSS variable index (1-5) */
  colorIndex: 1 | 2 | 3 | 4 | 5;
}

export interface ChartPoint {
  /** ISO day string (e.g. "2026-05-08T00:00:00Z") */
  day: string;
  /** Indexed values per series.name */
  [seriesName: string]: string | number;
}

/**
 * Multi-series area chart used by the UTM monitoring section to compare
 * landings per top campaign over time. Same `--chart-N` CSS variable
 * convention as AdminInvitationSparkline, scaled up for full visibility.
 */
export function MultiSeriesAreaChart({
  data,
  series,
  height = 220,
  formatDay,
}: {
  data: ChartPoint[];
  series: ChartSeries[];
  height?: number;
  formatDay?: (day: string) => string;
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            {series.map(s => {
              const colorVar = `var(--chart-${s.colorIndex})`;
              return (
                <linearGradient
                  key={s.name}
                  id={`utm-gradient-${s.name}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={colorVar} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={colorVar} stopOpacity={0.05} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="day"
            tickFormatter={formatDay}
            stroke="currentColor"
            className="text-muted-foreground text-xs"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            stroke="currentColor"
            className="text-muted-foreground text-xs"
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            labelFormatter={(label: unknown) =>
              formatDay ? formatDay(String(label)) : String(label)
            }
            contentStyle={{
              background: 'var(--background)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {series.map(s => (
            <Area
              key={s.name}
              type="monotone"
              dataKey={s.name}
              name={s.label}
              stroke={`var(--chart-${s.colorIndex})`}
              strokeWidth={1.5}
              fill={`url(#utm-gradient-${s.name})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
