'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { CalendarX, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import JoinMatchDialog from './join-match-dialog';
import MatchCardSkeleton from './match-card-skeleton';
import PublicMatchCard, { type PublicMatch } from './public-match-card';
import { getRelativeDateLabel } from './utils';

const PAGE_SIZE = 12;

interface Sport {
  id: string;
  name: string;
  slug: string;
}

interface GamesMatchListProps {
  initialMatches: PublicMatch[];
}

export default function GamesMatchList({ initialMatches }: GamesMatchListProps) {
  const t = useTranslations('gamesPage');
  const locale = useLocale();

  const [matches, setMatches] = useState<PublicMatch[]>(initialMatches);
  const [hasMore, setHasMore] = useState(initialMatches.length >= PAGE_SIZE);
  const [offset, setOffset] = useState(initialMatches.length);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [locationLoaded, setLocationLoaded] = useState(false);

  // Sport filter
  const [sports, setSports] = useState<Sport[]>([]);
  const [activeSportId, setActiveSportId] = useState<string | null>(null);

  // Join dialog
  const [joinMatchId, setJoinMatchId] = useState<string | null>(null);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);

  // Fetch sports on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/sports');
        if (res.ok) {
          const data = await res.json();
          setSports(data.sports ?? []);
        }
      } catch {
        // Sports filter unavailable
      }
    })();
  }, []);

  const fetchMatches = useCallback(
    async (
      fetchOffset: number,
      lat?: number | null,
      lng?: number | null,
      sportId?: string | null
    ) => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(fetchOffset),
      });
      if (lat != null && lng != null) {
        params.set('latitude', String(lat));
        params.set('longitude', String(lng));
      }
      if (sportId) {
        params.set('sportId', sportId);
      }
      const res = await fetch(`/api/public-matches?${params}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ matches: PublicMatch[]; hasMore: boolean }>;
    },
    []
  );

  // On mount, get location and re-fetch sorted by proximity
  useEffect(() => {
    let cancelled = false;

    async function getCoords(): Promise<{ latitude: number; longitude: number } | null> {
      if ('geolocation' in navigator) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 5000,
              maximumAge: 300000,
            });
          });
          return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch {
          // Fall through to IP
        }
      }
      try {
        const res = await fetch('/api/get-location');
        if (res.ok) {
          const data = await res.json();
          if (data.latitude != null && data.longitude != null) {
            return { latitude: data.latitude, longitude: data.longitude };
          }
        }
      } catch {
        // IP location unavailable
      }
      return null;
    }

    (async () => {
      try {
        const loc = await getCoords();
        if (cancelled || !loc) return;

        setCoords(loc);
        const result = await fetchMatches(0, loc.latitude, loc.longitude, activeSportId);
        if (result && !cancelled) {
          setMatches(result.matches);
          setHasMore(result.hasMore);
          setOffset(result.matches.length);
        }
      } catch {
        // Keep SSR results
      } finally {
        if (!cancelled) setLocationLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMatches, activeSportId]);

  // Sport filter change
  const handleSportChange = async (sportId: string | null) => {
    setActiveSportId(sportId);
    // Data will re-fetch via the useEffect dependency on activeSportId
    // Reset to show skeletons
    setLocationLoaded(false);
    setMatches([]);
    setOffset(0);
    setHasMore(false);

    try {
      const result = await fetchMatches(0, coords?.latitude, coords?.longitude, sportId);
      if (result) {
        setMatches(result.matches);
        setHasMore(result.hasMore);
        setOffset(result.matches.length);
      }
    } finally {
      setLocationLoaded(true);
    }
  };

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      const result = await fetchMatches(offset, coords?.latitude, coords?.longitude, activeSportId);
      if (result) {
        setMatches(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMatches = result.matches.filter(m => !existingIds.has(m.id));
          return [...prev, ...newMatches];
        });
        setHasMore(result.hasMore);
        setOffset(prev => prev + result.matches.length);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleJoin = (matchId: string) => {
    setJoinMatchId(matchId);
    setJoinDialogOpen(true);
  };

  // Group matches by date
  const dateGroups = useMemo(() => {
    const groups: Array<{ label: string; date: string; matches: PublicMatch[] }> = [];
    let currentDate = '';

    for (const match of matches) {
      if (match.match_date !== currentDate) {
        currentDate = match.match_date;
        const label = getRelativeDateLabel(match.match_date, locale, t('today'), t('tomorrow'));
        groups.push({ label, date: match.match_date, matches: [match] });
      } else {
        groups[groups.length - 1].matches.push(match);
      }
    }

    return groups;
  }, [matches, locale, t]);

  // Loading state
  const isLoading = !locationLoaded && matches.length === 0;

  // Empty state
  if (matches.length === 0 && locationLoaded) {
    return (
      <>
        {/* Sport filter tabs */}
        {sports.length > 0 && (
          <SportFilterTabs
            sports={sports}
            activeSportId={activeSportId}
            onChange={handleSportChange}
            allLabel={t('allSports')}
          />
        )}
        <div className="flex flex-col items-center text-center gap-6 py-20">
          <div className="size-16 rounded-full bg-muted flex items-center justify-center">
            <CalendarX className="size-8 text-muted-foreground" />
          </div>
          <div className="space-y-2 max-w-md">
            <h2 className="text-2xl font-bold">{t('emptyTitle')}</h2>
            <p className="text-muted-foreground">{t('emptyDescription')}</p>
          </div>
          <Button asChild variant="default" size="lg" className="font-semibold">
            <Link href="/beta">{t('emptyCta')}</Link>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Sport filter tabs */}
      {sports.length > 0 && (
        <SportFilterTabs
          sports={sports}
          activeSportId={activeSportId}
          onChange={handleSportChange}
          allLabel={t('allSports')}
        />
      )}

      {/* Skeleton loading */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <MatchCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Date-grouped match cards */}
      {!isLoading &&
        dateGroups.map(group => (
          <div key={group.date} className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-foreground capitalize">{group.label}</h3>
            <div className="-mx-8 flex gap-6 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pl-8">
              {group.matches.map(match => (
                <div key={match.id} className="w-[320px] shrink-0 snap-start">
                  <PublicMatchCard match={match} onJoin={handleJoin} />
                </div>
              ))}
              <div className="shrink-0 w-8 min-w-[2rem]" aria-hidden>
                &nbsp;
              </div>
            </div>
          </div>
        ))}

      {hasMore && (
        <div className="flex justify-center mt-8">
          <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t('loadMore')}
              </>
            ) : (
              t('loadMore')
            )}
          </Button>
        </div>
      )}

      <JoinMatchDialog
        matchId={joinMatchId}
        open={joinDialogOpen}
        onOpenChange={setJoinDialogOpen}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sport Filter Tabs
// ---------------------------------------------------------------------------

function SportFilterTabs({
  sports,
  activeSportId,
  onChange,
  allLabel,
}: {
  sports: Sport[];
  activeSportId: string | null;
  onChange: (sportId: string | null) => void;
  allLabel: string;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <button
        onClick={() => onChange(null)}
        className={cn(
          'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
          activeSportId === null
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
        )}
      >
        {allLabel}
      </button>
      {sports.map(sport => (
        <button
          key={sport.id}
          onClick={() => onChange(sport.id)}
          className={cn(
            'px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize',
            activeSportId === sport.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
          )}
        >
          {sport.name}
        </button>
      ))}
    </div>
  );
}
