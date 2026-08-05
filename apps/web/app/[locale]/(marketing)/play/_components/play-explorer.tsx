'use client';

import {
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Info,
  LayoutGrid,
  Loader2,
  LocateFixed,
  MapIcon,
  Search,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FacilitySearchResult } from '@rallia/shared-types';

import FacilityCard, { type PublicFacility, type SlotGroupRef } from './facility-card';
import FacilityCardSkeleton from './facility-card-skeleton';
import { getMatchCounts } from './match-card-parts';
import MatchCardSkeleton from './match-card-skeleton';
import PlayMap from './play-map';
import PublicMatchCard, { type PublicMatch } from './public-match-card';
import { getRelativeDateLabel, matchesDateChip, type DateChip } from './utils';

import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { courtsBookClicked } from '@/lib/analytics';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

export type ViewMode = 'list' | 'map';
export type PlayKind = 'all' | 'games' | 'courts';

/** Filter state hydrated from the URL by the server page (deep links). */
export interface PlayInitialParams {
  kind: PlayKind;
  view: ViewMode;
  sportSlug: string | null;
  date: DateChip;
  mine: boolean;
  openOnly: boolean;
  query: string;
}

/** A map query origin: center + radius derived from the viewport. */
export interface MapArea {
  lat: number;
  lng: number;
  radiusKm: number;
}

const MATCH_PAGE_SIZE = 36;
const FACILITY_PAGE_SIZE = 24;
/** Results beyond this radius aren't "near you" — lists cap here and only
 * widen (with a notice) when the capped search comes back empty. */
export const SEARCH_RADIUS_KM = 100;
// Map view loads one page per dataset around the queried area.
const MAP_MATCH_LIMIT = 200;
const MAP_FACILITY_LIMIT = 300;
const MIN_AREA_RADIUS_KM = 2;
const MAX_AREA_RADIUS_KM = 300;

interface Sport {
  id: string;
  name: string;
  slug: string;
}

interface PlayExplorerProps {
  initialMatches: PublicMatch[];
  initialFacilities: FacilitySearchResult[];
  /** Approximate visitor location resolved server-side from request geo headers. */
  initialCoords: { latitude: number; longitude: number } | null;
  initialParams: PlayInitialParams;
}

