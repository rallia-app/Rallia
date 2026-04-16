'use client';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import type { FacilityMapPoint, MapViewMode, PlayerMapPoint } from './admin-player-map';

const TILE_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const ATTR_LIGHT =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ATTR_DARK =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>';

// Design system colors (from @rallia/design-system tokens)
const ds = {
  primary: { 300: '#5eead4', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e' },
  secondary: { 300: '#f4a6a7', 500: '#ed6a6d' },
  accent: { 300: '#fcd34d', 500: '#f59e0b' },
  info: { 300: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' },
  success: { DEFAULT: '#059669' },
  error: { DEFAULT: '#ef4444' },
  neutral: { 300: '#d4d4d4', 400: '#a3a3a3' },
} as const;

// User SVG (lucide User icon path)
const userSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

// Player icons by gender — using design system palette
const playerIcons: Record<string, L.DivIcon> = {};
function getPlayerIcon(gender: string | null): L.DivIcon {
  const key = gender ?? 'unknown';
  if (playerIcons[key]) return playerIcons[key];

  const colorMap: Record<string, { bg: string; ring: string }> = {
    male: { bg: ds.primary[500], ring: ds.primary[300] },
    female: { bg: ds.secondary[500], ring: ds.secondary[300] },
    other: { bg: ds.accent[500], ring: ds.accent[300] },
    unknown: { bg: ds.neutral[400], ring: ds.neutral[300] },
  };
  const colors = colorMap[key] || colorMap.unknown;

  playerIcons[key] = L.divIcon({
    html: `<span style="width:24px;height:24px;background:${colors.bg};box-shadow:0 0 0 2px ${colors.ring},0 1px 2px rgba(0,0,0,.1);display:flex;align-items:center;justify-content:center;border-radius:9999px;color:white;">${userSvg}</span>`,
    className: '',
    iconSize: L.point(24, 24),
    iconAnchor: L.point(12, 12),
  });
  return playerIcons[key];
}

// Sport colors for marker body
const TENNIS_COLOR = ds.primary[500]; // teal
const PICKLEBALL_COLOR = ds.accent[500]; // amber

// Building SVG path (reused across facility icons)
const buildingSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`;

// Resolve marker body background based on sports
function getFacilityBackground(sports: string[]): string {
  const lower = sports.map(s => s.toLowerCase());
  const hasTennis = lower.includes('tennis');
  const hasPickleball = lower.includes('pickleball');

  if (hasTennis && hasPickleball) {
    return `linear-gradient(135deg, ${TENNIS_COLOR} 50%, ${PICKLEBALL_COLOR} 50%)`;
  }
  if (hasTennis) return TENNIS_COLOR;
  if (hasPickleball) return PICKLEBALL_COLOR;
  return ds.info[500]; // default blue for other/unknown sports
}

// Inject bookable pulse animation once
const bookableStyleId = 'rallia-bookable-pulse';
function ensureBookableStyles() {
  if (typeof document === 'undefined' || document.getElementById(bookableStyleId)) return;
  const style = document.createElement('style');
  style.id = bookableStyleId;
  style.textContent = `
    @keyframes bookable-pulse {
      0%, 100% { box-shadow: 0 0 0 4px ${ds.success.DEFAULT}, 0 0 16px 6px ${ds.success.DEFAULT}aa; }
      50% { box-shadow: 0 0 0 8px ${ds.success.DEFAULT}bb, 0 0 30px 12px ${ds.success.DEFAULT}66; }
    }
    .rallia-bookable { animation: bookable-pulse 1.5s ease-in-out infinite; }
  `;
  document.head.appendChild(style);
}

// Dynamic facility icon — sport-colored body, court count badge, bookable glow
const facilityIconCache = new Map<string, L.DivIcon>();
function getFacilityIcon(facility: FacilityMapPoint): L.DivIcon {
  const sortedSports = [...facility.sports].sort().join(',');
  const key = `${facility.courtCount}-${sortedSports}-${facility.hasExternalProvider}`;
  const cached = facilityIconCache.get(key);
  if (cached) return cached;

  ensureBookableStyles();

  const badgeWidth = facility.courtCount >= 10 ? 20 : 16;
  const bg = getFacilityBackground(facility.sports);

  const bookableClass = facility.hasExternalProvider ? 'rallia-bookable' : '';
  const defaultShadow = `0 0 0 2px ${ds.info[300]},0 1px 2px rgba(0,0,0,.1)`;
  const boxShadow = facility.hasExternalProvider ? '' : `box-shadow:${defaultShadow};`;

  const html = `<span style="position:relative;display:inline-block;">
    <span class="${bookableClass}" style="width:28px;height:28px;background:${bg};${boxShadow}display:flex;align-items:center;justify-content:center;border-radius:6px;color:white;">
      ${buildingSvg}
    </span>
    ${facility.courtCount > 0 ? `<span style="position:absolute;top:-6px;right:-6px;min-width:${badgeWidth}px;height:16px;border-radius:8px;background:${ds.primary[600]};color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px;border:1.5px solid white;line-height:1;">${facility.courtCount}</span>` : ''}
  </span>`;

  const icon = L.divIcon({
    html,
    className: '',
    iconSize: L.point(36, 36),
    iconAnchor: L.point(18, 18),
  });
  facilityIconCache.set(key, icon);
  return icon;
}

// Player cluster icons — primary palette by density
function createClusterIcon(cluster: any) {
  const count = cluster.getChildCount();
  let bg: string;

  if (count < 10) {
    bg = ds.primary[500]; // teal
  } else if (count < 50) {
    bg = ds.accent[500]; // amber
  } else {
    bg = ds.secondary[500]; // coral
  }

  const px = count < 10 ? 36 : count < 50 ? 44 : 52;

  return L.divIcon({
    html: `<span style="width:${px}px;height:${px}px;background:${bg}cc;display:flex;align-items:center;justify-content:center;border-radius:9999px;color:white;font-weight:600;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.2);">${count}</span>`,
    className: '',
    iconSize: L.point(px, px),
  });
}

// Facility cluster icons — info blue with total court count badge
function createFacilityClusterIcon(cluster: any) {
  const count = cluster.getChildCount();
  const px = count < 10 ? 36 : count < 50 ? 44 : 52;

  let totalCourts = 0;
  for (const marker of cluster.getAllChildMarkers()) {
    totalCourts += (marker.options as any).courtCount ?? 0;
  }

  const badgeWidth = totalCourts >= 10 ? 20 : 16;
  const courtBadge =
    totalCourts > 0
      ? `<span style="position:absolute;top:-6px;right:-6px;min-width:${badgeWidth}px;height:16px;border-radius:8px;background:${ds.primary[500]};color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px;border:1.5px solid white;line-height:1;">${totalCourts}</span>`
      : '';

  return L.divIcon({
    html: `<span style="position:relative;display:inline-flex;align-items:center;justify-content:center;">
      <span style="width:${px}px;height:${px}px;background:${ds.info[500]}cc;display:flex;align-items:center;justify-content:center;border-radius:6px;color:white;font-weight:600;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.2);gap:2px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/></svg>
        ${count}
      </span>
      ${courtBadge}
    </span>`,
    className: '',
    iconSize: L.point(px + 12, px + 12),
    iconAnchor: L.point((px + 12) / 2, (px + 12) / 2),
  });
}

function formatRelativeTime(dateStr: string | null): { text: string; isRecent: boolean } {
  if (!dateStr) return { text: '—', isRecent: false };
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return { text: 'Today', isRecent: true };
  if (diffDays < 7) return { text: `${diffDays}d ago`, isRecent: true };
  if (diffDays < 30) return { text: `${Math.floor(diffDays / 7)}w ago`, isRecent: diffDays < 14 };
  if (diffDays < 365) return { text: `${Math.floor(diffDays / 30)}mo ago`, isRecent: false };
  return { text: `${Math.floor(diffDays / 365)}y ago`, isRecent: false };
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
  }).format(new Date(dateStr));
}

// Heatmap layer component
function HeatmapLayer({ points }: { points: PlayerMapPoint[] }) {
  const map = useMap();

  useEffect(() => {
    const heatData: [number, number, number][] = points.map(p => [p.latitude, p.longitude, 1]);
    const heat = (L as any)
      .heatLayer(heatData, {
        radius: 25,
        blur: 15,
        maxZoom: 17,
        max: 1.0,
        gradient: {
          0.2: ds.primary[500], // teal — low density
          0.4: ds.primary[300], // light teal
          0.6: ds.accent[500], // amber — medium density
          0.8: ds.secondary[500], // coral — high density
          1.0: ds.secondary[500], // coral — peak
        },
      })
      .addTo(map);

    return () => {
      map.removeLayer(heat);
    };
  }, [map, points]);

  return null;
}

// Rectangle selection component
function RectangleSelector({
  active,
  onComplete,
}: {
  active: boolean;
  onComplete: (bounds: { north: number; south: number; east: number; west: number }) => void;
}) {
  const map = useMap();
  const rectRef = useRef<L.Rectangle | null>(null);
  const startRef = useRef<L.LatLng | null>(null);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    if (active) {
      map.dragging.disable();
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.dragging.enable();
      map.getContainer().style.cursor = '';
      if (rectRef.current) {
        map.removeLayer(rectRef.current);
        rectRef.current = null;
      }
    }
    return () => {
      map.dragging.enable();
      map.getContainer().style.cursor = '';
    };
  }, [active, map]);

  useMapEvents({
    mousedown(e) {
      if (!active) return;
      startRef.current = e.latlng;
      setDrawing(true);
      if (rectRef.current) {
        map.removeLayer(rectRef.current);
      }
      const start: L.LatLngTuple = [e.latlng.lat, e.latlng.lng];
      rectRef.current = L.rectangle([start, start], {
        color: 'hsl(var(--primary))',
        weight: 2,
        fillOpacity: 0.1,
        dashArray: '6 3',
      }).addTo(map);
    },
    mousemove(e) {
      if (!drawing || !startRef.current || !rectRef.current) return;
      rectRef.current.setBounds(L.latLngBounds(startRef.current, e.latlng));
    },
    mouseup(e) {
      if (!drawing || !startRef.current) return;
      setDrawing(false);
      const bounds = L.latLngBounds(startRef.current, e.latlng);
      startRef.current = null;

      // Ignore tiny selections (accidental clicks)
      if (
        Math.abs(bounds.getNorth() - bounds.getSouth()) < 0.001 &&
        Math.abs(bounds.getEast() - bounds.getWest()) < 0.001
      ) {
        if (rectRef.current) {
          map.removeLayer(rectRef.current);
          rectRef.current = null;
        }
        return;
      }

      onComplete({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      });
    },
  });

  return null;
}

// Leaflet popup style overrides — injected once
const popupStyleId = 'rallia-map-popup-styles';
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
      .leaflet-popup-content {
        margin: 0 !important;
        line-height: 1.5;
      }
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
        width: 20px !important;
        height: 20px !important;
      }
      .leaflet-popup-close-button:hover {
        color: var(--color-foreground, #171717) !important;
      }
    `;
    document.head.appendChild(style);
  }, []);
}

