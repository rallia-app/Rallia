import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Loading placeholders for the player app's recurring list shapes.
 *
 * Skeletons, never spinners, and each one mirrors the layout it replaces so the page
 * does not reflow when data lands. Ship the skeleton in the same change as the
 * component it stands in for.
 */

/** Game/match card: title row, meta line, participant avatars. */
export function GameCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-3 rounded-lg border border-border p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        <Skeleton className="h-6 w-14 rounded-full" />
      </div>
      <div className="flex items-center gap-2">
        {[0, 1, 2].map(i => (
          <Skeleton key={i} className="size-8 rounded-full" />
        ))}
        <Skeleton className="ml-auto h-4 w-20" />
      </div>
    </div>
  );
}

/** Facility card: image band, name, distance/meta. */
export function FacilityCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border', className)}>
      <Skeleton className="h-32 w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Player/conversation row: avatar, two text lines, trailing meta. */
export function PlayerRowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 py-3', className)}>
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-4 w-10 shrink-0" />
    </div>
  );
}

type SkeletonKind = 'game' | 'facility' | 'player';

const KIND_COMPONENTS = {
  game: GameCardSkeleton,
  facility: FacilityCardSkeleton,
  player: PlayerRowSkeleton,
} as const;

/**
 * Repeats a skeleton to suggest a list. `count` should roughly match a typical first
 * page — too many reads as a wall, too few as an almost-empty result.
 */
export function ListSkeleton({
  kind,
  count = 3,
  className,
}: {
  kind: SkeletonKind;
  count?: number;
  className?: string;
}) {
  const Item = KIND_COMPONENTS[kind];
  return (
    <div
      className={cn(kind === 'player' ? 'divide-y divide-border' : 'space-y-3', className)}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <Item key={i} />
      ))}
    </div>
  );
}
