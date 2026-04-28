'use client';

import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { InvitationTimeseriesPoint } from '@rallia/shared-hooks';

type Props = {
  points: InvitationTimeseriesPoint[];
  /** Optional fixed height in px (default 28) */
  height?: number;
  /** chart-N CSS variable index (1-5). Default 1. */
  colorIndex?: 1 | 2 | 3 | 4 | 5;
};

/**
 * Compact sparkline for the Invitations & Referrals admin table.
 * Uses shadcn `--chart-N` CSS variables for theming. Empty / single-point
 * series render as a flat line at zero so the table layout stays stable.
 */
export function AdminInvitationSparkline({ points, height = 28, colorIndex = 1 }: Props) {
  const data = points.length > 0 ? points : [{ date: '', clicks: 0 }];
  const colorVar = `var(--chart-${colorIndex})`;
  const gradientId = `spark-gradient-${colorIndex}`;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 1, right: 1, bottom: 1, left: 1 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorVar} stopOpacity={0.5} />
              <stop offset="100%" stopColor={colorVar} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="clicks"
            stroke={colorVar}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