function PlayerPopup({ point }: { point: PlayerMapPoint }) {
  const name = [point.firstName, point.lastName].filter(Boolean).join(' ') || 'Unknown';
  const activity = formatRelativeTime(point.lastSeenAt);
  const genderColors: Record<string, string> = {
    male: ds.primary[500],
    female: ds.secondary[500],
    other: ds.accent[500],
  };
  const accentColor = genderColors[point.gender ?? ''] || ds.neutral[400];

  return (
    <div style={{ minWidth: 200 }}>
      {/* Accent bar */}
      <div style={{ height: 3, background: accentColor }} />
      <div style={{ padding: '12px 14px' }}>
        {/* Header row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 500,
              padding: '2px 8px',
              borderRadius: 9999,
              background: activity.isRecent ? `${ds.success.DEFAULT}18` : `${ds.neutral[400]}1a`,
              color: activity.isRecent ? ds.success.DEFAULT : ds.neutral[400],
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: activity.isRecent ? ds.success.DEFAULT : ds.neutral[400],
              }}
            />
            {activity.text}
          </span>
        </div>

        {/* Sports */}
        {point.sports.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {point.sports.map(sport => (
              <span
                key={sport}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: `${ds.primary[500]}14`,
                  color: ds.primary[700],
                  textTransform: 'capitalize',
                }}
              >
                {sport}
              </span>
            ))}
          </div>
        )}

        {/* Meta row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: ds.neutral[400],
          }}
        >
          {point.gender && (
            <>
              <span style={{ textTransform: 'capitalize' }}>{point.gender}</span>
              <span style={{ color: ds.neutral[300] }}>·</span>
            </>
          )}
          <span>Joined {formatDate(point.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function FacilityPopup({ facility }: { facility: FacilityMapPoint }) {
  return (
    <div style={{ minWidth: 200 }}>
      {/* Accent bar */}
      <div style={{ height: 3, background: ds.info[500] }} />
      <div style={{ padding: '12px 14px' }}>
        {/* Name */}
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{facility.name}</div>

        {/* Address */}
        {facility.address && (
          <div style={{ fontSize: 12, color: ds.neutral[400], marginBottom: 8 }}>
            {facility.address}
            {facility.city ? `, ${facility.city}` : ''}
          </div>
        )}

        {/* Type & courts row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            flexWrap: 'wrap',
            marginBottom: facility.sports.length > 0 ? 8 : 0,
          }}
        >
          {facility.facilityType && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: `${ds.info[500]}14`,
                color: ds.info[600],
                fontSize: 11,
                fontWeight: 500,
                textTransform: 'capitalize',
              }}
            >
              {facility.facilityType.replace(/_/g, ' ')}
            </span>
          )}
          {facility.courtCount > 0 && (
            <span style={{ color: ds.neutral[400], fontSize: 12 }}>
              {facility.courtCount} court{facility.courtCount !== 1 ? 's' : ''}
            </span>
          )}
          {facility.hasExternalProvider && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: `${ds.success.DEFAULT}18`,
                color: ds.success.DEFAULT,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              Bookable
            </span>
          )}
          {facility.isFirstComeFirstServe && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: `${ds.accent[500]}18`,
                color: ds.accent[500],
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              Walk-in
            </span>
          )}
          {facility.hasIndoorCourts && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: `${ds.info[500]}14`,
                color: ds.info[600],
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              Indoor
            </span>
          )}
          {facility.hasOutdoorCourts && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: `${ds.info[500]}14`,
                color: ds.info[600],
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              Outdoor
            </span>
          )}
          {facility.hasLighting && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: `${ds.accent[300]}28`,
                color: ds.accent[500],
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              Lit
            </span>
          )}
        </div>

        {/* Sports */}
        {facility.sports.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {facility.sports.map(sport => (
              <span
                key={sport}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: `${ds.primary[500]}14`,
                  color: ds.primary[700],
                  textTransform: 'capitalize',
                }}
              >
                {sport}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-render map tiles when container size changes (e.g. full-screen toggle)
function MapResizeHandler({ isFullScreen }: { isFullScreen: boolean }) {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(timer);
  }, [isFullScreen, map]);
  return null;
}

