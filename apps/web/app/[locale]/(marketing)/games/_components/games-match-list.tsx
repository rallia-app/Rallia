'use client';

import { CalendarX, ChevronLeft, ChevronRight, LayoutGrid, Loader2, MapIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import GamesMatchMap from './games-match-map';
import MatchCardSkeleton from './match-card-skeleton';
import PublicMatchCard, { type PublicMatch } from './public-match-card';
import { getRelativeDateLabel, matchesDateChip, type DateChip } from './utils';

import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

type ViewMode = 'list' | 'map';

const PAGE_SIZE = 36;

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
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [matches, setMatches] = useState<PublicMatch[]>(initialMatches);
  const [hasMore, setHasMore] = useState(initialMatches.length >= PAGE_SIZE);
  const [offset, setOffset] = useState(initialMatches.length);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [locationLoaded, setLocationLoaded] = useState(false);
  const [viewerPlayerId, setViewerPlayerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setViewerPlayerId(data.session?.user?.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setViewerPlayerId(session?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  // Sport filter
  const [sports, setSports] = useState<Sport[]>([]);
  const [activeSportId, setActiveSportId] = useState<string | null>(null);

  // Scope filter: all games vs. only the signed-in viewer's games
  const [mineOnly, setMineOnly] = useState(false);

  // Date filter (client-side — the RPC returns matches ordered by date)
  const [dateFilter, setDateFilter] = useState<DateChip>('all');

  // List vs. map presentation
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Map view loads the FULL set (no pagination) — a map with a "load more"
  // button makes no sense; every match in range should appear at once.
  const [mapMatches, setMapMatches] = useState<PublicMatch[]>([]);
  const [mapLoading, setMapLoading] = useState(false);

  const handleJoin = (matchId: string) => {
    router.push(`/join/match/${matchId}`);
  };

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
      sportId?: string | null,
      mine?: boolean,
      limit: number = PAGE_SIZE
    ) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(fetchOffset),
      });
      if (lat != null && lng != null) {
        params.set('latitude', String(lat));
        params.set('longitude', String(lng));
      }
      if (sportId) {
        params.set('sportId', sportId);
      }
      if (mine) {
        params.set('mine', '1');
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
        const result = await fetchMatches(0, loc.latitude, loc.longitude, activeSportId, mineOnly);
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
  }, [fetchMatches, activeSportId, mineOnly]);

  // When the map view is active, pull every match in range (paginated to
  // completion), refetching whenever coords or the sport/scope filters change.
  useEffect(() => {
    if (viewMode !== 'map') return;
    let cancelled = false;

    (async () => {
      setMapLoading(true);
      try {
        const MAP_PAGE = 200;
        const all: PublicMatch[] = [];
        const seen = new Set<string>();
        let pageOffset = 0;
        for (;;) {
          const result = await fetchMatches(
            pageOffset,
            coords?.latitude,
            coords?.longitude,
            activeSportId,
            mineOnly,
            MAP_PAGE
          );
          if (!result || result.matches.length === 0) break;
          for (const m of result.matches) {
            if (!seen.has(m.id)) {
              seen.add(m.id);
              all.push(m);
            }
          }
          pageOffset += result.matches.length;
          if (!result.hasMore) break;
        }
        if (!cancelled) setMapMatches(all);
      } finally {
        if (!cancelled) setMapLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewMode, coords, activeSportId, mineOnly, fetchMatches]);

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
      const result = await fetchMatches(0, coords?.latitude, coords?.longitude, sportId, mineOnly);
      if (result) {
        setMatches(result.matches);
        setHasMore(result.hasMore);
        setOffset(result.matches.length);
      }
    } finally {
      setLocationLoaded(true);
    }
  };

  // Scope filter change (all games vs. my games)
  const handleScopeChange = async (mine: boolean) => {
    setMineOnly(mine);
    setLocationLoaded(false);
    setMatches([]);
    setOffset(0);
    setHasMore(false);

    try {
      const result = await fetchMatches(
        0,
        coords?.latitude,
        coords?.longitude,
        activeSportId,
        mine
      );
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
      const result = await fetchMatches(
        offset,
        coords?.latitude,
        coords?.longitude,
        activeSportId,
        mineOnly
      );
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

  const visibleMatches = useMemo(
    () =>
      dateFilter === 'all'
        ? matches
        : matches.filter(m => matchesDateChip(m.match_date, dateFilter)),
    [matches, dateFilter]
  );

  const visibleMapMatches = useMemo(
    () =>
      dateFilter === 'all'
        ? mapMatches
        : mapMatches.filter(m => matchesDateChip(m.match_date, dateFilter)),
    [mapMatches, dateFilter]
  );

  // Group matches by date
  const dateGroups = useMemo(() => {
    const groups: Array<{
      label: string;
      sublabel: string | null;
      date: string;
      matches: PublicMatch[];
    }> = [];
    let currentDate = '';
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    for (const match of visibleMatches) {
      if (match.match_date !== currentDate) {
        currentDate = match.match_date;
        const label = getRelativeDateLabel(match.match_date, locale, t('today'), t('tomorrow'));
        const date = new Date(match.match_date + 'T00:00:00');
        const dayDiff = Math.round((date.getTime() - todayStart.getTime()) / 86400000);
        // The label is already the full date beyond 6 days out — no sublabel needed
        const sublabel =
          dayDiff < 7 ? date.toLocaleDateString(locale, { month: 'long', day: 'numeric' }) : null;
        groups.push({ label, sublabel, date: match.match_date, matches: [match] });
      } else {
        groups[groups.length - 1].matches.push(match);
      }
    }

    return groups;
  }, [visibleMatches, locale, t]);

  // Loading state
  const isLoading = !locationLoaded && matches.length === 0;

  const filterControls = (
    <div className="sticky top-3 z-40 flex w-full justify-center">
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-2 rounded-2xl border border-border/70 bg-background/85 px-3 py-2 shadow-lg shadow-black/5 backdrop-blur-md">
        <ViewToggle
          viewMode={viewMode}
          onChange={setViewMode}
          listLabel={t('listView')}
          mapLabel={t('mapView')}
        />

        {sports.length > 0 && (
          <>
            <ControlDivider />
            <SportFilterTabs
              sports={sports}
              activeSportId={activeSportId}
              onChange={handleSportChange}
              allLabel={t('allSports')}
            />
          </>
        )}

        <ControlDivider />
        <DateChips value={dateFilter} onChange={setDateFilter} />

        {viewerPlayerId && (
          <>
            <ControlDivider />
            <ScopeToggle
              mineOnly={mineOnly}
              onChange={handleScopeChange}
              allLabel={t('allGames')}
              mineLabel={t('myGames')}
            />
          </>
        )}
      </div>
    </div>
  );

  const mapCenter: [number, number] | null = coords ? [coords.latitude, coords.longitude] : null;

  // Empty state (list view only — map view still renders, centered on the user)
  if (viewMode === 'list' && matches.length === 0 && locationLoaded) {
    return (
      <>
        {filterControls}
        <div className="flex w-full flex-col items-center gap-6 py-20 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted ring-8 ring-muted/40">
            <CalendarX className="size-8 text-muted-foreground" />
          </div>
          <div className="max-w-md space-y-2">
            <h2 className="text-2xl font-bold">
              {mineOnly ? t('myGamesEmptyTitle') : t('emptyTitle')}
            </h2>
            <p className="text-muted-foreground">
              {mineOnly ? t('myGamesEmptyDescription') : t('emptyDescription')}
            </p>
          </div>
          {mineOnly ? (
            <Button
              variant="default"
              size="lg"
              className="font-semibold"
              onClick={() => handleScopeChange(false)}
            >
              {t('myGamesEmptyCta')}
            </Button>
          ) : (
            <Button asChild variant="default" size="lg" className="font-semibold">
              <Link href="/#download">{t('emptyCta')}</Link>
            </Button>
          )}
        </div>
      </>
    );
  }

  if (viewMode === 'map') {
    return (
      <>
        {filterControls}
        <GamesMatchMap
          matches={visibleMapMatches}
          isLoading={mapLoading}
          viewerPlayerId={viewerPlayerId}
          center={mapCenter}
          onJoin={handleJoin}
        />
      </>
    );
  }

  return (
    <>
      {filterControls}

      {/* Skeleton loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <MatchCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* All loaded matches hidden by the date filter */}
      {!isLoading && visibleMatches.length === 0 && matches.length > 0 && (
        <div className="flex w-full flex-col items-center gap-4 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <CalendarX className="size-6 text-muted-foreground" />
          </div>
          <p className="font-medium">{t('noFilteredTitle')}</p>
          <Button variant="outline" size="sm" onClick={() => setDateFilter('all')}>
            {t('clearFilters')}
          </Button>
        </div>
      )}

      {/* Date-grouped match cards */}
      {!isLoading &&
        dateGroups.map(group => (
          <section key={group.date} className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-xl font-bold capitalize tracking-tight">{group.label}</h3>
              {group.sublabel && (
                <span className="text-sm text-muted-foreground">{group.sublabel}</span>
              )}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {t('gamesCount', { count: group.matches.length })}
              </span>
            </div>
            <CarouselRow itemCount={group.matches.length}>
              {group.matches.map(match => (
                <div key={match.id} className="w-[320px] shrink-0 snap-start">
                  <PublicMatchCard
                    match={match}
                    viewerPlayerId={viewerPlayerId}
                    onJoin={handleJoin}
                  />
                </div>
              ))}
              <div className="w-8 min-w-[2rem] shrink-0" aria-hidden>
                &nbsp;
              </div>
            </CarouselRow>
          </section>
        ))}

      {hasMore && (
        <div className="mt-8 flex w-full justify-center">
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Carousel row with desktop arrows + edge fades
// ---------------------------------------------------------------------------

function CarouselRow({ children, itemCount }: { children: React.ReactNode; itemCount: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ prev: false, next: false });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdges({
      prev: el.scrollLeft > 8,
      next: el.scrollLeft < el.scrollWidth - el.clientWidth - 8,
    });
  }, []);

  useEffect(() => {
    updateEdges();
    window.addEventListener('resize', updateEdges);
    return () => window.removeEventListener('resize', updateEdges);
  }, [updateEdges, itemCount]);

  const scrollByDir = (dir: number) => {
    const el = scrollRef.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <div className="group/row relative w-full">
      <div
        ref={scrollRef}
        onScroll={updateEdges}
        className="-mx-8 flex snap-x gap-5 overflow-x-auto scroll-pl-8 px-8 pb-1 [mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-2rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      {edges.prev && <CarouselArrow dir={-1} onClick={() => scrollByDir(-1)} />}
      {edges.next && <CarouselArrow dir={1} onClick={() => scrollByDir(1)} />}
    </div>
  );
}

function CarouselArrow({ dir, onClick }: { dir: number; onClick: () => void }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      tabIndex={-1}
      aria-hidden
      className={cn(
        'absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border bg-background/95 shadow-md backdrop-blur transition-all hover:scale-105 hover:bg-background lg:flex',
        'opacity-0 group-hover/row:opacity-100 focus:opacity-100',
        dir < 0 ? '-left-5' : '-right-5'
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// View Toggle (list vs. map)
// ---------------------------------------------------------------------------

function ViewToggle({
  viewMode,
  onChange,
  listLabel,
  mapLabel,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
  listLabel: string;
  mapLabel: string;
}) {
  return (
    <div className="inline-flex rounded-full bg-muted p-0.5">
      <button
        onClick={() => onChange('list')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
          viewMode === 'list'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <LayoutGrid className="size-3.5" />
        {listLabel}
      </button>
      <button
        onClick={() => onChange('map')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
          viewMode === 'map'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <MapIcon className="size-3.5" />
        {mapLabel}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date filter chips
// ---------------------------------------------------------------------------

function DateChips({ value, onChange }: { value: DateChip; onChange: (chip: DateChip) => void }) {
  const t = useTranslations('gamesPage');
  const chips: Array<{ key: DateChip; label: string }> = [
    { key: 'all', label: t('dateAll') },
    { key: 'today', label: t('today') },
    { key: 'tomorrow', label: t('tomorrow') },
    { key: 'weekend', label: t('dateWeekend') },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {chips.map(chip => (
        <button
          key={chip.key}
          onClick={() => onChange(chip.key)}
          className={cn(
            'rounded-full border px-3 py-1 text-[13px] font-medium transition-colors',
            value === chip.key
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scope Toggle (all games vs. my games)
// ---------------------------------------------------------------------------

function ScopeToggle({
  mineOnly,
  onChange,
  allLabel,
  mineLabel,
}: {
  mineOnly: boolean;
  onChange: (mine: boolean) => void;
  allLabel: string;
  mineLabel: string;
}) {
  return (
    <div className="inline-flex rounded-full bg-muted p-0.5">
      <button
        onClick={() => onChange(false)}
        className={cn(
          'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
          !mineOnly
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {allLabel}
      </button>
      <button
        onClick={() => onChange(true)}
        className={cn(
          'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
          mineOnly
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {mineLabel}
      </button>
    </div>
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
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <button
        onClick={() => onChange(null)}
        className={cn(
          'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
          activeSportId === null
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
        )}
      >
        {allLabel}
      </button>
      {sports.map(sport => (
        <button
          key={sport.id}
          onClick={() => onChange(sport.id)}
          className={cn(
            'rounded-full px-3 py-1.5 text-sm font-medium capitalize transition-colors',
            activeSportId === sport.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
          )}
        >
          {sport.name}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Control bar divider
// ---------------------------------------------------------------------------

function ControlDivider() {
  return <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />;
}
