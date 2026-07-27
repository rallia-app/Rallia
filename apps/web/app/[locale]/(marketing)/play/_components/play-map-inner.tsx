'use client';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { primary, accent, neutral, status } from '@rallia/design-system';

import type { PublicFacility, SlotGroupRef } from './facility-card';
import { FACILITY_MARKER_COLOR, facilityKey, matchKey } from './play-map';
import type { PublicMatch } from './public-match-card';
import { getRelativeDateLabel, formatDuration, resolveMatchCoords } from './utils';

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

/** A map point pairing an item with resolved coordinates. */
type MapPoint =
  | { key: string; kind: 'match'; lat: number; lng: number; match: PublicMatch }
  | { key: string; kind: 'facility'; lat: number; lng: number; facility: PublicFacility };

function sportColor(sportName: string | undefined): string {
  const s = sportName?.toLowerCase();
  if (s === 'tennis') return TENNIS_COLOR;
  if (s === 'pickleball') return PICKLEBALL_COLOR;
  return OTHER_COLOR;
}

const usersSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

const buildingSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`;

const matchIconCache = new Map<string, L.DivIcon>();
function getMatchIcon(color: string, isFull: boolean, emphasized = false): L.DivIcon {
  const key = `${color}-${isFull}-${emphasized}`;
  const cached = matchIconCache.get(key);
  if (cached) return cached;

  const ring = isFull ? status.error.DEFAULT : color;
  const bg = isFull ? neutral[400] : color;
  const size = emphasized ? 38 : 30;
  const shadow = emphasized
    ? `0 0 0 3px #fff,0 0 0 5px ${ring},0 4px 12px rgba(0,0,0,.35)`
    : `0 0 0 2px ${ring},0 2px 4px rgba(0,0,0,.25)`;
  const html = `<span style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:${bg};border-radius:9999px 9999px 9999px 2px;transform:rotate(45deg);box-shadow:${shadow};transition:all .15s ease;">
    <span style="transform:rotate(-45deg);display:flex;color:white;">${usersSvg}</span>
  </span>`;

  const icon = L.divIcon({
    html,
    className: '',
    iconSize: L.point(size, size),
    iconAnchor: L.point(size / 2, size - 2),
    popupAnchor: L.point(0, -(size - 4)),
  });
  matchIconCache.set(key, icon);
  return icon;
}

// Facilities get a rounded-square marker so courts read differently from the
// teardrop game pins at a glance.
const facilityIconCache = new Map<string, L.DivIcon>();
function getFacilityIcon(emphasized = false): L.DivIcon {
  const key = String(emphasized);
  const cached = facilityIconCache.get(key);
  if (cached) return cached;

  const size = emphasized ? 34 : 26;
  const shadow = emphasized
    ? `0 0 0 3px #fff,0 0 0 5px ${FACILITY_MARKER_COLOR},0 4px 12px rgba(0,0,0,.35)`
    : `0 0 0 2px #fff,0 2px 4px rgba(0,0,0,.25)`;
  const html = `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:${FACILITY_MARKER_COLOR};border-radius:8px;box-shadow:${shadow};transition:all .15s ease;">
    <span style="display:flex;color:white;">${buildingSvg}</span>
  </span>`;

  const icon = L.divIcon({
    html,
    className: '',
    iconSize: L.point(size, size),
    iconAnchor: L.point(size / 2, size / 2),
    popupAnchor: L.point(0, -(size / 2 + 4)),
  });
  facilityIconCache.set(key, icon);
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
const popupStyleId = 'rallia-play-map-popup-styles';
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
 * Fit the map to all markers whenever the dataset changes (the full sets load
 * asynchronously and refetch on filter changes), else center on the user.
 * Keyed on a signature so panning/zooming between fetches isn't disturbed.
 */
function FitToMarkers({ points, center }: { points: MapPoint[]; center: [number, number] | null }) {
  const map = useMap();
  const needsRefit = useRef(false);
  const signature =
    points.length === 0
      ? 'empty'
      : `${points.length}:${points[0].key}:${points[points.length - 1].key}`;

  const fit = useCallback(() => {
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
  }, [signature, center, map]);

  useEffect(() => {
    // A fit computed while the container is collapsed (hidden tab, mid-layout)
    // produces a garbage viewport — redo it once the map gets real dimensions.
    const size = map.getSize();
    needsRefit.current = size.x < 50 || size.y < 50;
    fit();
  }, [fit, map]);

  useEffect(() => {
    const onResize = () => {
      if (!needsRefit.current) return;
      const size = map.getSize();
      if (size.x >= 50 && size.y >= 50) {
        needsRefit.current = false;
        fit();
      }
    };
    map.on('resize', onResize);
    return () => {
      map.off('resize', onResize);
    };
  }, [map, fit]);

  return null;
}

/** Keep Leaflet's internal size in sync with the container (split-view resizes). */
function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Animates the camera to a card-selected item (desktop panel sync). */
function FlyToHandler({ flyTo }: { flyTo: { lat: number; lng: number; ts: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!flyTo) return;
    map.flyTo([flyTo.lat, flyTo.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.ts]);
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
        {/* pr-7 keeps the right badge clear of the Leaflet close button (top-right) */}
        <div className="flex items-center justify-between gap-2 mb-2 pr-7">
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
              'whitespace-nowrap text-[11px] font-semibold px-2 py-0.5 rounded-full',
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

function FacilityPopup({
  facility,
  onBook,
}: {
  facility: PublicFacility;
  onBook: (facility: PublicFacility, slot: SlotGroupRef | null) => void;
}) {
  const t = useTranslations('courtsPage');

  const addressLine = [facility.address, facility.city].filter(Boolean).join(', ');
  const distanceKm = facility.distance_meters != null ? facility.distance_meters / 1000 : null;
  const canBookOnline = !!facility.booking_url_template && !!facility.external_provider_id;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ height: 3, background: FACILITY_MARKER_COLOR }} />
      <div style={{ padding: '12px 14px' }} className="text-card-foreground">
        <div className="pr-7 text-sm font-semibold">{facility.name}</div>

        <div className="mt-1 text-xs text-muted-foreground">
          {addressLine && <div>{addressLine}</div>}
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
        </div>

        {canBookOnline ? (
          <Button
            size="sm"
            className="w-full mt-3 font-semibold"
            onClick={() => onBook(facility, null)}
          >
            {t('bookCta')}
          </Button>
        ) : (
          <div className="mt-3 text-center text-[11px] text-muted-foreground">
            {facility.is_first_come_first_serve ? t('justShowUp') : t('noOnlineBooking')}
          </div>
        )}
      </div>
    </div>
  );
}

