/**
 * Compact horizontal funnel: each row is a stage where the bar's width is
 * value/firstStageValue. Drop-off vs. previous stage shown on the right.
 *
 * Generalized from the old AdminAnalyticsOverview's inline FunnelStrip so
 * both the Invitations & Referrals drill-down and the UTM campaign
 * drill-down render the same shape.
 */
export interface FunnelStage {
  label: string;
  value: number;
}

export function FunnelStrip({ stages }: { stages: FunnelStage[] }) {
  if (stages.length === 0) return null;
  const denom = stages[0].value > 0 ? stages[0].value : 1;
  const tones = [
    'bg-primary/80',
    'bg-primary/65',
    'bg-primary/45',
    'bg-primary/30',
    'bg-primary/20',
  ];

  return (
    <div className="flex flex-col gap-1.5">
      {stages.map((stage, i) => {
        const widthPct = Math.max(2, Math.round((stage.value / denom) * 100));
        const prev = i > 0 ? stages[i - 1].value : null;
        const dropoff =
          prev && prev > 0 && stage.value < prev
            ? Math.round(((prev - stage.value) / prev) * 100)
            : null;
        return (
          <div key={stage.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">{stage.label}</span>
            <div className="relative flex-1 h-5 bg-muted rounded-sm overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${tones[i] ?? 'bg-primary/15'}`}
                style={{ width: `${widthPct}%` }}
              />
              <span className="relative z-10 px-2 text-xs font-medium leading-5">
                {stage.value}
              </span>
            </div>
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
              {dropoff !== null ? `−${dropoff}%` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