interface AdminPlayerMapInnerProps {
  points: PlayerMapPoint[];
  facilities: FacilityMapPoint[];
  viewMode: MapViewMode;
  isSelecting: boolean;
  isFullScreen: boolean;
  onSelectionComplete: (bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }) => void;
}

export default function AdminPlayerMapInner({
  points,
  facilities,
  viewMode,
  isSelecting,
  isFullScreen,
  onSelectionComplete,
}: AdminPlayerMapInnerProps) {
  usePopupStyles();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const handleSelectionComplete = useCallback(
    (bounds: { north: number; south: number; east: number; west: number }) => {
      onSelectionComplete(bounds);
    },
    [onSelectionComplete]
  );

  return (
    <MapContainer
      center={[45.5017, -73.5673]}
      zoom={10}
      className={cn(
        'w-full rounded-lg border border-border dark:border-neutral-700 z-0',
        isFullScreen ? 'h-screen w-screen rounded-none border-none' : 'h-[calc(100vh-360px)]'
      )}
      scrollWheelZoom={true}
    >
      <MapResizeHandler isFullScreen={isFullScreen} />
      <TileLayer
        key={isDark ? 'dark' : 'light'}
        attribution={isDark ? ATTR_DARK : ATTR_LIGHT}
        url={isDark ? TILE_DARK : TILE_LIGHT}
      />

      {/* Player layer: clusters or heatmap */}
      {viewMode === 'clusters' ? (
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterIcon}
          maxClusterRadius={50}
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
        >
          {points.map((point, idx) => (
            <Marker
              key={`p-${point.latitude}-${point.longitude}-${idx}`}
              position={[point.latitude, point.longitude]}
              icon={getPlayerIcon(point.gender)}
            >
              <Popup>
                <PlayerPopup point={point} />
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      ) : (
        <HeatmapLayer points={points} />
      )}

      {/* Facility markers (clustered) */}
      {facilities.length > 0 && (
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createFacilityClusterIcon}
          maxClusterRadius={40}
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
        >
          {facilities.map(f => (
            <Marker
              key={`f-${f.id}`}
              position={[f.latitude, f.longitude]}
              icon={getFacilityIcon(f)}
              {...({ courtCount: f.courtCount } as any)}
            >
              <Popup>
                <FacilityPopup facility={f} />
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      )}

      {/* Rectangle selection */}
      <RectangleSelector active={isSelecting} onComplete={handleSelectionComplete} />
    </MapContainer>
  );
}
