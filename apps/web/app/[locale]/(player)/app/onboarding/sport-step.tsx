'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useSports } from '@rallia/shared-hooks';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Sport picker — the one step the shared web-onboarding wizard has no equivalent for,
 * because the join and booking gates always know the sport from the match or facility
 * they came from. A player signing up for themselves has to choose.
 *
 * Single-select on purpose: it sets the primary sport, which is what the rest of the
 * wizard (level) and the app shell (sport switcher) key off. Adding a second sport is
 * a settings action, not a signup decision.
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
          <div className="grid gap-3 sm:grid-cols-2">
            {sports.map(sport => {
              const isSelected = sport.id === selectedSportId;
              return (
                <button
                  key={sport.id}
                  type="button"
                  onClick={() => onSelect(sport.id)}
                  aria-pressed={isSelected}
                  className={
                    isSelected
                      ? 'rounded-lg border-2 border-primary bg-primary/5 px-4 py-4 text-left font-medium text-foreground transition-colors'
                      : 'rounded-lg border-2 border-border px-4 py-4 text-left font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground'
                  }
                >
                  {sport.display_name}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
