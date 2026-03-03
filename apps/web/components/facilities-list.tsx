'use client';

import { FacilityDialog, type FacilityInitialData } from '@/components/facility-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Building2, Calendar, ChevronRight, Edit, MapPin, Plus, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

interface Court {
  id: string;
  availability_status: string | null;
  is_active: boolean | null;
}

interface Facility {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  is_active: boolean;
  membership_required: boolean;
  is_first_come_first_serve: boolean;
  facility_type: string | null;
  data_provider_id: string | null;
  external_provider_id: string | null;
  created_at?: string;
  court: Court[];
  facility_sport: Array<{ sport_id: string }>;
}

interface FacilitiesListProps {
  facilities: Facility[];
  organizationId: string;
}

type SortOption = 'name-asc' | 'name-desc' | 'courts-desc' | 'courts-asc';
type StatusFilter = 'all' | 'active' | 'inactive';

function getCourtStatusCounts(courts: Court[]) {
  const counts = {
    available: 0,
    maintenance: 0,
    closed: 0,
    reserved: 0,
  };

  for (const court of courts) {
    if (!court.is_active) {
      counts.closed++;
    } else if (court.availability_status === 'available') {
      counts.available++;
    } else if (court.availability_status === 'maintenance') {
      counts.maintenance++;
    } else if (court.availability_status === 'closed') {
      counts.closed++;
    } else if (court.availability_status === 'reserved') {
      counts.reserved++;
    } else {
      // Default to available if no status set
      counts.available++;
    }
  }

  return counts;
}

function CourtStatusSummary({ courts }: { courts: Court[] }) {
  const t = useTranslations('facilities');
  const counts = getCourtStatusCounts(courts);
  const total = courts.length;

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">{t('courtStatus.noCourts')}</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
      {counts.available > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-green-500" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{counts.available}</span>{' '}
            {t('courtStatus.available')}
          </span>
        </div>
      )}
      {counts.maintenance > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-yellow-500" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{counts.maintenance}</span>{' '}
            {t('courtStatus.maintenance')}
          </span>
        </div>
      )}
      {counts.closed > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-gray-400" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{counts.closed}</span>{' '}
            {t('courtStatus.closed')}
          </span>
        </div>
      )}
      {counts.reserved > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-blue-500" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{counts.reserved}</span>{' '}
            {t('courtStatus.reserved')}
          </span>
        </div>
      )}
      {total > 0 &&
        counts.available === 0 &&
        counts.maintenance === 0 &&
        counts.closed === 0 &&
        counts.reserved === 0 && (
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{total}</span>{' '}
              {total === 1 ? t('courtStatus.court') : t('courtStatus.courts')}
            </span>
          </div>
        )}
    </div>
  );
}

