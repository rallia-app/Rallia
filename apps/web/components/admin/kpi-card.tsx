import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export interface KpiCardProps {
  label: string;
  value: number | string | null;
  loading?: boolean;
  hint?: string;
  href?: string;
  /**
   * Optional period-over-period delta. `current` and `previous` are the raw
   * values; the card computes the percentage change and renders an arrow.
   * Pass when both numbers are available; omit otherwise.
   */
  delta?: { current: number; previous: number } | null;
}

/**
 * Single KPI tile. Replaces the inline `StatItem` from the old monolithic
 * overview, with optional `href` so Overview cards can link into the focused
 * tab for that domain, and optional `delta` for period-over-period trend.
 */
export function KpiCard({ label, value, loading, hint, href, delta }: KpiCardProps) {
  const trend = computeTrend(delta);
  // String values get a hover title so the full slug stays accessible even
  // when truncated. Same font size as numeric KPIs for visual consistency.
  const isStringValue = typeof value === 'string' && value !== '—';

  const content = (
    <Card className={href ? 'hover:bg-muted/40 transition-colors' : undefined}>
      <CardContent className="p-4">
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="flex items-baseline justify-between gap-2 min-w-0">
            <p
              className="text-2xl font-bold m-0 truncate min-w-0 flex-1"
              title={isStringValue ? value : undefined}
            >
              {value ?? '—'}
            </p>
            {trend && (
              <span
                className={`inline-flex items-center text-xs font-medium shrink-0 ${trend.colorClass}`}
                title={`${trend.previous} → ${trend.current}`}
              >
                {trend.icon}
                {trend.label}
              </span>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground m-0 mt-1">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground m-0 mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

interface Trend {
  label: string;
  icon: React.ReactNode;
  colorClass: string;
  current: number;
  previous: number;
}

function computeTrend(delta: KpiCardProps['delta']): Trend | null {
  if (!delta) return null;
  const { current, previous } = delta;
  // No baseline → can't show a meaningful delta. Skip rather than show ∞%.
  if (previous === 0) {
    if (current === 0) return null;
    return {
      label: 'new',
      icon: <ArrowUp className="size-3 mr-0.5" />,
      colorClass: 'text-emerald-600 dark:text-emerald-400',
      current,
      previous,
    };
  }
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 1) {
    return {
      label: 'flat',
      icon: <ArrowRight className="size-3 mr-0.5" />,
      colorClass: 'text-muted-foreground',
      current,
      previous,
    };
  }
  const up = pct > 0;
  return {
    label: `${up ? '+' : ''}${pct.toFixed(0)}%`,
    icon: up ? <ArrowUp className="size-3 mr-0.5" /> : <ArrowDown className="size-3 mr-0.5" />,
    colorClass: up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
    current,
    previous,
  };
}
