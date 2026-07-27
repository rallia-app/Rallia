'use client';

import { Building2, CalendarX, Loader2, MapPin, MapPinned, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { primary, accent, neutral, status } from '@rallia/design-system';

import type { PublicFacility, SlotGroupRef } from './facility-card';
import {
  buildMatchChips,
  getMatchCounts,
  PlayerSlots,
  resolveCta,
  ShareButton,
  ViewerStatusBanner,
} from './match-card-parts';
import { MatchChipRow } from './match-chip';
import { getViewerMatchStatus, getViewerParticipant } from './match-viewer-status';
import type { PlayKind } from './play-explorer';
import type { PublicMatch } from './public-match-card';
import { formatDuration, resolveMatchCoords } from './utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const PlayMapInner = dynamic(() => import('./play-map-inner'), {
  ssr: false,
  loading: () => <Skeleton className="w-full h-full min-h-[420px] rounded-xl" />,
});

export const FACILITY_MARKER_COLOR = neutral[800];

interface PlayMapProps {
  matches: PublicMatch[];
  facilities: PublicFacility[];
  kind: PlayKind;
  isLoading?: boolean;
  viewerPlayerId?: string | null;
  center: [number, number] | null;
  onJoin: (matchId: string) => void;
  onBook: (facility: PublicFacility, slot: SlotGroupRef | null) => void;
}

function sportColor(sportName: string | undefined): string {
  const s = sportName?.toLowerCase();
  if (s === 'tennis') return primary[500];
  if (s === 'pickleball') return accent[500];
  return status.info.DEFAULT;
}

/** Composite keys keep match and facility selections from colliding. */
export const matchKey = (id: string) => `m:${id}`;
export const facilityKey = (id: string) => `f:${id}`;