interface PlayMapInnerProps {
  matches: PublicMatch[];
  facilities: PublicFacility[];
  viewerPlayerId?: string | null;
  center: [number, number] | null;
  onJoin: (matchId: string) => void;
  onBook: (facility: PublicFacility, slot: SlotGroupRef | null) => void;
  /** Desktop split view: markers select the side-panel card instead of opening popups. */
  panelMode?: boolean;
  activeKey?: string | null;
  hoveredKey?: string | null;
  onMarkerClick?: (key: string) => void;
  flyTo?: { lat: number; lng: number; ts: number } | null;
}

export default function PlayMapInner({
  matches,
  facilities,
  viewerPlayerId,
  center,
  onJoin,
  onBook,
  panelMode = false,
  activeKey = null,
  hoveredKey = null,
  onMarkerClick,
  flyTo = null,
}: PlayMapInnerProps) {
  usePopupStyles();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    for (const match of matches) {
      const coords = resolveMatchCoords(match);
      if (coords) {
        out.push({
          key: matchKey(match.id),
          kind: 'match',
          lat: coords.lat,
          lng: coords.lng,
          match,
        });
      }
    }
    for (const facility of facilities) {
      if (facility.latitude != null && facility.longitude != null) {
        out.push({
          key: facilityKey(facility.id),
          kind: 'facility',
          lat: facility.latitude,
          lng: facility.longitude,
          facility,
        });
      }
    }
    return out;
  }, [matches, facilities]);

  return (
    <MapContainer
      center={center ?? MONTREAL}
      zoom={11}
      scrollWheelZoom
      className="w-full h-full rounded-xl border border-border z-0"
    >
      <TileLayer
        key={isDark ? 'dark' : 'light'}
        attribution={isDark ? ATTR_DARK : ATTR_LIGHT}
        url={isDark ? TILE_DARK : TILE_LIGHT}
      />
      <ResizeHandler />
      <FitToMarkers points={points} center={center} />
      <FlyToHandler flyTo={flyTo} />

      <MarkerClusterGroup
        chunkedLoading
        iconCreateFunction={createClusterIcon}
        maxClusterRadius={45}
        spiderfyOnMaxZoom
        showCoverageOnHover={false}
      >
        {points.map(point => {
          const emphasized = point.key === activeKey || point.key === hoveredKey;

          if (point.kind === 'facility') {
            return (
              <Marker
                key={point.key}
                position={[point.lat, point.lng]}
                icon={getFacilityIcon(emphasized)}
                zIndexOffset={emphasized ? 1000 : 0}
                eventHandlers={panelMode ? { click: () => onMarkerClick?.(point.key) } : undefined}
              >
                {!panelMode && (
                  <Popup>
                    <FacilityPopup facility={point.facility} onBook={onBook} />
                  </Popup>
                )}
              </Marker>
            );
          }

          const { match } = point;
          const total = match.format === 'doubles' ? 4 : 2;
          const joinedCount = match.participants?.filter(p => p.status === 'joined').length ?? 0;
          const isFull = total - joinedCount <= 0;
          return (
            <Marker
              key={point.key}
              position={[point.lat, point.lng]}
              icon={getMatchIcon(sportColor(match.sport?.name), isFull, emphasized)}
              zIndexOffset={emphasized ? 1000 : 0}
              eventHandlers={panelMode ? { click: () => onMarkerClick?.(point.key) } : undefined}
            >
              {!panelMode && (
                <Popup>
                  <MatchPopup match={match} viewerPlayerId={viewerPlayerId} onJoin={onJoin} />
                </Popup>
              )}
            </Marker>
          );
        })}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
