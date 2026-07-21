'use client';

import { Building2, CalendarClock, Footprints, Lock, MapPin, Navigation } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import type { WebBookFacilityContext, WebBookSlot } from '../_lib/facility-context';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function formatSlot(slot: WebBookSlot, locale: string, timezone: string | null) {
  const start = new Date(slot.slotStart);
  const end = new Date(slot.slotEnd);
  const zone = timezone ?? undefined;

  const day = start.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: zone,
  });
  const time = `${start.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  })} – ${end.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  })}`;

  return { day, time };
}

export function FacilityProfileView({ facility }: { facility: WebBookFacilityContext }) {
  const t = useTranslations('webBook');
  const locale = useLocale();

  const addressLine = [facility.address, facility.city].filter(Boolean).join(', ');
  const directionsUrl =
    facility.latitude != null && facility.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${facility.latitude},${facility.longitude}`
      : addressLine
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}`
        : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">{facility.name}</h1>

        {addressLine && (
          <div className="flex items-start gap-2 text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" />
            <span>{addressLine}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {facility.sport && (
            <Badge variant="secondary" className="gap-1 font-medium capitalize">
              <Building2 className="size-3" />
              {facility.sport.name}
            </Badge>
          )}
          {facility.organization_nature === 'public' && (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            >
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

        {directionsUrl && (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Navigation className="size-4" />
            {t('directions')}
          </a>
        )}
      </div>

      {facility.selectedSlot && (
        <Card className="overflow-hidden border-primary/30">
          <div className="h-1 w-full bg-gradient-to-r from-primary to-primary/60" />
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              {t('selectedSlot')}
            </span>
            <span className="text-lg font-bold">
              {formatSlot(facility.selectedSlot, locale, facility.timezone).day}
            </span>
            <span className="text-sm text-muted-foreground">
              {formatSlot(facility.selectedSlot, locale, facility.timezone).time}
              {facility.selectedSlot.courtName ? ` · ${facility.selectedSlot.courtName}` : ''}
            </span>
          </CardContent>
        </Card>
      )}

      {facility.upcomingSlots.length > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="size-4" />
            {t('upcomingSlots')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {facility.upcomingSlots.map((slot, i) => {
              const { day, time } = formatSlot(slot, locale, facility.timezone);
              const isSelected =
                facility.selectedSlot?.externalSlotId != null &&
                slot.externalSlotId === facility.selectedSlot.externalSlotId;

              return (
                <div
                  key={`${slot.externalSlotId ?? slot.externalCourtId}-${i}`}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-xs',
                    isSelected
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  <div className="font-semibold text-foreground">{day}</div>
                  <div>{time}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
