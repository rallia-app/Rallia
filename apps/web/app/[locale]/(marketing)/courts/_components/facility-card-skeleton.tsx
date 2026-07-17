import { Skeleton } from '@/components/ui/skeleton';

export default function FacilityCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="h-1 w-full bg-muted" />
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <div className="flex items-start gap-1.5">
          <Skeleton className="mt-0.5 size-4 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-7 w-14 rounded-full" />
          <Skeleton className="h-7 w-14 rounded-full" />
          <Skeleton className="h-7 w-14 rounded-full" />
        </div>
        <Skeleton className="mt-1 h-10 w-full rounded-md" />
      </div>
    </div>
  );
}
