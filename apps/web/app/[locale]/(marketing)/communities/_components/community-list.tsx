'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Loader2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CommunityCard, { type PublicCommunity } from './community-card';
import CommunityCardSkeleton from './community-card-skeleton';
import JoinCommunityDialog from './join-community-dialog';

const PAGE_SIZE = 12;

interface Sport {
  id: string;
  name: string;
  slug: string;
}

interface CommunityListProps {
  initialCommunities: PublicCommunity[];
}

export default function CommunityList({ initialCommunities }: CommunityListProps) {
  const t = useTranslations('communitiesPage');

  const [communities, setCommunities] = useState<PublicCommunity[]>(initialCommunities);
  const [hasMore, setHasMore] = useState(initialCommunities.length >= PAGE_SIZE);
  const [offset, setOffset] = useState(initialCommunities.length);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(true);

  // Sport filter
  const [sports, setSports] = useState<Sport[]>([]);
  const [activeSportId, setActiveSportId] = useState<string | null>(null);

  // Join dialog
  const [joinCommunityId, setJoinCommunityId] = useState<string | null>(null);
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

  // Sport name map for cards
  const sportNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const sport of sports) {
      map.set(sport.id, sport.name);
    }
    return map;
  }, [sports]);

  const fetchCommunities = useCallback(async (fetchOffset: number, sportId?: string | null) => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(fetchOffset),
    });
    if (sportId) {
      params.set('sportId', sportId);
    }
    const res = await fetch(`/api/public-communities?${params}`);
    if (!res.ok) return null;
    return res.json() as Promise<{ communities: PublicCommunity[]; hasMore: boolean }>;
  }, []);

  // Sport filter change
  const handleSportChange = async (sportId: string | null) => {
    setActiveSportId(sportId);
    setDataLoaded(false);
    setCommunities([]);
    setOffset(0);
    setHasMore(false);

    try {
      const result = await fetchCommunities(0, sportId);
      if (result) {
        setCommunities(result.communities);
        setHasMore(result.hasMore);
        setOffset(result.communities.length);
      }
    } finally {
      setDataLoaded(true);
    }
  };

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      const result = await fetchCommunities(offset, activeSportId);
      if (result) {
        setCommunities(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const newCommunities = result.communities.filter(c => !existingIds.has(c.id));
          return [...prev, ...newCommunities];
        });
        setHasMore(result.hasMore);
        setOffset(prev => prev + result.communities.length);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleJoin = (communityId: string) => {
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) {
      window.location.href = 'https://apps.apple.com/app/rallia/id6760482014';
      return;
    }
    if (/android/.test(ua)) {
      window.location.href =
        'https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp';
      return;
    }
    // Desktop: show QR code dialog
    setJoinCommunityId(communityId);
    setJoinDialogOpen(true);
  };

  // Continuous autoscroll carousel
  const carouselRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el || communities.length === 0 || isPaused) return;

    const SPEED = 0.5; // px per frame
    let rafId: number;

    const step = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) {
        rafId = requestAnimationFrame(step);
        return;
      }

      el.scrollLeft += SPEED;

      // Reset to start when reaching the end
      if (el.scrollLeft >= maxScroll) {
        el.scrollLeft = 0;
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [communities, isPaused]);

  // Loading state
  const isLoading = !dataLoaded && communities.length === 0;

  // Empty state
  if (communities.length === 0 && dataLoaded) {
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
            <Users className="size-8 text-muted-foreground" />
          </div>
          <div className="space-y-2 max-w-md">
            <h2 className="text-2xl font-bold">{t('emptyTitle')}</h2>
            <p className="text-muted-foreground">{t('emptyDescription')}</p>
          </div>
          <Button asChild variant="default" size="lg" className="font-semibold">
            <Link href="/#download">{t('emptyCta')}</Link>
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
            <CommunityCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Community cards carousel */}
      {!isLoading && (
        <div
          ref={carouselRef}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          onTouchStart={() => setIsPaused(true)}
          onTouchEnd={() => setIsPaused(false)}
          className="-mx-8 flex gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pl-8"
        >
          {communities.map(community => (
            <div key={community.id} className="w-[320px] shrink-0">
              <CommunityCard
                community={community}
                sportName={community.sport_id ? sportNameMap.get(community.sport_id) : undefined}
                onJoin={handleJoin}
              />
            </div>
          ))}
          <div className="shrink-0 w-8 min-w-[2rem]" aria-hidden>
            &nbsp;
          </div>
        </div>
      )}

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

      <JoinCommunityDialog
        communityId={joinCommunityId}
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
