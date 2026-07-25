'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface Segment {
  href: string;
  label: string;
}

/**
 * Underline tab bar, the web port of mobile's UnderlineTabBar.
 *
 * Segments are real routes, not local state — that is what makes each one linkable,
 * refreshable and back-navigable. Used by the Compete hub (Tournaments | Leagues |
 * Leaderboard) and any other segmented surface.
 */
export function SegmentedControl({
  segments,
  className,
}: {
  segments: Segment[];
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      className={cn('-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1', className)}
      aria-label="Sections"
    >
      {segments.map(segment => {
        const isActive = pathname === segment.href || pathname.startsWith(`${segment.href}/`);
        return (
          <Link
            key={segment.href}
            href={segment.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            )}
          >
            {segment.label}
          </Link>
        );
      })}
    </nav>
  );
}
