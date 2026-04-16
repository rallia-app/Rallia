'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  Building2,
  Flame,
  Link2,
  MapPin,
  Maximize2,
  Minimize2,
  MousePointerSquareDashed,
  Users,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';

const AdminPlayerMapInner = dynamic(() => import('./admin-player-map-inner'), {
  ssr: false,
  loading: () => <Skeleton className="w-full h-[calc(100vh-360px)] rounded-lg" />,
});

export interface PlayerMapPoint {
  latitude: number;
  longitude: number;
  city: string | null;
  province: string | null;
  country: string | null;
  gender: string | null;
  firstName: string | null;
  lastName: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  isActive: boolean;
  accountStatus: string;
  sports: string[];
}

export interface FacilityMapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  facilityType: string | null;
  sports: string[];
  courtCount: number;
  hasExternalProvider: boolean;
  organizationNature: string | null;
  isFirstComeFirstServe: boolean;
  hasIndoorCourts: boolean;
  hasOutdoorCourts: boolean;
  hasLighting: boolean;
}

export interface SelectionStats {
  total: number;
  male: number;
  female: number;
  other: number;
  sports: [string, number][];
  topCities: [string, number][];
}

export type MapViewMode = 'clusters' | 'heatmap';

interface AdminPlayerMapProps {
  points: PlayerMapPoint[];
  facilities: FacilityMapPoint[];
}