export default function PlayMap({
  matches,
  facilities,
  kind,
  isLoading = false,
  viewerPlayerId,
  center,
  onJoin,
  onBook,
}: PlayMapProps) {
  const t = useTranslations('playPage');
  const tGames = useTranslations('gamesPage');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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

  const mappableMatches = useMemo(
    () => matches.filter(m => resolveMatchCoords(m) !== null),
    [matches]
  );
  const mappableFacilities = useMemo(
    () => facilities.filter(f => f.latitude != null && f.longitude != null),
    [facilities]
  );

  // Panel entries mix both types, ordered by proximity in the combined view
  // (fetch order otherwise).
  const panelItems = useMemo(() => {
    const items: Array<
      | { key: string; distanceMeters: number | null; kind: 'match'; match: PublicMatch }
      | { key: string; distanceMeters: number | null; kind: 'facility'; facility: PublicFacility }
    > = [
      ...mappableMatches.map(m => ({
        key: matchKey(m.id),
        distanceMeters: m.distance != null ? m.distance * 1000 : null,
        kind: 'match' as const,
        match: m,
      })),
      ...mappableFacilities.map(f => ({
        key: facilityKey(f.id),
        distanceMeters: f.distance_meters,
        kind: 'facility' as const,
        facility: f,
      })),
    ];
    if (kind === 'all') {
      items.sort((a, b) => {
        if (a.distanceMeters != null && b.distanceMeters != null) {
          return a.distanceMeters - b.distanceMeters;
        }
        if (a.distanceMeters != null) return -1;
        if (b.distanceMeters != null) return 1;
        return 0;
      });
    }
    return items;
  }, [mappableMatches, mappableFacilities, kind]);

  // Drop a selection that no longer exists after a filter change
  useEffect(() => {
    if (selectedKey && !panelItems.some(i => i.key === selectedKey)) setSelectedKey(null);
  }, [panelItems, selectedKey]);

  const [scrollTarget, setScrollTarget] = useState<{ key: string; ts: number } | null>(null);

  const handleMarkerClick = useCallback((key: string) => {
    setSelectedKey(key);
    setScrollTarget({ key, ts: Date.now() });
  }, []);

  // Scroll the panel after the selection re-render commits — scrolling inside the
  // click handler gets aborted by the re-render, and scrollIntoView animates the
  // document instead of the nested panel.
  useEffect(() => {
    if (!scrollTarget) return;
    const card = cardRefs.current.get(scrollTarget.key);
    const panel = panelRef.current;
    if (card && panel) {
      panel.scrollTo({
        top: card.offsetTop - (panel.clientHeight - card.clientHeight) / 2,
        behavior: 'smooth',
      });
    }
  }, [scrollTarget]);

  const handleCardClick = useCallback((key: string, lat: number | null, lng: number | null) => {
    setSelectedKey(key);
    if (lat != null && lng != null) setFlyTo({ lat, lng, ts: Date.now() });
  }, []);

  const statusLabel = isLoading
    ? tGames('mapLoading')
    : kind === 'games'
      ? tGames('mapGamesShown', { count: mappableMatches.length })
      : kind === 'courts'
        ? t('mapCourtsShown', { count: mappableFacilities.length })
        : t('mapSummary', { games: mappableMatches.length, courts: mappableFacilities.length });

  return (
    <div className="flex w-full flex-col gap-3">
      {/* Status line + legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MapPinned className="size-4" />
          )}
          {statusLabel}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs">
          {kind !== 'courts' && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: primary[500] }} />
                Tennis
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: accent[500] }} />
                Pickleball
              </span>
            </>
          )}
          {kind !== 'games' && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: FACILITY_MARKER_COLOR }} />
              {t('legendCourts')}
            </span>
          )}
        </span>
      </div>

      <div className="flex w-full gap-4 lg:h-[calc(100vh-9rem)] lg:min-h-[540px]">
        {/* Side panel — desktop only, synced with the map */}
        <div
          ref={panelRef}
          className="relative hidden lg:flex w-[360px] shrink-0 flex-col gap-2.5 overflow-y-auto overscroll-contain py-1.5 pl-0.5 pr-1.5 [scrollbar-width:thin]"
        >
          {isLoading && panelItems.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] w-full shrink-0 rounded-xl" />
            ))
          ) : panelItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <CalendarX className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">{t('emptyTitle')}</p>
            </div>
          ) : (
            panelItems.map(item =>
              item.kind === 'match' ? (
                <MapPanelMatchCard
                  key={item.key}
                  ref={el => {
                    if (el) cardRefs.current.set(item.key, el);
                    else cardRefs.current.delete(item.key);
                  }}
                  match={item.match}
                  isActive={item.key === selectedKey}
                  viewerPlayerId={viewerPlayerId}
                  onClick={() => {
                    const coords = resolveMatchCoords(item.match);
                    handleCardClick(item.key, coords?.lat ?? null, coords?.lng ?? null);
                  }}
                  onHover={hovering => setHoveredKey(hovering ? item.key : null)}
                  onJoin={onJoin}
                />
              ) : (
                <MapPanelFacilityCard
                  key={item.key}
                  ref={el => {
                    if (el) cardRefs.current.set(item.key, el);
                    else cardRefs.current.delete(item.key);
                  }}
                  facility={item.facility}
                  isActive={item.key === selectedKey}
                  onClick={() =>
                    handleCardClick(
                      item.key,
                      item.facility.latitude ?? null,
                      item.facility.longitude ?? null
                    )
                  }
                  onHover={hovering => setHoveredKey(hovering ? item.key : null)}
                  onBook={onBook}
                />
              )
            )
          )}
        </div>

        {/* Map */}
        <div className="h-[65vh] min-h-[420px] w-full min-w-0 flex-1 lg:h-full">
          <PlayMapInner
            matches={mappableMatches}
            facilities={mappableFacilities}
            viewerPlayerId={viewerPlayerId}
            center={center}
            onJoin={onJoin}
            onBook={onBook}
            panelMode={isDesktop}
            activeKey={selectedKey}
            hoveredKey={hoveredKey}
            onMarkerClick={handleMarkerClick}
            flyTo={flyTo}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side-panel match card (compact, hover/click synced with the map)
// ---------------------------------------------------------------------------

