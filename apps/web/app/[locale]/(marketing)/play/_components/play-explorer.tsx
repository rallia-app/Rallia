'use client';

import {
  CalendarX,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Loader2,
  MapIcon,
  Search,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FacilitySearchResult } from '@rallia/shared-types';

import FacilityCard, { type PublicFacility, type SlotGroupRef } from './facility-card';
import FacilityCardSkeleton from './facility-card-skeleton';
import MatchCardSkeleton from './match-card-skeleton';
import PlayMap from './play-map';
import PublicMatchCard, { type PublicMatch } from './public-match-card';
import { getRelativeDateLabel, matchesDateChip, type DateChip } from './utils';

import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { courtsBookClicked } from '@/lib/analytics';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

type ViewMode = 'list' | 'map';
export type PlayKind = 'all' | 'games' | 'courts';

const MATCH_PAGE_SIZE = 36;
const FACILITY_PAGE_SIZE = 24;
// Map view loads full datasets; cap facilities so a huge directory can't
// spiral into dozens of sequential fetches.
const MAP_MATCH_PAGE = 200;
const MAP_FACILITY_PAGE = 100;
const MAP_FACILITY_CAP = 600;

interface Sport {
  id: string;
  name: string;
  slug: string;
}

interface PlayExplorerProps {
  initialMatches: PublicMatch[];
  initialFacilities: FacilitySearchResult[];
}

/** A list entry in the mixed "all" view, ordered by proximity. */
type MixedItem =
  | { kind: 'match'; id: string; distanceMeters: number | null; match: PublicMatch }
  | { kind: 'facility'; id: string; distanceMeters: number | null; facility: PublicFacility };

