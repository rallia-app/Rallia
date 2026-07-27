'use client';

import { useState } from 'react';
import { Check, Loader2, MapPin, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFacilitySearch } from '@rallia/shared-hooks';
import { formatDistance } from '@rallia/shared-utils';
import type { FacilitySearchResult } from '@rallia/shared-types';

import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Mobile requires two, for the same reason: one favourite is not a preference. */
export const MIN_FAVORITE_FACILITIES = 2;

/**
 * Favourite courts. Mandatory on mobile and here, because favourites drive the
 * "open at your favourites" surfaces and gate auto-invites — a player with none is
 * eligible for far less than they expect.
 */
export function FavoriteFacilitiesStep({
  sportId,
  latitude,
  longitude,
  selected,
  onToggle,
}: {
  sportId: string;
  latitude: number | null;
  longitude: number | null;
  selected: FacilitySearchResult[];
  onToggle: (facility: FacilitySearchResult) => void;
}) {
  const t = useTranslations('onboarding.favoriteSitesStep');
  const [searchQuery, setSearchQuery] = useState('');

  const { facilities, isLoading } = useFacilitySearch({
    sportIds: [sportId],
    latitude: latitude ?? undefined,
    longitude: longitude ?? undefined,
    searchQuery,
    // The location step runs first, so coordinates are normally present; without them
    // the search has no origin to sort by and would return an arbitrary slice.
    enabled: latitude != null && longitude != null,
    pageSize: 30,
  });

  const selectedIds = new Set(selected.map(facility => facility.id));
  const met = selected.length >= MIN_FAVORITE_FACILITIES;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-100)] dark:bg-[var(--primary-100)]/60">
            <MapPin
              className="size-5 text-[var(--primary-600)] dark:text-[var(--primary-500)]"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">{t('title')}</h2>
              {/* Announced so a keyboard or screen-reader user learns why Continue is
                  still disabled without hunting for it. */}
              <span
                aria-live="polite"
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums',
                  met ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}
              >
                {selected.length} / {MIN_FAVORITE_FACILITIES} {t('selected')}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="facility-search"
            aria-label={t('searchLabel')}
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-11 pl-9"
          />
        </div>

        {latitude == null || longitude == null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('noLocation')}</p>
        ) : isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : facilities.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {searchQuery ? t('noResults') : t('noFacilitiesNearby')}
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {facilities.map(facility => {
              const isSelected = selectedIds.has(facility.id);
              const distance = formatDistance(facility.distance_meters);
              return (
                <li key={facility.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(facility)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors outline-none',
                      'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40 hover:bg-primary/5'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        isSelected ? 'border-primary bg-primary' : 'border-border'
                      )}
                    >
                      {isSelected && (
                        <Check className="size-3 text-primary-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {facility.name}
                      </span>
                      {facility.city && (
                        <span className="block truncate text-sm text-muted-foreground">
                          {facility.city}
                        </span>
                      )}
                    </span>
                    {distance && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {distance}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </CardContent>
    </Card>
  );
}
