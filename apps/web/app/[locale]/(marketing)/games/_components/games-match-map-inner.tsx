'use client';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { primary, accent, neutral, status } from '@rallia/design-system';

import type { PublicMatch } from './public-match-card';
import { getRelativeDateLabel, formatDuration } from './utils';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TILE_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const ATTR_LIGHT =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ATTR_DARK =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>';

const MONTREAL: [number, number] = [45.5017, -73.5673];

const TENNIS_COLOR = primary[500];
const PICKLEBALL_COLOR = accent[500];
const OTHER_COLOR = status.info.DEFAULT;

/** A public match paired with resolved map coordinates. */
interface MappableMatch {
  match: PublicMatch;
  lat: number;
  lng: number;
}

/** Facility coordinates take priority, then the match's custom location. */
function resolveCoords(match: PublicMatch): { lat: number; lng: number } | null {
  const fLat = match.facility?.latitude;
  const fLng = match.facility?.longitude;
  if (fLat != null && fLng != null) return { lat: fLat, lng: fLng };
  if (match.custom_latitude != null && match.custom_longitude != null) {
    return { lat: match.custom_latitude, lng: match.custom_longitude };
  }
  return null;
}

function sportColor(sportName: string | undefined): string {
  const s = sportName?.toLowerCase();
  if (s === 'tennis') return TENNIS_COLOR;
  if (s === 'pickleball') return PICKLEBALL_COLOR;
  return OTHER_COLOR;
}

const usersSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

const matchIconCache = new Map<string, L.DivIcon>();
function getMatchIcon(color: string, isFull: boolean): L.DivIcon {
  const key = `${color}-${isFull}`;
  const cached = matchIconCache.get(key);
  if (cached) return cached;

  const ring = isFull ? status.error.DEFAULT : color;
  const bg = isFull ? neutral[400] : color;
  const html = `<span style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;background:${bg};border-radius:9999px 9999px 9999px 2px;transform:rotate(45deg);box-shadow:0 0 0 2px ${ring},0 2px 4px rgba(0,0,0,.25);">
    <span style="transform:rotate(-45deg);display:flex;color:white;">${usersSvg}</span>
  </span>`;

  const icon = L.divIcon({
    html,
    className: '',
    iconSize: L.point(30, 30),
    iconAnchor: L.point(15, 28),
    popupAnchor: L.point(0, -26),
  });
  matchIconCache.set(key, icon);
  return icon;
}

function createClusterIcon(cluster: { getChildCount: () => number }): L.DivIcon {
  const count = cluster.getChildCount();
  const px = count < 10 ? 36 : count < 50 ? 44 : 52;
  return L.divIcon({
    html: `<span style="width:${px}px;height:${px}px;background:${primary[500]}dd;display:flex;align-items:center;justify-content:center;border-radius:9999px;color:white;font-weight:600;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.25);">${count}</span>`,
    className: '',
    iconSize: L.point(px, px),
  });
}

// Leaflet popup style overrides — injected once (mirrors admin map popups)
const popupStyleId = 'rallia-games-map-popup-styles';
function usePopupStyles() {
  useEffect(() => {
    if (document.getElementById(popupStyleId)) return;
    const style = document.createElement('style');
    style.id = popupStyleId;
    style.textContent = `
      .leaflet-popup-content-wrapper {
        background: var(--color-card, #fff);
        color: var(--color-card-foreground, #171717);
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,.12), 0 1px 4px rgba(0,0,0,.08);
        padding: 0;
        overflow: hidden;
        border: 1px solid var(--color-border, #e5e5e5);
      }
      .leaflet-popup-content { margin: 0 !important; line-height: 1.5; width: 240px !important; }
      .leaflet-popup-tip {
        background: var(--color-card, #fff);
        box-shadow: none;
        border: 1px solid var(--color-border, #e5e5e5);
        border-top: none;
        border-left: none;
      }
      .leaflet-popup-close-button {
        color: var(--color-muted-foreground, #737373) !important;
        font-size: 18px !important;
        top: 8px !important;
        right: 8px !important;
      }
      .leaflet-popup-close-button:hover { color: var(--color-foreground, #171717) !important; }
    `;
    document.head.appendChild(style);
  }, []);
}

/**
 * Fit the map to all markers whenever the dataset changes (the full match set
 * loads asynchronously and refetches on filter changes), else center on the user.
 * Keyed on a signature so panning/zooming between fetches isn't disturbed.
 */
