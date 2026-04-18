import { Skeleton } from '@/components/ui/skeleton';

export default function CommunityCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
      {/* Accent strip */}
      <div className="h-1 w-full bg-muted" />

      {/* Cover image */}
      <Skeleton className="h-36 w-full rounded-none" />

      <div className="flex flex-col gap-3 p-5">
        {/* Name + certified badge */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="size-4 rounded-full" />
        </div>

        {/* Member count */}
        <div className="flex items-center gap-1.5">
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>

        {/* Sport badge */}
        <Skeleton className="h-5 w-16 rounded-full" />

        {/* CTA button */}
        <Skeleton className="h-10 w-full rounded-md mt-2" />
      </div>
    </div>
  );
}
