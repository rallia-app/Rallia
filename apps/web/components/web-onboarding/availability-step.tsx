'use client';

import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MIN_AVAILABILITY_CELLS, countSelected, type HourGrid } from '@rallia/shared-utils';

import { AvailabilityGrid } from '@/components/app/inputs/availability-grid';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Weekly availability. Mandatory on mobile and mandatory here for the same reason:
 * the matchmaking engine matches on these hour cells, so a player who skips it is
 * effectively invisible to it.
 *
 * The count sits beside the heading rather than under the grid: the grid is tall
 * enough that a counter below it is off screen exactly when it matters, and this is
 * the same placement the favourite-courts step uses for its own minimum.
 */
export function AvailabilityStep({
  value,
  onChange,
}: {
  value: HourGrid;
  onChange: (next: HourGrid) => void;
}) {
  const t = useTranslations('onboarding');
  const selected = countSelected(value);
  const met = selected >= MIN_AVAILABILITY_CELLS;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-100)] dark:bg-[var(--primary-100)]/60">
            <CalendarClock
              className="size-5 text-[var(--primary-600)] dark:text-[var(--primary-500)]"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">
                {t('availabilityStep.title')}
              </h2>
              {/* Announced so a keyboard or screen-reader user learns they can continue
                  without hunting for the disabled button's reason. */}
              <span
                aria-live="polite"
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums',
                  met ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}
              >
                {met && <CheckCircle2 className="size-3.5" aria-hidden="true" />}
                {selected} / {MIN_AVAILABILITY_CELLS}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{t('availabilitySubtitle')}</p>
          </div>
        </div>

        <AvailabilityGrid value={value} onChange={onChange} />
      </CardContent>
    </Card>
  );
}
