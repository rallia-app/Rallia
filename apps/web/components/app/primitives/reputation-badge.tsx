import { HelpCircle, Shield } from 'lucide-react';
import { getTierConfig, type ReputationTier } from '@rallia/shared-services';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Per-tier treatment. Tier thresholds, labels and the tier itself all come from
 * shared-services (getTierForScore / getTierConfig) — only the Tailwind classes live
 * here, so web can never disagree with mobile about who is Gold.
 */
const TIER_CLASSES: Record<ReputationTier, string> = {
  unknown: 'border-border bg-muted text-muted-foreground',
  bronze: 'border-amber-700/35 bg-amber-700/10 text-amber-800 dark:text-amber-500',
  silver: 'border-slate-400/40 bg-slate-400/10 text-slate-700 dark:text-slate-300',
  gold: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  platinum: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
};

interface ReputationBadgeProps {
  tier: ReputationTier;
  /** Overrides the tier's default label (already localized upstream). */
  label?: string;
  isLoading?: boolean;
  className?: string;
}

export function ReputationBadge({ tier, label, isLoading, className }: ReputationBadgeProps) {
  if (isLoading) return <Skeleton className={cn('h-6 w-20 rounded-full', className)} />;

  const config = getTierConfig(tier);
  // A player without enough events is 'unknown' — a shield would imply a standing
  // they have not earned yet.
  const Icon = tier === 'unknown' ? HelpCircle : Shield;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium',
        TIER_CLASSES[tier],
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label ?? config.label}
    </span>
  );
}
