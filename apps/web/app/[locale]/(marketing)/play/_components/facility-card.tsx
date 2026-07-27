'use client';

import { Building2, CalendarClock, CalendarX, Footprints, Info, Lock, MapPin } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { formatInlineSnapshotSlots } from '@rallia/shared-hooks';
import type { FacilitySearchResult } from '@rallia/shared-types';

import { getRelativeDateLabel } from './utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PublicFacility = FacilitySearchResult;

/** The time group a clicked chip identifies (mirrors mobile's FormattedSlot key). */
export interface SlotGroupRef {
  start: string;
  end: string;
}

interface FacilityCardProps {
  facility: PublicFacility;
  /** `slot` targets a specific open time group; null means the facility's own booking page. */
  onBook: (facility: PublicFacility, slot: SlotGroupRef | null) => void;
}

export default function FacilityCard({ facility, onBook }: FacilityCardProps) {
  const t = useTranslations('courtsPage');
  const locale = useLocale();

  const addressLine = [facility.address, facility.city].filter(Boolean).join(', ');
  const distanceKm = facility.distance_meters != null ? facility.distance_meters / 1000 : null;

  // Availability is inlined on each row by search_facilities_nearby, so there's
  // no per-card fetch. The English "Today/Tomorrow" labels from the shared
  // formatter are re-derived here so they respect the active locale.
  const { slotsByDate } = useMemo(
    () => formatInlineSnapshotSlots(facility.availability_slots, facility.timezone),
    [facility.availability_slots, facility.timezone]
  );

  /**
   * Only provider-backed facilities can show availability or be booked: the
   * URL is built from the provider's template plus the facility's id at that
   * provider, and snapshot rows only ever exist for them. Roughly 3 in 4 active
   * facilities fail this, so anything gated on it has to be honest rather than
   * offering a booking affordance that dead-ends.
   */
  const canBookOnline = !!facility.booking_url_template && !!facility.external_provider_id;
  const showSlots = canBookOnline && !facility.is_first_come_first_serve;

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="h-1 w-full bg-linear-to-r from-primary to-primary/60" />

      <div className="flex flex-1 flex-col gap-3 p-5">
        {/* Name */}
        <h3 className="truncate text-base font-bold" title={facility.name}>
          {facility.name}
        </h3>

        {/* Address + distance */}
        {(addressLine || distanceKm != null) && (
          <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              {addressLine && <span className="block truncate">{addressLine}</span>}
              {distanceKm != null && (
                <span className="text-xs">{t('kmAway', { distance: distanceKm.toFixed(1) })}</span>
              )}
            </div>
          </div>
        )}

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          {facility.court_count ? (
            <Badge variant="secondary" className="gap-1 font-medium">
              <Building2 className="size-3" />
              {facility.court_count === 1
                ? t('courtCountSingular')
                : t('courtCount', { count: facility.court_count })}
            </Badge>
          ) : null}
          {facility.organization_nature === 'public' && (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            >
              <Building2 className="size-3" />
              {t('badgePublic')}
            </Badge>
          )}
          {facility.organization_nature === 'private' && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400"
            >
              <Lock className="size-3" />
              {t('badgePrivate')}
            </Badge>
          )}
          {facility.is_first_come_first_serve && (
            <Badge variant="outline" className="gap-1">
              <Footprints className="size-3" />
              {t('badgeFirstCome')}
            </Badge>
          )}
          {facility.booking_url_template && facility.external_provider_id && (
            <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
              <CalendarClock className="size-3" />
              {t('badgeBookable')}
            </Badge>
          )}
          {facility.membership_required && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400"
            >
              <Lock className="size-3" />
              {t('badgeMembership')}
            </Badge>
          )}
        </div>

        {/* Availability slots grouped by date */}
        {showSlots && slotsByDate.length > 0 && (
          <div className="-mx-5 mt-1 flex gap-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {slotsByDate.map(group => (
              <div key={group.dateKey} className="flex shrink-0 flex-col gap-1.5">
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wide',
                    group.isToday ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  {getRelativeDateLabel(group.dateKey, locale, t('today'), t('tomorrow'))}
                </span>
                <div className="flex gap-1.5">
                  {group.slots.slice(0, 4).map((slot, i) => (
                    <button
                      key={`${slot.facilityScheduleId}-${i}`}
                      type="button"
                      onClick={() =>
                        onBook(facility, {
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

        {/* Empty availability state (bookable facility, no open slots) */}
        {showSlots && slotsByDate.length === 0 && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarX className="size-3.5" />
            {t('noSlots')}
          </div>
        )}

        <div className="flex-1" />

        {/* A booking CTA only where booking actually exists. Everywhere else the
            card stays a listing, with a line saying why there's nothing to click. */}
        {canBookOnline ? (
          <Button className="w-full font-semibold" size="lg" onClick={() => onBook(facility, null)}>
            {t('bookCta')}
          </Button>
        ) : (
          <div className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            {facility.is_first_come_first_serve ? t('justShowUp') : t('noOnlineBooking')}
          </div>
        )}
      </div>
    </div>
  );
}
