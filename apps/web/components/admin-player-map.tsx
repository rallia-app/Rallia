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
import { cn } from '@/lib/utils';
import { Building2, Flame, MapPin, MousePointerSquareDashed, Users, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';

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
  const [showFacilities, setShowFacilities] = useState(true);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStats, setSelectionStats] = useState<SelectionStats | null>(null);

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

  return (
    <div className="flex flex-col gap-4">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Filters */}
        <Select value={genderFilter} onValueChange={setGenderFilter}>
          <SelectTrigger className="w-[140px]">
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
          <SelectTrigger className="w-[140px]">
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
          <SelectTrigger className="w-[160px]">
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

        {/* Separator */}
        <div className="h-6 w-px bg-border" />

        {/* View mode toggle */}
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

        {/* Facility toggle */}
        <Button
          variant="ghost"
          size="sm"
          className={cn('gap-1.5 h-8', showFacilities && 'bg-primary/10 text-primary')}
          onClick={() => setShowFacilities(!showFacilities)}
        >
          <Building2 className="size-3.5" />
          {t('controls.facilities')}
        </Button>

        {/* Area select */}
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
      </div>

      {/* Growth timeline */}
      {dateExtents && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground shrink-0">{t('controls.joinedBetween')}:</span>
          <input
            type="date"
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            min={dateExtents[0]}
            max={dateExtents[1]}
            value={dateRange?.[0] ?? dateExtents[0]}
            onChange={e => setDateRange([e.target.value, dateRange?.[1] ?? dateExtents[1]])}
          />
          <span className="text-muted-foreground">—</span>
          <input
            type="date"
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            min={dateExtents[0]}
            max={dateExtents[1]}
            value={dateRange?.[1] ?? dateExtents[1]}
            onChange={e => setDateRange([dateRange?.[0] ?? dateExtents[0], e.target.value])}
          />
          {dateRange && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => setDateRange(null)}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MapPin className="size-3.5" />
          {t('stats.totalPlayers', { count: filteredPoints.length })}
        </span>
        {showFacilities && facilities.length > 0 && (
          <>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1.5">
              <Building2 className="size-3.5" />
              {t('stats.totalFacilities', { count: facilities.length })}
            </span>
          </>
        )}
        {topCities.length > 0 && (
          <>
            <span className="text-border">|</span>
            <span>{t('stats.topCities')}:</span>
            {topCities.map(([city, count]) => (
              <Badge key={city} variant="secondary" className="font-normal">
                {city} ({count})
              </Badge>
            ))}
          </>
        )}
      </div>

      {/* Selection stats panel */}
      {selectionStats && (
        <Card className="border-primary/30">
          <CardContent className="flex flex-wrap items-center gap-6 py-3 px-4">
            <div className="flex items-center gap-2">
              <MousePointerSquareDashed className="size-4 text-primary" />
              <span className="font-semibold">{t('selection.title')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
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
                    <Badge key={sport} variant="secondary" className="font-normal capitalize">
                      {sport} ({count})
                    </Badge>
                  ))}
                </>
              )}
              {selectionStats.topCities.length > 0 && (
                <>
                  <span className="text-border">|</span>
                  {selectionStats.topCities.map(([city, count]) => (
                    <Badge key={city} variant="outline" className="font-normal">
                      {city} ({count})
                    </Badge>
                  ))}
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2"
              onClick={() => setSelectionStats(null)}
            >
              <X className="size-3.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Map */}
      {filteredPoints.length > 0 ? (
        <AdminPlayerMapInner
          points={filteredPoints}
          facilities={showFacilities ? facilities : []}
          viewMode={viewMode}
          isSelecting={isSelecting}
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