export default function PlayExplorer({ initialMatches, initialFacilities }: PlayExplorerProps) {
  const t = useTranslations('playPage');
  const tGames = useTranslations('gamesPage');
  const tCourts = useTranslations('courtsPage');
  const locale = useLocale();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Shared state ------------------------------------------------------------
  const [kind, setKind] = useState<PlayKind>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationResolved, setLocationResolved] = useState(false);
  const [sports, setSports] = useState<Sport[]>([]);
  const [activeSportId, setActiveSportId] = useState<string | null>(null);
  const [viewerPlayerId, setViewerPlayerId] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Games state -------------------------------------------------------------
  const [matches, setMatches] = useState<PublicMatch[]>(initialMatches);
  const [matchesHasMore, setMatchesHasMore] = useState(initialMatches.length >= MATCH_PAGE_SIZE);
  const [matchesOffset, setMatchesOffset] = useState(initialMatches.length);
  const [matchesLoaded, setMatchesLoaded] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateChip>('all');
  const [mineOnly, setMineOnly] = useState(false);

  // Courts state ------------------------------------------------------------
  const [facilities, setFacilities] = useState<PublicFacility[]>(initialFacilities);
  const [facilitiesHasMore, setFacilitiesHasMore] = useState(
    initialFacilities.length >= FACILITY_PAGE_SIZE
  );
  const [facilitiesOffset, setFacilitiesOffset] = useState(initialFacilities.length);
  const [facilitiesLoaded, setFacilitiesLoaded] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  // Map state — the map shows every item in range, loaded separately from the
  // paginated lists.
  const [mapMatches, setMapMatches] = useState<PublicMatch[]>([]);
  const [mapFacilities, setMapFacilities] = useState<PublicFacility[]>([]);
  const [mapLoading, setMapLoading] = useState(false);

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

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/sports');
        if (res.ok) {
          const data = await res.json();
          setSports(data.sports ?? []);
        }
      } catch {
        // Sport filter unavailable — fall back to "all".
      }
    })();
  }, []);

  // Location (browser geolocation → IP fallback), resolved once.
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
          // Fall through to IP.
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
        // IP location unavailable.
      }
      return null;
    }

    (async () => {
      const loc = await getCoords();
      if (cancelled) return;
      if (loc) setCoords(loc);
      setLocationResolved(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetchers ----------------------------------------------------------------
  const fetchMatches = useCallback(
    async (
      fetchOffset: number,
      lat?: number | null,
      lng?: number | null,
      sportId?: string | null,
      mine?: boolean,
      limit: number = MATCH_PAGE_SIZE
    ) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(fetchOffset),
      });
      if (lat != null && lng != null) {
        params.set('latitude', String(lat));
        params.set('longitude', String(lng));
      }
      if (sportId) params.set('sportId', sportId);
      if (mine) params.set('mine', '1');
      const res = await fetch(`/api/public-matches?${params}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ matches: PublicMatch[]; hasMore: boolean }>;
    },
    []
  );

  const fetchFacilities = useCallback(
    async (
      fetchOffset: number,
      lat?: number | null,
      lng?: number | null,
      sportId?: string | null,
      q?: string,
      limit: number = FACILITY_PAGE_SIZE
    ) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(fetchOffset),
      });
      if (lat != null && lng != null) {
        params.set('latitude', String(lat));
        params.set('longitude', String(lng));
      }
      if (sportId) params.set('sportId', sportId);
      if (q) params.set('query', q);
      const res = await fetch(`/api/public-facilities?${params}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ facilities: PublicFacility[]; hasMore: boolean }>;
    },
    []
  );

  // List refetches — each dataset re-queries from page 0 when its inputs
  // change, once a location decision has been made (found or not).
  useEffect(() => {
    if (!locationResolved) return;
    let cancelled = false;

    (async () => {
      setMatchesLoaded(false);
      try {
        const result = await fetchMatches(
          0,
          coords?.latitude,
          coords?.longitude,
          activeSportId,
          mineOnly
        );
        if (result && !cancelled) {
          setMatches(result.matches);
          setMatchesHasMore(result.hasMore);
          setMatchesOffset(result.matches.length);
        }
      } finally {
        if (!cancelled) setMatchesLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locationResolved, coords, activeSportId, mineOnly, fetchMatches]);

  useEffect(() => {
    if (!locationResolved) return;
    let cancelled = false;

    (async () => {
      setFacilitiesLoaded(false);
      try {
        const result = await fetchFacilities(
          0,
          coords?.latitude,
          coords?.longitude,
          activeSportId,
          query
        );
        if (result && !cancelled) {
          setFacilities(result.facilities);
          setFacilitiesHasMore(result.hasMore);
          setFacilitiesOffset(result.facilities.length);
        }
      } finally {
        if (!cancelled) setFacilitiesLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locationResolved, coords, activeSportId, query, fetchFacilities]);

  // Debounce the search input into `query`.
  useEffect(() => {
    const handle = setTimeout(() => setQuery(searchInput.trim()), 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // The search box only exists in the courts view — leaving it clears the
  // filter so the mixed view never runs on an invisible query.
  const handleKindChange = (next: PlayKind) => {
    setKind(next);
    if (next !== 'courts' && (searchInput || query)) {
      setSearchInput('');
      setQuery('');
    }
  };

  // Map data — pull the full datasets (paginated to completion), refetching
  // whenever coords or the sport/scope/search filters change.
  useEffect(() => {
    if (viewMode !== 'map') return;
    let cancelled = false;

    (async () => {
      setMapLoading(true);
      try {
        const [allMatches, allFacilities] = await Promise.all([
          (async () => {
            const out: PublicMatch[] = [];
            const seen = new Set<string>();
            let pageOffset = 0;
            for (;;) {
              const result = await fetchMatches(
                pageOffset,
                coords?.latitude,
                coords?.longitude,
                activeSportId,
                mineOnly,
                MAP_MATCH_PAGE
              );
              if (!result || result.matches.length === 0) break;
              for (const m of result.matches) {
                if (!seen.has(m.id)) {
                  seen.add(m.id);
                  out.push(m);
                }
              }
              pageOffset += result.matches.length;
              if (!result.hasMore) break;
            }
            return out;
          })(),
          (async () => {
            const out: PublicFacility[] = [];
            const seen = new Set<string>();
            let pageOffset = 0;
            while (out.length < MAP_FACILITY_CAP) {
              const result = await fetchFacilities(
                pageOffset,
                coords?.latitude,
                coords?.longitude,
                activeSportId,
                query,
                MAP_FACILITY_PAGE
              );
              if (!result || result.facilities.length === 0) break;
              for (const f of result.facilities) {
                if (!seen.has(f.id)) {
                  seen.add(f.id);
                  out.push(f);
                }
              }
              pageOffset += result.facilities.length;
              if (!result.hasMore) break;
            }
            return out;
          })(),
        ]);
        if (!cancelled) {
          setMapMatches(allMatches);
          setMapFacilities(allFacilities);
        }
      } finally {
        if (!cancelled) setMapLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewMode, coords, activeSportId, mineOnly, query, fetchMatches, fetchFacilities]);

  // Actions -----------------------------------------------------------------
  const handleJoin = useCallback(
    (matchId: string) => {
      router.push(`/join/match/${matchId}`);
    },
    [router]
  );

  // Booking runs through the signup gate, which redirects to the provider's
  // booking page once the visitor has an account.
  const handleBook = useCallback(
    (facility: PublicFacility, slot: SlotGroupRef | null) => {
      courtsBookClicked({ facility_id: facility.id, has_slot: slot !== null });
      const params = new URLSearchParams();
      // Carry the active sport filter so a multi-sport facility opens on the
      // tab the visitor was already browsing. With "all sports" the gate infers
      // it from the clicked slot instead.
      const activeSlug = sports.find(s => s.id === activeSportId)?.slug;
      if (activeSlug) params.set('sport', activeSlug);
      if (slot) {
        params.set('start', slot.start);
        params.set('end', slot.end);
      }
      const search = params.size > 0 ? `?${params.toString()}` : '';
      router.push(`/book/facility/${facility.id}${search}`);
    },
    [router, sports, activeSportId]
  );

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      const wantMatches = kind !== 'courts' && matchesHasMore;
      const wantFacilities = kind !== 'games' && facilitiesHasMore;
      const [matchResult, facilityResult] = await Promise.all([
        wantMatches
          ? fetchMatches(
              matchesOffset,
              coords?.latitude,
              coords?.longitude,
              activeSportId,
              mineOnly
            )
          : Promise.resolve(null),
        wantFacilities
          ? fetchFacilities(
              facilitiesOffset,
              coords?.latitude,
              coords?.longitude,
              activeSportId,
              query
            )
          : Promise.resolve(null),
      ]);
      if (matchResult) {
        setMatches(prev => {
          const existing = new Set(prev.map(m => m.id));
          return [...prev, ...matchResult.matches.filter(m => !existing.has(m.id))];
        });
        setMatchesHasMore(matchResult.hasMore);
        setMatchesOffset(prev => prev + matchResult.matches.length);
      }
      if (facilityResult) {
        setFacilities(prev => {
          const existing = new Set(prev.map(f => f.id));
          return [...prev, ...facilityResult.facilities.filter(f => !existing.has(f.id))];
        });
        setFacilitiesHasMore(facilityResult.hasMore);
        setFacilitiesOffset(prev => prev + facilityResult.facilities.length);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Derived data ------------------------------------------------------------
  const visibleMatches = useMemo(
    () =>
      dateFilter === 'all' || kind !== 'games'
        ? matches
        : matches.filter(m => matchesDateChip(m.match_date, dateFilter)),
    [matches, dateFilter, kind]
  );

  const visibleMapMatches = useMemo(
    () =>
      dateFilter === 'all' || kind !== 'games'
        ? mapMatches
        : mapMatches.filter(m => matchesDateChip(m.match_date, dateFilter)),
    [mapMatches, dateFilter, kind]
  );

  // The mixed "all" list interleaves both card types by proximity. Items
  // without a resolvable distance keep their fetch order at the end: matches
  // (date-ordered) first, then facilities.
  const mixedItems = useMemo<MixedItem[]>(() => {
    const items: MixedItem[] = [
      ...matches.map<MixedItem>(m => ({
        kind: 'match',
        id: m.id,
        distanceMeters: m.distance != null ? m.distance * 1000 : null,
        match: m,
      })),
      ...facilities.map<MixedItem>(f => ({
        kind: 'facility',
        id: f.id,
        distanceMeters: f.distance_meters,
        facility: f,
      })),
    ];
    return items.sort((a, b) => {
      if (a.distanceMeters != null && b.distanceMeters != null) {
        return a.distanceMeters - b.distanceMeters;
      }
      if (a.distanceMeters != null) return -1;
      if (b.distanceMeters != null) return 1;
      return 0;
    });
  }, [matches, facilities]);

  // Date-grouped games (games-only list view).
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
        const label = getRelativeDateLabel(
          match.match_date,
          locale,
          tGames('today'),
          tGames('tomorrow')
        );
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
  }, [visibleMatches, locale, tGames]);

  const isLoading =
    (kind !== 'courts' && !matchesLoaded && matches.length === 0) ||
    (kind !== 'games' && !facilitiesLoaded && facilities.length === 0);

  const hasMore = (kind !== 'courts' && matchesHasMore) || (kind !== 'games' && facilitiesHasMore);

  const isEmpty =
    !isLoading &&
    matchesLoaded &&
    facilitiesLoaded &&
    (kind === 'games'
      ? matches.length === 0
      : kind === 'courts'
        ? facilities.length === 0
        : matches.length === 0 && facilities.length === 0);

  // Controls ----------------------------------------------------------------
  const filterControls = (
    <div className="sticky top-3 z-40 flex w-full flex-col items-center gap-3">
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-2 rounded-2xl border border-border/70 bg-background/85 px-3 py-2 shadow-lg shadow-black/5 backdrop-blur-md">
        <KindChips kind={kind} onChange={handleKindChange} />

        <ControlDivider />
        <ViewToggle
          viewMode={viewMode}
          onChange={setViewMode}
          listLabel={tGames('listView')}
          mapLabel={tGames('mapView')}
        />

        {sports.length > 0 && (
          <>
            <ControlDivider />
            <SportFilterTabs
              sports={sports}
              activeSportId={activeSportId}
              onChange={setActiveSportId}
              allLabel={tGames('allSports')}
            />
          </>
        )}

        {kind === 'games' && (
          <>
            <ControlDivider />
            <DateChips value={dateFilter} onChange={setDateFilter} />
            {viewerPlayerId && (
              <>
                <ControlDivider />
                <ScopeToggle
                  mineOnly={mineOnly}
                  onChange={setMineOnly}
                  allLabel={tGames('allGames')}
                  mineLabel={tGames('myGames')}
                />
              </>
            )}
          </>
        )}
      </div>

      {kind === 'courts' && (
        <div className="flex w-full max-w-md items-center gap-2 rounded-full border border-border/70 bg-background/85 px-4 py-2 shadow-lg shadow-black/5 backdrop-blur-md">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={tCourts('searchPlaceholder')}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
    </div>
  );

  const mapCenter: [number, number] | null = coords ? [coords.latitude, coords.longitude] : null;

  // Map view ----------------------------------------------------------------
  if (viewMode === 'map') {
    return (
      <>
        {filterControls}
        <PlayMap
          matches={kind === 'courts' ? [] : visibleMapMatches}
          facilities={kind === 'games' ? [] : mapFacilities}
          kind={kind}
          isLoading={mapLoading}
          viewerPlayerId={viewerPlayerId}
          center={mapCenter}
          onJoin={handleJoin}
          onBook={handleBook}
        />
      </>
    );
  }

  // List views --------------------------------------------------------------
  return (
    <>
      {filterControls}

      {isLoading && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) =>
            kind === 'courts' ? <FacilityCardSkeleton key={i} /> : <MatchCardSkeleton key={i} />
          )}
        </div>
      )}

      {isEmpty && (
        <div className="flex w-full flex-col items-center gap-6 py-20 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted ring-8 ring-muted/40">
            <CalendarX className="size-8 text-muted-foreground" />
          </div>
          <div className="max-w-md space-y-2">
            <h2 className="text-2xl font-bold">
              {kind === 'games' && mineOnly
                ? tGames('myGamesEmptyTitle')
                : kind === 'courts'
                  ? tCourts('emptyTitle')
                  : t('emptyTitle')}
            </h2>
            <p className="text-muted-foreground">
              {kind === 'games' && mineOnly
                ? tGames('myGamesEmptyDescription')
                : kind === 'courts'
                  ? tCourts('emptyDescription')
                  : t('emptyDescription')}
            </p>
          </div>
          {kind === 'games' && mineOnly ? (
            <Button
              variant="default"
              size="lg"
              className="font-semibold"
              onClick={() => setMineOnly(false)}
            >
              {tGames('myGamesEmptyCta')}
            </Button>
          ) : (
            <Button asChild variant="default" size="lg" className="font-semibold">
              <Link href="/#download">{t('emptyCta')}</Link>
            </Button>
          )}
        </div>
      )}

      {/* Games view: all loaded matches hidden by the date filter */}
      {kind === 'games' && !isLoading && !isEmpty && visibleMatches.length === 0 && (
        <div className="flex w-full flex-col items-center gap-4 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <CalendarX className="size-6 text-muted-foreground" />
          </div>
          <p className="font-medium">{tGames('noFilteredTitle')}</p>
          <Button variant="outline" size="sm" onClick={() => setDateFilter('all')}>
            {tGames('clearFilters')}
          </Button>
        </div>
      )}

      {/* Mixed proximity grid (all) */}
      {kind === 'all' && !isLoading && !isEmpty && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {mixedItems.map(item =>
            item.kind === 'match' ? (
              <PublicMatchCard
                key={`m-${item.id}`}
                match={item.match}
                viewerPlayerId={viewerPlayerId}
                onJoin={handleJoin}
              />
            ) : (
              <FacilityCard key={`f-${item.id}`} facility={item.facility} onBook={handleBook} />
            )
          )}
        </div>
      )}

      {/* Games view: date-grouped carousels */}
      {kind === 'games' &&
        !isLoading &&
        dateGroups.map(group => (
          <section key={group.date} className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-xl font-bold capitalize tracking-tight">{group.label}</h3>
              {group.sublabel && (
                <span className="text-sm text-muted-foreground">{group.sublabel}</span>
              )}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {tGames('gamesCount', { count: group.matches.length })}
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

      {/* Courts view: facility grid */}
      {kind === 'courts' && !isLoading && !isEmpty && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {facilities.map(facility => (
            <FacilityCard key={facility.id} facility={facility} onBook={handleBook} />
          ))}
        </div>
      )}

      {hasMore && !isLoading && !isEmpty && (
        <div className="mt-8 flex w-full justify-center">
          <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
            {isLoadingMore && <Loader2 className="mr-2 size-4 animate-spin" />}
            {tGames('loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Kind chips (All / Games / Courts)
// ---------------------------------------------------------------------------

function KindChips({ kind, onChange }: { kind: PlayKind; onChange: (kind: PlayKind) => void }) {
  const t = useTranslations('playPage');
  const chips: Array<{ key: PlayKind; label: string }> = [
    { key: 'all', label: t('filterAll') },
    { key: 'games', label: t('filterGames') },
    { key: 'courts', label: t('filterCourts') },
  ];

  return (
    <div className="inline-flex rounded-full bg-muted p-0.5">
      {chips.map(chip => (
        <button
          key={chip.key}
          onClick={() => onChange(chip.key)}
          className={cn(
            'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
            kind === chip.key
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
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