function QuickActions({
  facilityId,
  onEditClick,
}: {
  facilityId: string;
  onEditClick: (facilityId: string) => void;
}) {
  const t = useTranslations('facilities');
  const router = useRouter();

  const handleAvailabilityClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/dashboard/facilities/${facilityId}/availability`);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onEditClick(facilityId);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={handleAvailabilityClick}
            >
              <Calendar className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('quickActions.availability')}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" onClick={handleEditClick}>
              <Edit className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('quickActions.edit')}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export function FacilitiesList({ facilities, organizationId }: FacilitiesListProps) {
  const t = useTranslations('facilities');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingFacility, setEditingFacility] = useState<FacilityInitialData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');

  const handleEditClick = (facilityId: string) => {
    const f = facilities.find(fac => fac.id === facilityId);
    if (!f) return;
    setEditingFacility({
      id: f.id,
      name: f.name,
      description: f.description,
      facility_type: f.facility_type,
      address: f.address,
      city: f.city,
      postal_code: f.postal_code,
      country: f.country,
      latitude: f.latitude,
      longitude: f.longitude,
      timezone: f.timezone,
      membership_required: f.membership_required,
      is_first_come_first_serve: f.is_first_come_first_serve,
      data_provider_id: f.data_provider_id,
      external_provider_id: f.external_provider_id,
      facility_sport: f.facility_sport || [],
    });
    setEditDialogOpen(true);
  };

  // Filter and sort facilities
  const filteredFacilities = useMemo(() => {
    let result = [...facilities];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        f =>
          f.name.toLowerCase().includes(query) ||
          f.address?.toLowerCase().includes(query) ||
          f.city?.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter === 'active') {
      result = result.filter(f => f.is_active);
    } else if (statusFilter === 'inactive') {
      result = result.filter(f => !f.is_active);
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortOption) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'courts-desc':
          return (b.court?.length ?? 0) - (a.court?.length ?? 0);
        case 'courts-asc':
          return (a.court?.length ?? 0) - (b.court?.length ?? 0);
        default:
          return 0;
      }
    });

    return result;
  }, [facilities, searchQuery, statusFilter, sortOption]);

  const hasFilters = searchQuery || statusFilter !== 'all';
  const showNoResults = filteredFacilities.length === 0 && facilities.length > 0;

  return (
    <>
      <div className="flex flex-col w-full gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-0">{t('title')}</h1>
            <p className="text-muted-foreground mb-0">{t('description')}</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            {t('addFacility')}
          </Button>
        </div>

        {/* Search and Filters */}
        {facilities.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder={t('search.placeholder')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder={t('filter.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filter.all')}</SelectItem>
                <SelectItem value="active">{t('filter.active')}</SelectItem>
                <SelectItem value="inactive">{t('filter.inactive')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortOption} onValueChange={v => setSortOption(v as SortOption)}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder={t('sort.nameAsc')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">{t('sort.nameAsc')}</SelectItem>
                <SelectItem value="name-desc">{t('sort.nameDesc')}</SelectItem>
                <SelectItem value="courts-desc">{t('sort.courtsDesc')}</SelectItem>
                <SelectItem value="courts-asc">{t('sort.courtsAsc')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Results count when filtering */}
        {hasFilters && filteredFacilities.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('search.results', { count: filteredFacilities.length, total: facilities.length })}
          </p>
        )}

        {/* Empty state - no facilities at all */}
        {!facilities || facilities.length === 0 ? (
          <Card className="border-dashed border-2">
            <CardContent className="flex flex-col items-center justify-center py-20">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl" />
                <div className="relative p-5 bg-linear-to-br from-primary/10 to-primary/5 rounded-2xl border border-primary/20">
                  <Building2 className="size-10 text-primary" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-2">{t('emptyState.title')}</h3>
              <p className="text-muted-foreground text-center mb-8 max-w-md">
                {t('emptyState.description')}
              </p>
              <Button onClick={() => setDialogOpen(true)} size="lg">
                <Plus className="mr-2 size-4" />
                {t('emptyState.addButton')}
              </Button>
            </CardContent>
          </Card>
        ) : showNoResults ? (
          /* No results from search/filter */
          <Card className="border-dashed border-2">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="relative mb-4">
                <div className="p-4 bg-muted rounded-full">
                  <Search className="size-8 text-muted-foreground" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-1">{t('search.noResults')}</h3>
              <p className="text-muted-foreground text-center mb-6 max-w-md">
                {t('search.noResultsDescription')}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                }}
              >
                {t('search.clearFilters')}
              </Button>
            </CardContent>
          </Card>
        ) : (
          /* Facilities grid */
          <div className="grid gap-4">
            {filteredFacilities.map((facility, index) => {
              const courts = Array.isArray(facility.court) ? facility.court : [];

              return (
                <Link
                  key={facility.id}
                  href={`/dashboard/facilities/${facility.id}`}
                  className="block group"
                >
                  <Card
                    className={cn(
                      'relative overflow-hidden transition-all cursor-pointer',
                      'hover:border-primary/50 hover:shadow-lg',
                      'animate-in fade-in-0 slide-in-from-bottom-2'
                    )}
                    style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors shrink-0">
                            <Building2 className="size-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <CardTitle className="text-lg group-hover:text-primary transition-colors truncate">
                              {facility.name}
                            </CardTitle>
                            {(facility.address || facility.city) && (
                              <CardDescription className="flex items-center gap-1 mt-1">
                                <MapPin className="size-3 shrink-0" />
                                <span className="truncate">
                                  {[facility.address, facility.city].filter(Boolean).join(', ')}
                                </span>
                              </CardDescription>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant={facility.is_active ? 'default' : 'secondary'}>
                            {facility.is_active ? t('status.active') : t('status.inactive')}
                          </Badge>
                          <QuickActions facilityId={facility.id} onEditClick={handleEditClick} />
                          <ChevronRight className="size-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center justify-between">
                        <CourtStatusSummary courts={courts} />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <FacilityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizationId={organizationId}
      />
      {editingFacility && (
        <FacilityDialog
          open={editDialogOpen}
          onOpenChange={open => {
            setEditDialogOpen(open);
            if (!open) {
              setEditingFacility(null);
            }
          }}
          initialData={editingFacility}
        />
      )}
    </>
  );
}
