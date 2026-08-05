'use client';

import { CalendarX, Info } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { formatInlineSnapshotSlots } from '@rallia/shared-hooks';
import type { FacilityAvailabilitySlotRow } from '@rallia/shared-types';

import { getRelativeDateLabel } from '../../_components/utils';

import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { courtsBookClicked } from '@/lib/analytics';
import { cn } from '@/lib/utils';

interface FacilityBookingPanelProps {
  facilityId: string;
  canBookOnline: boolean;
  isFirstComeFirstServe: boolean;
  timezone: string | null;
  availabilitySlots: FacilityAvailabilitySlotRow[];
}

/** The booking half of FacilityCard, reused on the facility detail page. */
export default function FacilityBookingPanel({
  facilityId,
  canBookOnline,
  isFirstComeFirstServe,
  timezone,
  availabilitySlots,
}: FacilityBookingPanelProps) {
  const t = useTranslations('courtsPage');
  const locale = useLocale();
  const router = useRouter();

  const { slotsByDate } = useMemo(
    () => formatInlineSnapshotSlots(availabilitySlots, timezone),
    [availabilitySlots, timezone]
  );

  const showSlots = canBookOnline && !isFirstComeFirstServe;

  const book = (slot: { start: string; end: string } | null) => {
    courtsBookClicked({ facility_id: facilityId, has_slot: slot !== null });
    const params = new URLSearchParams();
    if (slot) {
      params.set('start', slot.start);
      params.set('end', slot.end);
    }
    const search = params.size > 0 ? `?${params.toString()}` : '';
    router.push(`/book/facility/${facilityId}${search}`);
  };

  return (
    <div className="flex flex-col gap-3">
      {showSlots && slotsByDate.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {slotsByDate.map(group => (
            <div key={group.dateKey} className="flex flex-col gap-1.5">
              <span
                className={cn(
                  'text-[10px] font-semibold uppercase tracking-wide',
                  group.isToday ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {getRelativeDateLabel(group.dateKey, locale, t('today'), t('tomorrow'))}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {group.slots.slice(0, 8).map((slot, i) => (
                  <button
                    key={`${slot.facilityScheduleId}-${i}`}
                    type="button"
                    onClick={() =>
                      book({
                        start: slot.datetime.toISOString(),
                        end: slot.endDateTime.toISOString(),
                      })
                    }
                    aria-label={t('bookSlotAria', { time: slot.time })}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-medium text-primary transition-colors hover:border-primary hover:bg-primary/10"
                  >
                    {slot.time}
                    {slot.courtCount > 1 && (
                      <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {slot.courtCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showSlots && slotsByDate.length === 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarX className="size-3.5" />
          {t('noSlots')}
        </div>
      )}

      {canBookOnline ? (
        <Button className="w-full font-semibold sm:w-auto" size="lg" onClick={() => book(null)}>
          {t('bookCta')}
        </Button>
      ) : (
        <div className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          {isFirstComeFirstServe ? t('justShowUp') : t('noOnlineBooking')}
        </div>
      )}
    </div>
  );
}
