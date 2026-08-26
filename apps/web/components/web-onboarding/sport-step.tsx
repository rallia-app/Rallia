'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Plus } from 'lucide-react';
import { useSports } from '@rallia/shared-hooks';

import { Card, CardContent } from '@/components/ui/card';
import { SportIcon } from '@/components/app/primitives/sport-icon';
import { cn } from '@/lib/utils';

/** Same photos as mobile's sport selection cards (assets/images/*.webp). */
const SPORT_IMAGES: Record<string, string> = {
  tennis: '/images/sports/tennis.webp',
  pickleball: '/images/sports/pickleball.webp',
};

/**
 * Sport picker — the one step the shared web-onboarding wizard has no equivalent for,
 * because the join and booking gates always know the sport from the match or facility
 * they came from. A player signing up for themselves has to choose.
 *
 * Single-select on purpose: it sets the primary sport, which is what the rest of the
 * wizard (level) and the app shell (sport switcher) key off. Adding a second sport is
 * a settings action, not a signup decision.
 *
 * Visuals mirror mobile's SportStep: photo card, bottom gradient, white sport
 * glyph + name, round selection badge.
 */
export function SportStep({
  selectedSportId,
  onSelect,
}: {
  selectedSportId: string | null;
  onSelect: (sportId: string) => void;
}) {
  // Singular copy on purpose: the existing onboarding.sportSelection* keys are plural
  // because mobile's picker is multi-select, and this one is not.
  const t = useTranslations('sportSelector');
  const { sports, loading } = useSports();

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <h2 className="font-heading text-xl font-semibold text-foreground">{t('selectSport')}</h2>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sports.map(sport => {
              const isSelected = sport.id === selectedSportId;
              const image = SPORT_IMAGES[sport.name.toLowerCase()] ?? SPORT_IMAGES.tennis;
              return (
                <button
                  key={sport.id}
                  type="button"
                  onClick={() => onSelect(sport.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'group relative h-44 overflow-hidden rounded-2xl text-left transition-all outline-none',
                    'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    isSelected
                      ? 'ring-[3px] ring-primary shadow-lg shadow-primary/20'
                      : 'ring-1 ring-border hover:ring-primary/40'
                  )}
                >
                  <Image
                    src={image}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 320px, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  {/* Same readability gradient as mobile's card */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-b from-transparent via-black/30 to-black/70"
                  />

                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-4">
                    <span className="flex items-center gap-2.5">
                      <SportIcon sportName={sport.name} className="size-6 text-white" />
                      <span className="font-heading text-lg font-bold text-white">
                        {sport.display_name}
                      </span>
                    </span>

                    {isSelected ? (
                      <span className="flex size-8 items-center justify-center rounded-full bg-primary shadow-md">
                        <Check className="size-4 text-primary-foreground" aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded-full border-[1.5px] border-white/40 bg-white/25">
                        <Plus className="size-4 text-white" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