function FitToMarkers({
  points,
  center,
}: {
  points: MappableMatch[];
  center: [number, number] | null;
}) {
  const map = useMap();
  const signature =
    points.length === 0
      ? 'empty'
      : `${points.length}:${points[0].match.id}:${points[points.length - 1].match.id}`;
  useEffect(() => {
    if (points.length === 0) {
      if (center) map.setView(center, 11);
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
      return;
    }
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return null;
}

function MatchPopup({
  match,
  viewerPlayerId,
  onJoin,
}: {
  match: PublicMatch;
  viewerPlayerId?: string | null;
  onJoin: (matchId: string) => void;
}) {
  const t = useTranslations('gamesPage');
  const locale = useLocale();

  const dateLabel = getRelativeDateLabel(match.match_date, locale, t('today'), t('tomorrow'));
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

  const color = sportColor(match.sport?.name);

  return (
    <div style={{ width: '100%' }}>
      <div style={{ height: 3, background: color }} />
      <div style={{ padding: '12px 14px' }} className="text-card-foreground">
        <div className="flex items-center justify-between gap-2 mb-2">
          {match.sport && (
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize"
              style={{ background: `${color}1a`, color }}
            >
              {match.sport.name}
            </span>
          )}
          <span
            className={cn(
              'text-[11px] font-semibold px-2 py-0.5 rounded-full',
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

        <div className="text-sm font-semibold capitalize">
          {dateLabel}
          <span className="text-muted-foreground font-normal">
            {' · '}
            {time}
            {duration && ` · ${duration}`}
          </span>
        </div>

        <div className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{location}</span>
          {city && ` · ${city}`}
          {match.distance != null && (
            <div>{t('kmAway', { distance: Math.round(match.distance) })}</div>
          )}
        </div>

        <Button
          size="sm"
          className="w-full mt-3 font-semibold"
          variant={isFull ? 'outline' : 'default'}
          onClick={() => onJoin(match.id)}
        >
          {isFull ? t('waitlistButton') : t('joinButton')}
        </Button>
        {viewerPlayerId && match.participants?.some(p => p.player_id === viewerPlayerId) && (
          <div className="mt-1.5 text-center text-[11px] font-medium text-primary">
            {t('cardStatus.joined')}
          </div>
        )}
      </div>
    </div>
  );
}

interface GamesMatchMapInnerProps {
  matches: PublicMatch[];
  viewerPlayerId?: string | null;
  center: [number, number] | null;
  onJoin: (matchId: string) => void;
}

export default function GamesMatchMapInner({
  matches,
  viewerPlayerId,
  center,
  onJoin,
}: GamesMatchMapInnerProps) {
  usePopupStyles();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const points = useMemo<MappableMatch[]>(() => {
    const out: MappableMatch[] = [];
    for (const match of matches) {
      const coords = resolveCoords(match);
      if (coords) out.push({ match, lat: coords.lat, lng: coords.lng });
    }
    return out;
  }, [matches]);

  return (
    <MapContainer
      center={center ?? MONTREAL}
      zoom={11}
      scrollWheelZoom
      className="w-full h-[70vh] min-h-[420px] rounded-xl border border-border z-0"
    >
      <TileLayer
        key={isDark ? 'dark' : 'light'}
        attribution={isDark ? ATTR_DARK : ATTR_LIGHT}
        url={isDark ? TILE_DARK : TILE_LIGHT}
      />
      <FitToMarkers points={points} center={center} />

      <MarkerClusterGroup
        chunkedLoading
        iconCreateFunction={createClusterIcon}
        maxClusterRadius={45}
        spiderfyOnMaxZoom
        showCoverageOnHover={false}
      >
        {points.map(({ match, lat, lng }) => {
          const total = match.format === 'doubles' ? 4 : 2;
          const joinedCount = match.participants?.filter(p => p.status === 'joined').length ?? 0;
          const isFull = total - joinedCount <= 0;
          return (
            <Marker
              key={match.id}
              position={[lat, lng]}
              icon={getMatchIcon(sportColor(match.sport?.name), isFull)}
            >
              <Popup>
                <MatchPopup match={match} viewerPlayerId={viewerPlayerId} onJoin={onJoin} />
              </Popup>
            </Marker>
          );
        })}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
