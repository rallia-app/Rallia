'use client';

import { Building2, CalendarClock, Footprints, Lock, MapPin, Navigation } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import type { WebBookFacilityContext, WebBookSlotGroup } from '../_lib/facility-context';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function formatGroup(group: WebBookSlotGroup, locale: string, timezone: string | null) {
  const start = new Date(group.slotStart);
  const end = new Date(group.slotEnd);
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

function isSameGroup(a: WebBookSlotGroup, b: WebBookSlotGroup) {
  return a.slotStart === b.slotStart && a.slotEnd === b.slotEnd;
}

interface FacilityProfileViewProps {
  facility: WebBookFacilityContext;
  /** Live selection, owned by the parent so the wizard reacts to it too. */
  selectedGroup: WebBookSlotGroup | null;
  onSelectGroup: (group: WebBookSlotGroup) => void;
}

export function FacilityProfileView({
  facility,
  selectedGroup,
  onSelectGroup,
}: FacilityProfileViewProps) {
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

      {selectedGroup && (
        <Card className="overflow-hidden border-primary/30">
          <div className="h-1 w-full bg-gradient-to-r from-primary to-primary/60" />
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              {t('selectedSlot')}
            </span>
            <span className="text-lg font-bold">
              {formatGroup(selectedGroup, locale, facility.timezone).day}
            </span>
            <span className="text-sm text-muted-foreground">
              {formatGroup(selectedGroup, locale, facility.timezone).time}
              {' · '}
              {selectedGroup.courts.length === 1
                ? (selectedGroup.courts[0].shortCourtName ?? t('courtCountSingular'))
                : t('courtCountLabel', { count: selectedGroup.courts.length })}
            </span>
          </CardContent>
        </Card>
      )}

      {facility.upcomingGroups.length > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="size-4" />
            {selectedGroup ? t('switchSlot') : t('upcomingSlots')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {facility.upcomingGroups.map(group => {
              const { day, time } = formatGroup(group, locale, facility.timezone);
              const isSelected = selectedGroup !== null && isSameGroup(group, selectedGroup);

              return (
                <button
                  key={`${group.slotStart}-${group.slotEnd}`}
                  type="button"
                  onClick={() => onSelectGroup(group)}
                  aria-pressed={isSelected}
                  aria-label={t('selectSlotAria', { day, time })}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left text-xs transition-colors outline-none',
                    'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    isSelected
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground'
                  )}
                >
                  <div className="font-semibold text-foreground">{day}</div>
                  <div>{time}</div>
                  {group.courts.length > 1 && (
                    <div className="mt-0.5 text-[10px] font-medium text-primary">
                      {t('courtCountLabel', { count: group.courts.length })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
