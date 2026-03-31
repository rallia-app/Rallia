import { Skeleton } from '@/components/ui/skeleton';

export default function MatchCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="h-1 w-full bg-muted" />
      <div className="flex flex-col gap-4 p-5">
        {/* Sport badge + spots */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>

        {/* Date & time */}
        <div className="flex items-center gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
        </div>

        {/* Location */}
        <div className="flex items-start gap-1.5">
          <Skeleton className="size-4 shrink-0 rounded-full mt-0.5" />
          <div className="flex flex-col gap-1 flex-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>

        {/* Player slots */}
        <div className="flex items-center justify-between">
          <div className="flex -space-x-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="size-9 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-4 w-8" />
        </div>

        {/* Badges */}
        <div className="flex gap-2">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>

        {/* CTA button */}
        <Skeleton className="h-10 w-full rounded-md mt-1" />
      </div>
    </div>
  );
}
