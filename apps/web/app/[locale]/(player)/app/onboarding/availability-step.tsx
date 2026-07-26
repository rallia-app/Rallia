'use client';

import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MIN_AVAILABILITY_CELLS, countSelected, type HourGrid } from '@rallia/shared-utils';

import { AvailabilityGrid } from '@/components/app/inputs/availability-grid';
import { AvailabilityPresets } from '@/components/app/inputs/availability-presets';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Weekly availability. Mandatory on mobile and mandatory here for the same reason:
 * the matchmaking engine matches on these hour cells, so a player who skips it is
 * effectively invisible to it.
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
          <div className="space-y-1">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t('availabilityStep.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('availabilitySubtitle')}</p>
          </div>
        </div>

        <AvailabilityPresets value={value} onChange={onChange} />

        <AvailabilityGrid value={value} onChange={onChange} />

        {/* Announced so a keyboard or screen-reader user learns they can continue
            without hunting for the disabled button's reason. */}
        <div className="flex items-center gap-3" aria-live="polite">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, (selected / MIN_AVAILABILITY_CELLS) * 100)}%` }}
            />
          </div>
          <p
            className={cn(
              'flex items-center gap-1.5 text-sm tabular-nums',
              met ? 'font-medium text-primary' : 'text-muted-foreground'
            )}
          >
            {met && <CheckCircle2 className="size-4" aria-hidden="true" />}
            {selected} / {MIN_AVAILABILITY_CELLS}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
