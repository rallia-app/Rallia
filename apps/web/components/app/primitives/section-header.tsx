import { ChevronRight } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  description?: string;
  /** Renders a "view all" affordance pointing at the section's full list. */
  actionHref?: string;
  actionLabel?: string;
  className?: string;
}

/** Section heading with an optional view-all link. Used by Home's rails and detail tabs. */
export function SectionHeader({
  title,
  description,
  actionHref,
  actionLabel,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0 space-y-0.5">
        <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary transition-colors hover:text-[var(--primary-600)]"
        >
          {actionLabel}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