export function AdminPlayerMap({ points, facilities }: AdminPlayerMapProps) {
  const t = useTranslations('admin.map');
  const [genderFilter, setGenderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [provinceFilter, setProvinceFilter] = useState('all');
  const [viewMode, setViewMode] = useState<MapViewMode>('clusters');
  const [showPlayers, setShowPlayers] = useState(true);
  const [showFacilities, setShowFacilities] = useState(true);
  const [showOnlyBookable, setShowOnlyBookable] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStats, setSelectionStats] = useState<SelectionStats | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Facility filters
  const [sportFilter, setSportFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [bookingFilter, setBookingFilter] = useState('all');
  const [lightingFilter, setLightingFilter] = useState('all');
  const [indoorFilter, setIndoorFilter] = useState('all');

  // Escape key to exit full-screen
  useEffect(() => {
    if (!isFullScreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullScreen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isFullScreen]);

  // Lock body scroll when full-screen
  useEffect(() => {
    if (isFullScreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullScreen]);

  // Growth animation
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);

  const dateExtents = useMemo(() => {
    if (points.length === 0) return null;
    let min = points[0].createdAt;
    let max = points[0].createdAt;
    for (const p of points) {
      if (p.createdAt < min) min = p.createdAt;
      if (p.createdAt > max) max = p.createdAt;
    }
    return [min.slice(0, 10), max.slice(0, 10)] as [string, string];
  }, [points]);

  const provinces = useMemo(() => {
    const set = new Set<string>();
    for (const p of points) {
      if (p.province) set.add(p.province);
    }
    return Array.from(set).sort();
  }, [points]);

  const filteredPoints = useMemo(() => {
    return points.filter(p => {
      if (genderFilter !== 'all' && p.gender !== genderFilter) return false;
      if (statusFilter === 'active' && !p.isActive) return false;
      if (statusFilter === 'inactive' && p.isActive) return false;
      if (statusFilter === 'suspended' && p.accountStatus !== 'suspended') return false;
      if (provinceFilter !== 'all' && p.province !== provinceFilter) return false;
      if (dateRange) {
        const created = p.createdAt.slice(0, 10);
        if (created < dateRange[0] || created > dateRange[1]) return false;
      }
      return true;
    });
  }, [points, genderFilter, statusFilter, provinceFilter, dateRange]);

  const topCities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of filteredPoints) {
      if (p.city) counts.set(p.city, (counts.get(p.city) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [filteredPoints]);

  const filteredFacilities = useMemo(() => {
    return facilities.filter(f => {
      if (showOnlyBookable && !f.hasExternalProvider) return false;

      // Sport filter
      if (sportFilter !== 'all') {
        const hasTennis = f.sports.some(s => s.toLowerCase() === 'tennis');
        const hasPickleball = f.sports.some(s => s.toLowerCase() === 'pickleball');
        if (sportFilter === 'tennis' && !hasTennis) return false;
        if (sportFilter === 'pickleball' && !hasPickleball) return false;
        if (sportFilter === 'both' && !(hasTennis && hasPickleball)) return false;
      }

      // Public vs Private (from organization nature)
      if (accessFilter !== 'all' && f.organizationNature !== accessFilter) return false;

      // Booking
      if (bookingFilter === 'fcfs' && !f.isFirstComeFirstServe) return false;
      if (bookingFilter === 'booking_required' && f.isFirstComeFirstServe) return false;

      // Lighting
      if (lightingFilter === 'yes' && !f.hasLighting) return false;
      if (lightingFilter === 'no' && f.hasLighting) return false;

      // Indoor / Outdoor
      if (indoorFilter === 'indoor' && !f.hasIndoorCourts) return false;
      if (indoorFilter === 'outdoor' && !f.hasOutdoorCourts) return false;
      if (indoorFilter === 'both' && !(f.hasIndoorCourts && f.hasOutdoorCourts)) return false;

      return true;
    });
  }, [
    facilities,
    showOnlyBookable,
    sportFilter,
    accessFilter,
    bookingFilter,
    lightingFilter,
    indoorFilter,
  ]);

  const handleSelectionComplete = useCallback(
    (bounds: { north: number; south: number; east: number; west: number }) => {
      const selected = filteredPoints.filter(
        p =>
          p.latitude >= bounds.south &&
          p.latitude <= bounds.north &&
          p.longitude >= bounds.west &&
          p.longitude <= bounds.east
      );

      if (selected.length === 0) {
        setSelectionStats(null);
        setIsSelecting(false);
        return;
      }

      const cityCounts = new Map<string, number>();
      const sportCounts = new Map<string, number>();
      let male = 0,
        female = 0,
        other = 0;
      for (const p of selected) {
        if (p.gender === 'male') male++;
        else if (p.gender === 'female') female++;
        else other++;
        if (p.city) cityCounts.set(p.city, (cityCounts.get(p.city) ?? 0) + 1);
        for (const s of p.sports) {
          sportCounts.set(s, (sportCounts.get(s) ?? 0) + 1);
        }
      }

      setSelectionStats({
        total: selected.length,
        male,
        female,
        other,
        sports: Array.from(sportCounts.entries()).sort((a, b) => b[1] - a[1]),
        topCities: Array.from(cityCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5),
      });
      setIsSelecting(false);
    },
    [filteredPoints]
  );

  // Full-screen: render only the map with a floating exit button
  if (isFullScreen) {
    return (
      <div className="fixed inset-0 z-50">
        {points.length > 0 || facilities.length > 0 ? (
          <AdminPlayerMapInner
            points={showPlayers ? filteredPoints : []}
            facilities={showFacilities ? filteredFacilities : []}
            viewMode={viewMode}
            isSelecting={isSelecting}
            isFullScreen={isFullScreen}
            onSelectionComplete={handleSelectionComplete}
          />
        ) : (
          <div className="w-full h-full bg-background flex items-center justify-center">
            <p className="text-muted-foreground">{t('noData')}</p>
          </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-4 right-4 z-[1000] size-10 shadow-lg"
              onClick={() => setIsFullScreen(false)}
            >
              <Minimize2 className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t('controls.exitFullScreen')}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        {/* Left: Layers */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('gap-1.5 h-8', showPlayers && 'bg-primary/10 text-primary')}
            onClick={() => setShowPlayers(!showPlayers)}
          >
            <Users className="size-3.5" />
            {t('controls.players')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('gap-1.5 h-8', showFacilities && 'bg-primary/10 text-primary')}
            onClick={() => setShowFacilities(!showFacilities)}
          >
            <Building2 className="size-3.5" />
            {t('controls.facilities')}
          </Button>
          {showFacilities && (
            <Button
              variant="ghost"
              size="sm"
              className={cn('gap-1.5 h-8', showOnlyBookable && 'bg-primary/10 text-primary')}
              onClick={() => setShowOnlyBookable(!showOnlyBookable)}
            >
              <Link2 className="size-3.5" />
              {t('controls.thirdPartyOnly')}
            </Button>
          )}
        </div>

        {/* Center: View mode */}
        <div className="flex items-center rounded-md border border-border">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'rounded-r-none gap-1.5 h-8',
              viewMode === 'clusters' && 'bg-primary/10 text-primary'
            )}
            onClick={() => setViewMode('clusters')}
          >
            <Users className="size-3.5" />
            {t('controls.clusters')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'rounded-l-none gap-1.5 h-8',
              viewMode === 'heatmap' && 'bg-primary/10 text-primary'
            )}
            onClick={() => setViewMode('heatmap')}
          >
            <Flame className="size-3.5" />
            {t('controls.heatmap')}
          </Button>
        </div>

        {/* Right: Tools */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('gap-1.5 h-8', isSelecting && 'bg-primary/10 text-primary')}
            onClick={() => {
              setIsSelecting(!isSelecting);
              if (!isSelecting) setSelectionStats(null);
            }}
          >
            <MousePointerSquareDashed className="size-3.5" />
            {t('controls.selectArea')}
          </Button>
          <div className="h-5 w-px bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setIsFullScreen(true)}
              >
                <Maximize2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('controls.fullScreen')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Player filters */}
      {showPlayers && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Users className="size-3" />
            {t('controls.players')}
          </span>
          <Select value={genderFilter} onValueChange={setGenderFilter}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue placeholder={t('filters.gender')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue placeholder={t('filters.status')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
              <SelectItem value="active">{t('filters.active')}</SelectItem>
              <SelectItem value="inactive">{t('filters.inactive')}</SelectItem>
              <SelectItem value="suspended">{t('filters.suspended')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={provinceFilter} onValueChange={setProvinceFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder={t('filters.province')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
              {provinces.map(prov => (
                <SelectItem key={prov} value={prov}>
                  {prov}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {dateExtents && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground shrink-0">
                {t('controls.joinedBetween')}:
              </span>
              <input
                type="date"
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                min={dateExtents[0]}
                max={dateExtents[1]}
                value={dateRange?.[0] ?? dateExtents[0]}
                onChange={e => setDateRange([e.target.value, dateRange?.[1] ?? dateExtents[1]])}
              />
              <span className="text-muted-foreground text-xs">—</span>
              <input
                type="date"
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                min={dateExtents[0]}
                max={dateExtents[1]}
                value={dateRange?.[1] ?? dateExtents[1]}
                onChange={e => setDateRange([dateRange?.[0] ?? dateExtents[0], e.target.value])}
              />
              {dateRange && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setDateRange(null)}
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Facility filters */}
      {showFacilities && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Building2 className="size-3" />
            {t('facilityFilters.label')}
          </span>
          <Select value={sportFilter} onValueChange={setSportFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder={t('facilityFilters.sport')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
              <SelectItem value="tennis">Tennis</SelectItem>
              <SelectItem value="pickleball">Pickleball</SelectItem>
              <SelectItem value="both">{t('facilityFilters.bothSports')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={accessFilter} onValueChange={setAccessFilter}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue placeholder={t('facilityFilters.access')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
              <SelectItem value="public">{t('facilityFilters.public')}</SelectItem>
              <SelectItem value="private">{t('facilityFilters.private')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={bookingFilter} onValueChange={setBookingFilter}>
            <SelectTrigger className="h-8 w-[155px] text-xs">
              <SelectValue placeholder={t('facilityFilters.booking')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
              <SelectItem value="fcfs">{t('facilityFilters.firstCome')}</SelectItem>
              <SelectItem value="booking_required">
                {t('facilityFilters.bookingRequired')}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={lightingFilter} onValueChange={setLightingFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder={t('facilityFilters.lighting')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
              <SelectItem value="yes">{t('facilityFilters.withLighting')}</SelectItem>
              <SelectItem value="no">{t('facilityFilters.noLighting')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={indoorFilter} onValueChange={setIndoorFilter}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue placeholder={t('facilityFilters.venue')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
              <SelectItem value="indoor">{t('facilityFilters.indoorOnly')}</SelectItem>
              <SelectItem value="outdoor">{t('facilityFilters.outdoorOnly')}</SelectItem>
              <SelectItem value="both">{t('facilityFilters.indoorAndOutdoor')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Stats & Legend */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <MapPin className="size-3" />
          {t('stats.totalPlayers', { count: filteredPoints.length })}
        </span>
        {showFacilities && facilities.length > 0 && (
          <>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1">
              <Building2 className="size-3" />
              {t('stats.totalFacilities', { count: filteredFacilities.length })}
            </span>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-sm" style={{ background: '#14b8a6' }} />
              {t('legend.tennis')}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-sm" style={{ background: '#f59e0b' }} />
              {t('legend.pickleball')}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-sm overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #14b8a6 50%, #f59e0b 50%)' }}
              />
              {t('legend.tennis')} + {t('legend.pickleball')}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-sm"
                style={{
                  background: '#0ea5e9',
                  boxShadow: '0 0 0 1.5px #059669, 0 0 4px 1px #05966966',
                }}
              />
              {t('legend.bookable')}
            </span>
          </>
        )}
        {topCities.length > 0 && (
          <>
            <span className="text-border">|</span>
            <span>{t('stats.topCities')}:</span>
            {topCities.map(([city, count]) => (
              <Badge key={city} variant="secondary" className="font-normal text-[10px] h-5 px-1.5">
                {city} ({count})
              </Badge>
            ))}
          </>
        )}
      </div>

      {/* Selection stats panel */}
      {selectionStats && (
        <Card className="border-primary/30">
          <CardContent className="flex flex-wrap items-center gap-4 py-2.5 px-3">
            <div className="flex items-center gap-1.5">
              <MousePointerSquareDashed className="size-3.5 text-primary" />
              <span className="font-semibold text-sm">{t('selection.title')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span>
                <strong>{selectionStats.total}</strong> {t('selection.players')}
              </span>
              <span className="text-border">|</span>
              <span>
                M: {selectionStats.male} / F: {selectionStats.female} / O: {selectionStats.other}
              </span>
              {selectionStats.sports.length > 0 && (
                <>
                  <span className="text-border">|</span>
                  {selectionStats.sports.map(([sport, count]) => (
                    <Badge
                      key={sport}
                      variant="secondary"
                      className="font-normal capitalize text-[10px] h-5 px-1.5"
                    >
                      {sport} ({count})
                    </Badge>
                  ))}
                </>
              )}
              {selectionStats.topCities.length > 0 && (
                <>
                  <span className="text-border">|</span>
                  {selectionStats.topCities.map(([city, count]) => (
                    <Badge
                      key={city}
                      variant="outline"
                      className="font-normal text-[10px] h-5 px-1.5"
                    >
                      {city} ({count})
                    </Badge>
                  ))}
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-6"
              onClick={() => setSelectionStats(null)}
            >
              <X className="size-3" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Map */}
      {points.length > 0 || facilities.length > 0 ? (
        <AdminPlayerMapInner
          points={showPlayers ? filteredPoints : []}
          facilities={showFacilities ? filteredFacilities : []}
          viewMode={viewMode}
          isSelecting={isSelecting}
          isFullScreen={isFullScreen}
          onSelectionComplete={handleSelectionComplete}
        />
      ) : (
        <div className="w-full h-[calc(100vh-360px)] rounded-lg border border-border flex items-center justify-center">
          <p className="text-muted-foreground">{t('noData')}</p>
        </div>
      )}
    </div>
  );
}
