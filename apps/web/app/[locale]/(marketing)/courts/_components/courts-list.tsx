'use client';

import { Building2, Loader2, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import FacilityCard, { type PublicFacility } from './facility-card';
import FacilityCardSkeleton from './facility-card-skeleton';

import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { courtsBookClicked } from '@/lib/analytics';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 24;

interface Sport {
  id: string;
  name: string;
  slug: string;
}

interface CourtsListProps {
  initialFacilities: PublicFacility[];
}

interface FacilitiesResponse {
  facilities: PublicFacility[];
  hasMore: boolean;
}

export default function CourtsList({ initialFacilities }: CourtsListProps) {
  const t = useTranslations('courtsPage');
  const router = useRouter();

  const [facilities, setFacilities] = useState<PublicFacility[]>(initialFacilities);
  const [hasMore, setHasMore] = useState(initialFacilities.length >= PAGE_SIZE);
  const [offset, setOffset] = useState(initialFacilities.length);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [sports, setSports] = useState<Sport[]>([]);
  const [activeSportId, setActiveSportId] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  // Booking runs through the signup gate, which redirects to the provider's
  // booking page once the visitor has an account — same pattern as /games.
  const openBook = useCallback(
    (facility: PublicFacility, slotId?: string | null) => {
      courtsBookClicked({ facility_id: facility.id, has_slot: Boolean(slotId) });
      const query = slotId ? `?slot=${encodeURIComponent(slotId)}` : '';
      router.push(`/book/facility/${facility.id}${query}`);
    },
    [router]
  );

  const fetchFacilities = useCallback(
    async (
      fetchOffset: number,
      lat?: number | null,
      lng?: number | null,
      sportId?: string | null,
      q?: string
    ): Promise<FacilitiesResponse | null> => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
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
      return res.json() as Promise<FacilitiesResponse>;
    },
    []
  );

  // Load the sport filter options.
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

  // On mount, resolve a location (browser geolocation → IP fallback) and
  // re-fetch sorted by proximity. Mirrors the /games discovery flow.
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
      try {
        const loc = await getCoords();
        if (cancelled) return;
        if (loc) setCoords(loc);
        // Always refetch — even when location can't be resolved — so the sport
        // filter and search still work (the API falls back to an origin-less
        // query and simply omits distance).
        const result = await fetchFacilities(
          0,
          loc?.latitude,
          loc?.longitude,
          activeSportId,
          query
        );
        if (result && !cancelled) {
          setFacilities(result.facilities);
          setHasMore(result.hasMore);
          setOffset(result.facilities.length);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-run when the sport or debounced query changes.
  }, [fetchFacilities, activeSportId, query]);

  // Debounce the search input into `query`.
  useEffect(() => {
    const handle = setTimeout(() => setQuery(searchInput.trim()), 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const handleSportChange = async (sportId: string | null) => {
    setActiveSportId(sportId);
    setLoaded(false);
    setFacilities([]);
    setOffset(0);
    setHasMore(false);
    // Data refetches via the effect dependency on activeSportId.
  };

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      const result = await fetchFacilities(
        offset,
        coords?.latitude,
        coords?.longitude,
        activeSportId,
        query
      );
      if (result) {
        setFacilities(prev => {
          const seen = new Set(prev.map(f => f.id));
          return [...prev, ...result.facilities.filter(f => !seen.has(f.id))];
        });
        setHasMore(result.hasMore);
        setOffset(prev => prev + result.facilities.length);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  const isLoading = !loaded && facilities.length === 0;

  const controls = useMemo(
    () => (
      <div className="sticky top-3 z-40 flex w-full flex-col items-center gap-3">
        <div className="flex w-full max-w-md items-center gap-2 rounded-full border border-border/70 bg-background/85 px-4 py-2 shadow-lg shadow-black/5 backdrop-blur-md">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {sports.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-border/70 bg-background/85 px-3 py-2 shadow-lg shadow-black/5 backdrop-blur-md">
            <button
              onClick={() => handleSportChange(null)}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                activeSportId === null
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              )}
            >
              {t('allSports')}
            </button>
            {sports.map(sport => (
              <button
                key={sport.id}
                onClick={() => handleSportChange(sport.id)}
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
        )}
      </div>
    ),

    [searchInput, sports, activeSportId, t]
  );

  return (
    <>
      {controls}

      {isLoading && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <FacilityCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && facilities.length === 0 && (
        <div className="flex w-full flex-col items-center gap-6 py-20 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted ring-8 ring-muted/40">
            <Building2 className="size-8 text-muted-foreground" />
          </div>
          <div className="max-w-md space-y-2">
            <h2 className="text-2xl font-bold">{t('emptyTitle')}</h2>
            <p className="text-muted-foreground">{t('emptyDescription')}</p>
          </div>
          <Button asChild variant="default" size="lg" className="font-semibold">
            <Link href="/#download">{t('emptyCta')}</Link>
          </Button>
        </div>
      )}

      {!isLoading && facilities.length > 0 && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {facilities.map(facility => (
            <FacilityCard key={facility.id} facility={facility} onBook={openBook} />
          ))}
        </div>
      )}

      {hasMore && !isLoading && (
        <div className="mt-8 flex w-full justify-center">
          <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
            {isLoadingMore && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t('loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}
