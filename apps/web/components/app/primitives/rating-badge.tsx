import { AlertCircle, CheckCircle2, HelpCircle, type LucideIcon } from 'lucide-react';

import { formatRating } from '@rallia/shared-utils';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type CertificationStatus = 'self_declared' | 'certified' | 'disputed';

/**
 * Certification treatment, mirroring mobile's CERTIFICATION_BADGE_COLORS.
 * Self-declared is the unmarked default: it gets no icon and the plain accent, so a
 * certified rating stands out rather than every badge shouting.
 */
const CERTIFICATION: Record<CertificationStatus, { icon: LucideIcon | null; className: string }> = {
  self_declared: { icon: HelpCircle, className: 'border-[var(--primary-500)]/25 text-foreground' },
  certified: {
    icon: CheckCircle2,
    className: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
  },
  disputed: {
    icon: AlertCircle,
    className: 'border-red-500/40 text-red-700 dark:text-red-400',
  },
};

interface RatingBadgeProps {
  /** Numeric rating (e.g. 3.5). Takes priority over ratingLabel. */
  ratingValue?: number | null;
  /** Text fallback (e.g. "Advanced") when there is no numeric rating. */
  ratingLabel?: string | null;
  certificationStatus?: CertificationStatus | null;
  isLoading?: boolean;
  className?: string;
}

/**
 * Rating pill. Always renders one decimal — "3.0", never "3" — via shared-utils'
 * formatRating, which is the same function mobile's badge uses.
 */
export function RatingBadge({
  ratingValue,
  ratingLabel,
  certificationStatus,
  isLoading = false,
  className,
}: RatingBadgeProps) {
  if (isLoading) return <Skeleton className={cn('h-6 w-14 rounded-full', className)} />;

  const display =
    ratingValue !== undefined && ratingValue !== null ? formatRating(ratingValue) : ratingLabel;
  if (!display) return null;

  const certification = certificationStatus ? CERTIFICATION[certificationStatus] : null;
  // Only a certified or disputed rating earns an icon.
  const Icon =
    certificationStatus && certificationStatus !== 'self_declared' ? certification?.icon : null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border bg-[var(--primary-100)]/60 px-2.5 py-0.5 text-sm font-semibold tabular-nums dark:bg-[var(--primary-100)]/30',
        certification?.className ?? 'border-[var(--primary-500)]/25 text-foreground',
        className
      )}
    >
      {Icon && <Icon className="size-3.5" aria-hidden="true" />}
      {display}
    </span>
  );
}