function MapPanelMatchCard({
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
  const tMatch = useTranslations('match');
  const locale = useLocale();

  const viewerStatus = getViewerMatchStatus(
    getViewerParticipant(match.participants, viewerPlayerId)
  );

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
  const courtName = match.court?.name;

  const { total, joinedCount, spotsLeft, isFull } = getMatchCounts(match);
  const isRequestMode = match.join_mode === 'request';
  const chips = buildMatchChips(match, t);
  const cta = resolveCta(viewerStatus, isFull, isRequestMode, tMatch);

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
        'group relative flex shrink-0 cursor-pointer flex-col gap-2 rounded-xl border bg-card p-3 pl-4 text-left transition-all',
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

      {/* Date rail + when/where + sport */}
      <div className="flex gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center justify-center self-start rounded-lg bg-muted/60 py-1.5">
          <span className="text-[10px] font-medium uppercase text-muted-foreground">{weekday}</span>
          <span className="text-lg font-bold leading-tight">{dayNum}</span>
          <span className="text-[10px] text-muted-foreground">{month}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              {time}
              {duration && <span className="font-normal text-muted-foreground"> · {duration}</span>}
            </span>
            {match.sport && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
                style={{ background: `${color}1a`, color }}
              >
                {match.sport.name}
              </span>
            )}
          </div>
          <p className="mb-0 mt-0.5 truncate text-sm font-medium">{location}</p>
          <p className="mb-0 mt-1 truncate text-xs text-muted-foreground">
            {[
              courtName,
              city,
              match.distance != null ? t('kmAway', { distance: Math.round(match.distance) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      {/* Players + spots */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <PlayerSlots match={match} viewerPlayerId={viewerPlayerId} size="sm" />
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            {joinedCount}/{total}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold',
            isFull
              ? 'bg-destructive/10 text-destructive'
              : spotsLeft === 1
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          )}
        >
          {isFull ? t('matchFull') : t('spotsLeft', { count: spotsLeft })}
        </span>
      </div>

      {viewerStatus && <ViewerStatusBanner status={viewerStatus} compact />}

      <MatchChipRow chips={chips} />

      {/* CTA + share */}
      <div className="mt-0.5 flex items-center gap-2">
        <Button
          size="sm"
          variant={cta.variant}
          disabled={cta.disabled}
          className={cn('h-9 flex-1 rounded-full text-sm font-semibold', cta.className)}
          onClick={e => {
            e.stopPropagation();
            onJoin(match.id);
          }}
        >
          {cta.label}
        </Button>
        <ShareButton
          matchId={match.id}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border p-0"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side-panel facility card (compact, hover/click synced with the map)
// ---------------------------------------------------------------------------

function MapPanelFacilityCard({
  ref,
  facility,
  isActive,
  onClick,
  onHover,
  onBook,
}: {
  ref: (el: HTMLDivElement | null) => void;
  facility: PublicFacility;
  isActive: boolean;
  onClick: () => void;
  onHover: (hovering: boolean) => void;
  onBook: (facility: PublicFacility, slot: SlotGroupRef | null) => void;
}) {
  const t = useTranslations('courtsPage');

  const addressLine = [facility.address, facility.city].filter(Boolean).join(', ');
  const distanceKm = facility.distance_meters != null ? facility.distance_meters / 1000 : null;
  const canBookOnline = !!facility.booking_url_template && !!facility.external_provider_id;

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
        'group relative flex shrink-0 cursor-pointer flex-col gap-2 rounded-xl border bg-card p-3 pl-4 text-left transition-all',
        'hover:-translate-y-px hover:border-primary/40 hover:shadow-md',
        isActive && 'border-primary shadow-md ring-2 ring-primary/20'
      )}
    >
      {/* Facility accent bar */}
      <span
        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
        style={{ background: FACILITY_MARKER_COLOR }}
        aria-hidden
      />

      <div className="flex gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center self-start rounded-lg bg-muted/60">
          <Building2 className="size-5 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="mb-0 truncate text-sm font-semibold" title={facility.name}>
            {facility.name}
          </p>
          {addressLine && (
            <p className="mb-0 mt-0.5 flex items-start gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="mt-px size-3 shrink-0" />
              <span className="truncate">{addressLine}</span>
            </p>
          )}
          <p className="mb-0 mt-1 truncate text-xs text-muted-foreground">
            {[
              facility.court_count
                ? facility.court_count === 1
                  ? t('courtCountSingular')
                  : t('courtCount', { count: facility.court_count })
                : null,
              distanceKm != null ? t('kmAway', { distance: distanceKm.toFixed(1) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {facility.organization_nature === 'public' && (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-500/30 text-[10px] text-emerald-600 dark:text-emerald-400"
          >
            {t('badgePublic')}
          </Badge>
        )}
        {facility.organization_nature === 'private' && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/30 text-[10px] text-amber-600 dark:text-amber-400"
          >
            {t('badgePrivate')}
          </Badge>
        )}
        {facility.is_first_come_first_serve && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            {t('badgeFirstCome')}
          </Badge>
        )}
        {canBookOnline && (
          <Badge variant="outline" className="gap-1 border-primary/30 text-[10px] text-primary">
            {t('badgeBookable')}
          </Badge>
        )}
      </div>

      {canBookOnline ? (
        <Button
          size="sm"
          className="mt-0.5 h-9 w-full rounded-full text-sm font-semibold"
          onClick={e => {
            e.stopPropagation();
            onBook(facility, null);
          }}
        >
          {t('bookCta')}
        </Button>
      ) : (
        <div className="mt-0.5 flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {facility.is_first_come_first_serve ? t('justShowUp') : t('noOnlineBooking')}
        </div>
      )}
    </div>
  );
}
