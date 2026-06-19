'use client';

import type { ReactNode } from 'react';

import { CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Standard header for an analytics insight card: title (+ optional hint) on the
 * left, a controls cluster (view toggles, window selector) on the right. Every
 * insight across the Matches sub-tabs uses this so headers line up identically.
 * Convention for `controls`: view toggles first, the window selector last.
 */
export function InsightCardHeader({
  title,
  hint,
  controls,
}: {
  title: string;
  hint?: string;
  controls?: ReactNode;
}) {
  return (
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {hint && <p className="text-xs text-muted-foreground m-0 mt-1">{hint}</p>}
        </div>
        {controls && (
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">{controls}</div>
        )}
      </div>
    </CardHeader>
  );
}

/**
 * Compact segmented control for in-card view toggles (source, cumulative vs
 * weekly, segment, …). Same sizing everywhere via the shared Tabs primitive.
 */
export function SegmentedToggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList className="h-8">
        {options.map(o => (
          <TabsTrigger key={o.value} value={o.value} className="text-xs">
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