export default function PlayExplorer({
  initialMatches,
  initialFacilities,
  initialCoords,
  initialParams,
}: PlayExplorerProps) {
  const t = useTranslations('playPage');
  const tGames = useTranslations('gamesPage');
  const tCourts = useTranslations('courtsPage');
  const locale = useLocale();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Shared state ------------------------------------------------------------
  const [kind, setKind] = useState<PlayKind>(initialParams.kind);
  const [viewMode, setViewMode] = useState<ViewMode>(initialParams.view);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    initialCoords
  );
  const [locationResolved, setLocationResolved] = useState(initialCoords != null);
  const [locating, setLocating] = useState(false);
  const [usedPreciseLocation, setUsedPreciseLocation] = useState(false);
  const [geoFailed, setGeoFailed] = useState(false);
  const [sports, setSports] = useState<Sport[]>([]);
  const [activeSportSlug, setActiveSportSlug] = useState<string | null>(initialParams.sportSlug);
  const [viewerPlayerId, setViewerPlayerId] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Games state -------------------------------------------------------------
  const [matches, setMatches] = useState<PublicMatch[]>(initialMatches);
  const [matchesHasMore, setMatchesHasMore] = useState(initialMatches.length >= MATCH_PAGE_SIZE);
  const [matchesOffset, setMatchesOffset] = useState(initialMatches.length);
  const [matchesLoaded, setMatchesLoaded] = useState(true);
  const [matchesWidened, setMatchesWidened] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateChip>(initialParams.date);
  const [mineOnly, setMineOnly] = useState(initialParams.mine);
  const [openOnly, setOpenOnly] = useState(initialParams.openOnly);

  // Courts state ------------------------------------------------------------
  const [facilities, setFacilities] = useState<PublicFacility[]>(initialFacilities);
  const [facilitiesHasMore, setFacilitiesHasMore] = useState(
    initialFacilities.length >= FACILITY_PAGE_SIZE
  );
  const [facilitiesOffset, setFacilitiesOffset] = useState(initialFacilities.length);
  const [facilitiesLoaded, setFacilitiesLoaded] = useState(true);
  const [facilitiesWidened, setFacilitiesWidened] = useState(false);
  const [searchInput, setSearchInput] = useState(initialParams.query);
  const [query, setQuery] = useState(initialParams.query);

  // Map state — loaded per queried area, not paginated to completion.
  const [mapMatches, setMapMatches] = useState<PublicMatch[]>([]);
  const [mapFacilities, setMapFacilities] = useState<PublicFacility[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapArea, setMapArea] = useState<MapArea | null>(null);
  // Bumped when the map should re-frame its markers (never for manual area
  // searches — the visitor already framed the viewport themselves).
  const [mapFitNonce, setMapFitNonce] = useState(0);

  const activeSportId = useMemo(
    () => sports.find(s => s.slug === activeSportSlug)?.id ?? null,
    [sports, activeSportSlug]
  );

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

  // Location: the server already resolved an approximate position from the
  // request when it could; otherwise fall back to IP lookup. Precise browser
  // geolocation is only requested when the visitor asks for it.
  useEffect(() => {
    if (initialCoords != null) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/get-location');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.latitude != null && data.longitude != null) {
            setCoords({ latitude: data.latitude, longitude: data.longitude });
          }
        }
      } catch {
        // IP location unavailable.
      } finally {
        if (!cancelled) setLocationResolved(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialCoords]);

  const requestPreciseLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeoFailed(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocationResolved(true);
        setUsedPreciseLocation(true);
        setMapArea(null);
        setLocating(false);
      },
      () => {
        setGeoFailed(true);
        setLocating(false);
      },
      { timeout: 8000, maximumAge: 300000 }
    );
  }, []);

  // Mirror the filter state into the URL (?kind=&view=&sport=&date=&mine=&open=&q=)
  // so views are shareable and survive refresh — replaceState avoids a server
  // round-trip and keeps scroll position.
  useEffect(() => {
    const url = new URL(window.location.href);
    const assign = (key: string, value: string | null) => {
      if (value == null || value === '') url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    };
    assign('kind', kind === (viewMode === 'map' ? 'all' : 'games') ? null : kind);
    assign('view', viewMode === 'list' ? null : viewMode);
    assign('sport', activeSportSlug);
    assign('date', dateFilter === 'all' ? null : dateFilter);
    assign('mine', mineOnly ? '1' : null);
    assign('open', openOnly ? '1' : null);
    assign('q', query || null);
    const qs = url.searchParams.toString();
    const next = `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(null, '', next);
  }, [kind, viewMode, activeSportSlug, dateFilter, mineOnly, openOnly, query]);

  // Fetchers ----------------------------------------------------------------
  const fetchMatches = useCallback(
    async (
      fetchOffset: number,
      lat?: number | null,
      lng?: number | null,
      sportId?: string | null,
      mine?: boolean,
      limit: number = MATCH_PAGE_SIZE,
      maxKm: number | null = null
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
      if (maxKm != null) params.set('maxKm', String(maxKm));
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
      limit: number = FACILITY_PAGE_SIZE,
      maxKm: number | null = null
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
      if (maxKm != null) params.set('maxKm', String(maxKm));
      const res = await fetch(`/api/public-facilities?${params}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ facilities: PublicFacility[]; hasMore: boolean }>;
    },
    []
  );

  // List refetches — each dataset re-queries from page 0 when its inputs
  // change, once a location decision has been made (found or not). Searches
  // are capped to SEARCH_RADIUS_KM around a real origin; an empty capped page
  // widens to uncapped with a notice.
  useEffect(() => {
    if (!locationResolved) return;
    let cancelled = false;

    (async () => {
      setMatchesLoaded(false);
      try {
        const capped = coords != null;
        let widened = false;
        let result = await fetchMatches(
          0,
          coords?.latitude,
          coords?.longitude,
          activeSportId,
          mineOnly,
          MATCH_PAGE_SIZE,
          capped ? SEARCH_RADIUS_KM : null
        );
        if (capped && result && result.matches.length === 0) {
          const wide = await fetchMatches(
            0,
            coords?.latitude,
            coords?.longitude,
            activeSportId,
            mineOnly,
            MATCH_PAGE_SIZE,
            null
          );
          if (wide && wide.matches.length > 0) {
            result = wide;
            widened = true;
          }
        }
        if (result && !cancelled) {
          setMatches(result.matches);
          setMatchesHasMore(result.hasMore);
          setMatchesOffset(result.matches.length);
          setMatchesWidened(widened);
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
        // A name search should find the facility no matter how far it is.
        const capped = coords != null && !query;
        let widened = false;
        let result = await fetchFacilities(
          0,
          coords?.latitude,
          coords?.longitude,
          activeSportId,
          query,
          FACILITY_PAGE_SIZE,
          capped ? SEARCH_RADIUS_KM : null
        );
        if (capped && result && result.facilities.length === 0) {
          const wide = await fetchFacilities(
            0,
            coords?.latitude,
            coords?.longitude,
            activeSportId,
            query,
            FACILITY_PAGE_SIZE,
            null
          );
          if (wide && wide.facilities.length > 0) {
            result = wide;
            widened = true;
          }
        }
        if (result && !cancelled) {
          setFacilities(result.facilities);
          setFacilitiesHasMore(result.hasMore);
          setFacilitiesOffset(result.facilities.length);
          setFacilitiesWidened(widened);
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
  // filter so the other views never run on an invisible query.
  const handleKindChange = (next: PlayKind) => {
    setKind(next);
    if (next !== 'courts' && (searchInput || query)) {
      setSearchInput('');
      setQuery('');
    }
  };

  // "All" only exists on the map (the one surface that mixes both datasets);
  // lists are always a single kind.
  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'list' && kind === 'all') setKind('games');
  };

  // Map data — one page per dataset around the queried area (the visitor's
  // location by default, or wherever they last hit "search this area").
  useEffect(() => {
    if (viewMode !== 'map') return;
    let cancelled = false;

    const origin: MapArea | null =
      mapArea ??
      (coords ? { lat: coords.latitude, lng: coords.longitude, radiusKm: SEARCH_RADIUS_KM } : null);

    (async () => {
      setMapLoading(true);
      try {
        const fetchBoth = (maxKm: number | null) =>
          Promise.all([
            fetchMatches(
              0,
              origin?.lat,
              origin?.lng,
              activeSportId,
              mineOnly,
              MAP_MATCH_LIMIT,
              maxKm
            ),
            fetchFacilities(
              0,
              origin?.lat,
              origin?.lng,
              activeSportId,
              query,
              MAP_FACILITY_LIMIT,
              query ? null : maxKm
            ),
          ]);

        let [matchResult, facilityResult] = await fetchBoth(origin ? origin.radiusKm : null);
        // Nothing around the visitor's own area → widen like the lists do.
        // Manual area searches stay honest: an empty area shows empty.
        if (
          !mapArea &&
          origin &&
          (matchResult?.matches.length ?? 0) === 0 &&
          (facilityResult?.facilities.length ?? 0) === 0
        ) {
          [matchResult, facilityResult] = await fetchBoth(null);
        }
        if (!cancelled) {
          setMapMatches(matchResult?.matches ?? []);
          setMapFacilities(facilityResult?.facilities ?? []);
          if (!mapArea) setMapFitNonce(n => n + 1);
        }
      } finally {
        if (!cancelled) setMapLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewMode, coords, activeSportId, mineOnly, query, mapArea, fetchMatches, fetchFacilities]);

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
      if (activeSportSlug) params.set('sport', activeSportSlug);
      if (slot) {
        params.set('start', slot.start);
        params.set('end', slot.end);
      }
      const search = params.size > 0 ? `?${params.toString()}` : '';
      router.push(`/book/facility/${facility.id}${search}`);
    },
    [router, activeSportSlug]
  );

  const handleSearchArea = useCallback((area: MapArea) => {
    setMapArea({
      lat: area.lat,
      lng: area.lng,
      radiusKm: Math.min(MAX_AREA_RADIUS_KM, Math.max(MIN_AREA_RADIUS_KM, area.radiusKm)),
    });
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      if (kind === 'games' && matchesHasMore) {
        const maxKm = coords != null && !matchesWidened ? SEARCH_RADIUS_KM : null;
        const result = await fetchMatches(
          matchesOffset,
          coords?.latitude,
          coords?.longitude,
          activeSportId,
          mineOnly,
          MATCH_PAGE_SIZE,
          maxKm
        );
        if (result) {
          setMatches(prev => {
            const existing = new Set(prev.map(m => m.id));
            return [...prev, ...result.matches.filter(m => !existing.has(m.id))];
          });
          setMatchesHasMore(result.hasMore);
          setMatchesOffset(prev => prev + result.matches.length);
        }
      }
      if (kind === 'courts' && facilitiesHasMore) {
        const maxKm = coords != null && !query && !facilitiesWidened ? SEARCH_RADIUS_KM : null;
        const result = await fetchFacilities(
          facilitiesOffset,
          coords?.latitude,
          coords?.longitude,
          activeSportId,
          query,
          FACILITY_PAGE_SIZE,
          maxKm
        );
        if (result) {
          setFacilities(prev => {
            const existing = new Set(prev.map(f => f.id));
            return [...prev, ...result.facilities.filter(f => !existing.has(f.id))];
          });
          setFacilitiesHasMore(result.hasMore);
          setFacilitiesOffset(prev => prev + result.facilities.length);
        }
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    isLoadingMore,
    kind,
    matchesHasMore,
    matchesOffset,
    matchesWidened,
    facilitiesHasMore,
    facilitiesOffset,
    facilitiesWidened,
    coords,
    activeSportId,
    mineOnly,
    query,
    fetchMatches,
    fetchFacilities,
  ]);

  // Derived data ------------------------------------------------------------
  const availableMatches = useMemo(
    () => (openOnly ? matches.filter(m => !getMatchCounts(m).isFull) : matches),
    [matches, openOnly]
  );

  const visibleMatches = useMemo(
    () =>
      dateFilter === 'all' || kind !== 'games'
        ? availableMatches
        : availableMatches.filter(m => matchesDateChip(m.match_date, dateFilter)),
    [availableMatches, dateFilter, kind]
  );

  const visibleMapMatches = useMemo(() => {
    let list = openOnly ? mapMatches.filter(m => !getMatchCounts(m).isFull) : mapMatches;
    if (dateFilter !== 'all' && kind === 'games') {
      list = list.filter(m => matchesDateChip(m.match_date, dateFilter));
    }
    return list;
  }, [mapMatches, dateFilter, kind, openOnly]);

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

  // List views are always a single kind ("all" exists only on the map).
  const hasMore =
    (kind === 'games' && matchesHasMore) || (kind === 'courts' && facilitiesHasMore);

  const isEmpty =
    !isLoading &&
    matchesLoaded &&
    facilitiesLoaded &&
    (kind === 'courts' ? facilities.length === 0 : matches.length === 0);

  const showWidenedNotice =
    coords != null &&
    !isLoading &&
    !isEmpty &&
    (kind === 'courts' ? facilitiesWidened : matchesWidened);

  // Auto-load the next page as the sentinel scrolls into range (button kept
  // as a no-JS-observer fallback).
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || viewMode !== 'list') return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) void handleLoadMore();
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, viewMode, handleLoadMore]);

  // Controls ----------------------------------------------------------------
  const filterControls = (
    <div className="sticky top-3 z-40 flex w-full flex-col items-center gap-3">
      <div className="flex w-full max-w-full flex-nowrap items-center justify-start gap-x-2 gap-y-2 overflow-x-auto rounded-2xl border border-border/70 bg-background/85 px-3 py-2 shadow-lg shadow-black/5 backdrop-blur-md [scrollbar-width:none] sm:w-auto sm:flex-wrap sm:justify-center sm:overflow-visible [&::-webkit-scrollbar]:hidden">
        <KindChips kind={kind} includeAll={viewMode === 'map'} onChange={handleKindChange} />

        <ControlDivider />
        <ViewToggle
          viewMode={viewMode}
          onChange={handleViewChange}
          listLabel={tGames('listView')}
          mapLabel={tGames('mapView')}
        />

        {sports.length > 0 && (
          <>
            <ControlDivider />
            <SportFilterTabs
              sports={sports}
              activeSportSlug={activeSportSlug}
              onChange={setActiveSportSlug}
              allLabel={tGames('allSports')}
            />
          </>
        )}

        {kind !== 'courts' && (
          <>
            <ControlDivider />
            <button
              onClick={() => setOpenOnly(v => !v)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors',
                openOnly
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              )}
            >
              {tGames('openSpotsOnly')}
            </button>
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

        {!usedPreciseLocation && !geoFailed && (
          <>
            <ControlDivider />
            <button
              onClick={requestPreciseLocation}
              disabled={locating}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            >
              {locating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LocateFixed className="size-3.5" />
              )}
              {t('useMyLocation')}
            </button>
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

  const widenedNotice = showWidenedNotice && (
    <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
      <Info className="size-4 shrink-0" />
      {t('searchWidened', { km: SEARCH_RADIUS_KM })}
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
          fitNonce={mapFitNonce}
          onSearchArea={handleSearchArea}
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
      {widenedNotice}

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
              {kind === 'courts'
                ? tCourts('emptyTitle')
                : mineOnly
                  ? tGames('myGamesEmptyTitle')
                  : t('emptyTitle')}
            </h2>
            <p className="text-muted-foreground">
              {kind === 'courts'
                ? tCourts('emptyDescription')
                : mineOnly
                  ? tGames('myGamesEmptyDescription')
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

      {/* Games view: all loaded matches hidden by the date/spots filters */}
      {kind === 'games' && !isLoading && !isEmpty && visibleMatches.length === 0 && (
        <div className="flex w-full flex-col items-center gap-4 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <CalendarX className="size-6 text-muted-foreground" />
          </div>
          <p className="font-medium">{tGames('noFilteredTitle')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDateFilter('all');
              setOpenOnly(false);
            }}
          >
            {tGames('clearFilters')}
          </Button>
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
        <div className="mt-8 flex w-full flex-col items-center">
          <div ref={sentinelRef} aria-hidden />
          <Button variant="outline" onClick={() => void handleLoadMore()} disabled={isLoadingMore}>
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

function KindChips({
  kind,
  includeAll,
  onChange,
}: {
  kind: PlayKind;
  /** "All" is only offered on the map — lists show one kind at a time. */
  includeAll: boolean;
  onChange: (kind: PlayKind) => void;
}) {
  const t = useTranslations('playPage');
  const chips: Array<{ key: PlayKind; label: string }> = [
    ...(includeAll ? [{ key: 'all' as const, label: t('filterAll') }] : []),
    { key: 'games', label: t('filterGames') },
    { key: 'courts', label: t('filterCourts') },
  ];

  return (
    <div className="inline-flex shrink-0 rounded-full bg-muted p-0.5">
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
    <div className="inline-flex shrink-0 rounded-full bg-muted p-0.5">
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
    <div className="flex shrink-0 flex-nowrap items-center justify-center gap-1.5 sm:flex-wrap">
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
    <div className="inline-flex shrink-0 rounded-full bg-muted p-0.5">
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
  activeSportSlug,
  onChange,
  allLabel,
}: {
  sports: Sport[];
  activeSportSlug: string | null;
  onChange: (sportSlug: string | null) => void;
  allLabel: string;
}) {
  return (
    <div className="flex shrink-0 flex-nowrap items-center justify-center gap-1.5 sm:flex-wrap">
      <button
        onClick={() => onChange(null)}
        className={cn(
          'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
          activeSportSlug === null
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
        )}
      >
        {allLabel}
      </button>
      {sports.map(sport => (
        <button
          key={sport.id}
          onClick={() => onChange(sport.slug)}
          className={cn(
            'rounded-full px-3 py-1.5 text-sm font-medium capitalize transition-colors',
            activeSportSlug === sport.slug
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
  return <span className="hidden h-5 w-px shrink-0 bg-border sm:block" aria-hidden />;
}
