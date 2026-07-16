'use client';

import { CalendarX, Loader2, MapPinned, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { primary, accent, status } from '@rallia/design-system';

import type { PublicMatch } from './public-match-card';
import { formatDuration, resolveMatchCoords } from './utils';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const GamesMatchMapInner = dynamic(() => import('./games-match-map-inner'), {
  ssr: false,
  loading: () => <Skeleton className="w-full h-full min-h-[420px] rounded-xl" />,
});

interface GamesMatchMapProps {
  matches: PublicMatch[];
  isLoading?: boolean;
  viewerPlayerId?: string | null;
  center: [number, number] | null;
  onJoin: (matchId: string) => void;
}

function sportColor(sportName: string | undefined): string {
  const s = sportName?.toLowerCase();
  if (s === 'tennis') return primary[500];
  if (s === 'pickleball') return accent[500];
  return status.info.DEFAULT;
}

export default function GamesMatchMap({
  matches,
  isLoading = false,
  viewerPlayerId,
  center,
  onJoin,
}: GamesMatchMapProps) {
  const t = useTranslations('gamesPage');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const mappable = useMemo(() => matches.filter(m => resolveMatchCoords(m) !== null), [matches]);

  // Drop a selection that no longer exists after a filter change
  useEffect(() => {
    if (selectedId && !mappable.some(m => m.id === selectedId)) setSelectedId(null);
  }, [mappable, selectedId]);

  const [scrollTarget, setScrollTarget] = useState<{ id: string; ts: number } | null>(null);

  const handleMarkerClick = useCallback((matchId: string) => {
    setSelectedId(matchId);
    setScrollTarget({ id: matchId, ts: Date.now() });
  }, []);

  // Scroll the panel after the selection re-render commits — scrolling inside the
  // click handler gets aborted by the re-render, and scrollIntoView animates the
  // document instead of the nested panel.
  useEffect(() => {
    if (!scrollTarget) return;
    const card = cardRefs.current.get(scrollTarget.id);
    const panel = panelRef.current;
    if (card && panel) {
      panel.scrollTo({
        top: card.offsetTop - (panel.clientHeight - card.clientHeight) / 2,
        behavior: 'smooth',
      });
    }
  }, [scrollTarget]);

  const handleCardClick = useCallback((match: PublicMatch) => {
    setSelectedId(match.id);
    const coords = resolveMatchCoords(match);
    if (coords) setFlyTo({ ...coords, ts: Date.now() });
  }, []);

  return (
    <div className="flex w-full flex-col gap-3">
      {/* Status line + sport legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MapPinned className="size-4" />
          )}
          {isLoading ? t('mapLoading') : t('mapGamesShown', { count: mappable.length })}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: primary[500] }} />
            Tennis
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: accent[500] }} />
            Pickleball
          </span>
        </span>
      </div>

      <div className="flex w-full gap-4 lg:h-[calc(100vh-9rem)] lg:min-h-[540px]">
        {/* Side panel — desktop only, synced with the map */}
        <div
          ref={panelRef}
          className="relative hidden lg:flex w-[360px] shrink-0 flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1.5 [scrollbar-width:thin]"
        >
          {isLoading && mappable.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] w-full shrink-0 rounded-xl" />
            ))
          ) : mappable.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <CalendarX className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">{t('emptyTitle')}</p>
            </div>
          ) : (
            mappable.map(match => (
              <MapPanelCard
                key={match.id}
                ref={el => {
                  if (el) cardRefs.current.set(match.id, el);
                  else cardRefs.current.delete(match.id);
                }}
                match={match}
                isActive={match.id === selectedId}
                viewerPlayerId={viewerPlayerId}
                onClick={() => handleCardClick(match)}
                onHover={hovering => setHoveredId(hovering ? match.id : null)}
                onJoin={onJoin}
              />
            ))
          )}
        </div>

        {/* Map */}
        <div className="h-[65vh] min-h-[420px] w-full min-w-0 flex-1 lg:h-full">
          <GamesMatchMapInner
            matches={mappable}
            viewerPlayerId={viewerPlayerId}
            center={center}
            onJoin={onJoin}
            panelMode={isDesktop}
            activeMatchId={selectedId}
            hoveredMatchId={hoveredId}
            onMarkerClick={handleMarkerClick}
            flyTo={flyTo}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side-panel card (compact, hover/click synced with the map)
// ---------------------------------------------------------------------------

function MapPanelCard({
  ref,
  match,
  isActive,
  viewerPlayerId,
  onClick,
  onHover,
  onJoin,
}: {
  ref: (el: HTMLDivElement | null) => void;
  match: PublicMatch;
  isActive: boolean;
  viewerPlayerId?: string | null;
  onClick: () => void;
  onHover: (hovering: boolean) => void;
  onJoin: (matchId: string) => void;
}) {
  const t = useTranslations('gamesPage');
  const locale = useLocale();

  const date = new Date(match.match_date + 'T00:00:00');
  const weekday = date.toLocaleDateString(locale, { weekday: 'short' });
  const dayNum = date.toLocaleDateString(locale, { day: 'numeric' });
  const month = date.toLocaleDateString(locale, { month: 'short' });
  const time = new Date(`${match.match_date}T${match.start_time}`).toLocaleTimeString(locale, {
    timeStyle: 'short',
  });
  const duration = match.end_time ? formatDuration(match.start_time, match.end_time) : null;

  const location = match.facility?.name || match.location_name || t('locationTBD');
  const city = match.facility?.city;

  const total = match.format === 'doubles' ? 4 : 2;
  const joinedCount = match.participants?.filter(p => p.status === 'joined').length ?? 0;
  const spotsLeft = Math.max(0, total - joinedCount);
  const isFull = spotsLeft === 0;
  const viewerIn =
    !!viewerPlayerId && !!match.participants?.some(p => p.player_id === viewerPlayerId);

  const color = sportColor(match.sport?.name);

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        'group relative flex shrink-0 cursor-pointer gap-3 rounded-xl border bg-card p-3 pl-4 text-left transition-all',
        'hover:-translate-y-px hover:border-primary/40 hover:shadow-md',
        isActive && 'border-primary shadow-md ring-2 ring-primary/20'
      )}
    >
      {/* Sport accent bar */}
      <span
        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
        style={{ background: color }}
        aria-hidden
      />

      {/* Date rail */}
      <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-muted/60 py-1.5">
        <span className="text-[10px] font-medium uppercase text-muted-foreground">{weekday}</span>
        <span className="text-lg font-bold leading-tight">{dayNum}</span>
        <span className="text-[10px] text-muted-foreground">{month}</span>
      </div>

      {/* Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            {time}
            {duration && <span className="font-normal text-muted-foreground"> · {duration}</span>}
          </span>
          {match.sport && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
              style={{ background: `${color}1a`, color }}
            >
              {match.sport.name}
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-sm font-medium">{location}</p>

        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3 shrink-0" />
            <span
              className={cn(
                'font-semibold',
                isFull
                  ? 'text-destructive'
                  : spotsLeft === 1
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
              )}
            >
              {joinedCount}/{total}
            </span>
            {city && <span className="truncate">· {city}</span>}
          </span>
          {viewerIn ? (
            <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              {t('cardStatus.joined')}
            </span>
          ) : (
            <Button
              size="sm"
              variant={isFull ? 'outline' : 'default'}
              className="h-9 shrink-0 rounded-full px-5 text-sm font-semibold"
              onClick={e => {
                e.stopPropagation();
                onJoin(match.id);
              }}
            >
              {isFull ? t('waitlistShort') : t('joinShort')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
