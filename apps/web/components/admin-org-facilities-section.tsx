'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FacilityDialog } from '@/components/facility-dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link, useRouter } from '@/i18n/navigation';
import { useDebounce } from '@rallia/shared-hooks';
import { Building2, MapPin, Plus, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useMemo, useState } from 'react';

const ALL_SPORTS = '__all__';

// Helper to capitalize strings
function capitalize(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

type FacilityFileJoin = {
  id: string;
  display_order: number | null;
  is_primary: boolean | null;
  file: {
    id: string;
    url: string;
    thumbnail_url: string | null;
  } | null;
};

type Sport = {
  id: string;
  name: string;
  slug: string;
};

type Facility = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
  facility_file: FacilityFileJoin[];
  facility_sport: Array<{
    sport_id: string;
    sport: Sport;
  }>;
};

interface AdminOrgFacilitiesSectionProps {
  facilities: Facility[];
  organizationId: string;
  slug: string;
}

export function AdminOrgFacilitiesSection({
  facilities,
  organizationId,
  slug,
}: AdminOrgFacilitiesSectionProps) {
  const t = useTranslations('admin.organizations.profile');
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [sportFilter, setSportFilter] = useState(ALL_SPORTS);
  const debouncedSearch = useDebounce(searchValue, 300);

  const handleFacilityCreated = (facilityId: string) => {
    router.push(`/admin/organizations/${slug}/facilities/${facilityId}`);
  };

  const allSports = useMemo(() => {
    const sportMap = new Map<string, string>();
    for (const facility of facilities) {
      for (const fs of facility.facility_sport) {
        if (!sportMap.has(fs.sport_id)) {
          sportMap.set(fs.sport_id, fs.sport.name);
        }
      }
    }
    return Array.from(sportMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [facilities]);

  const filteredFacilities = useMemo(() => {
    let result = facilities;

    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        f =>
          f.name.toLowerCase().includes(query) ||
          f.address?.toLowerCase().includes(query) ||
          f.city?.toLowerCase().includes(query)
      );
    }

    if (sportFilter !== ALL_SPORTS) {
      result = result.filter(f => f.facility_sport.some(fs => fs.sport_id === sportFilter));
    }

    return result;
  }, [facilities, debouncedSearch, sportFilter]);

  const hasActiveFilters = debouncedSearch !== '' || sportFilter !== ALL_SPORTS;
  const isFiltered = hasActiveFilters && filteredFacilities.length !== facilities.length;

  const handleClearFilters = () => {
    setSearchValue('');
    setSportFilter(ALL_SPORTS);
  };

  return (
    <>
      <FacilityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizationId={organizationId}
        onSuccess={handleFacilityCreated}
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{t('sections.facilities')}</h2>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-sm px-3 py-1">
              {isFiltered
                ? t('facilitiesFiltered', {
                    filtered: filteredFacilities.length,
                    total: facilities.length,
                  })
                : `${facilities.length} ${facilities.length === 1 ? t('facility') : t('facilities')}`}
            </Badge>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              {t('addFacility')}
            </Button>
          </div>
        </div>

        {facilities.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('searchFacilitiesPlaceholder')}
                value={searchValue}
                onChange={e => setSearchValue(e.target.value)}
                className="pl-9"
              />
            </div>

            {allSports.length > 0 && (
              <Select value={sportFilter} onValueChange={setSportFilter}>
                <SelectTrigger className="w-44 focus:ring-offset-0">
                  <SelectValue placeholder={t('allSports')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SPORTS}>{t('allSports')}</SelectItem>
                  {allSports.map(sport => (
                    <SelectItem key={sport.id} value={sport.id}>
                      {capitalize(sport.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                <X className="h-4 w-4 mr-1" />
                {t('clearFilters')}
              </Button>
            )}
          </div>
        )}

        {facilities.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <Building2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground mb-4">{t('noFacilities')}</p>
                <Button variant="outline" onClick={() => setDialogOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  {t('addFacility')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : filteredFacilities.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <Search className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground mb-4">{t('noMatchingFacilities')}</p>
                <Button variant="outline" size="sm" onClick={handleClearFilters}>
                  <X className="mr-2 size-4" />
                  {t('clearFilters')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          filteredFacilities.map(facility => (
            <Link
              key={facility.id}
              href={`/admin/organizations/${slug}/facilities/${facility.id}`}
              className="block"
            >
              <Card className="overflow-hidden hover:border-primary/50 transition-colors cursor-pointer">
                <CardHeader className="bg-muted/30 border-b">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{facility.name}</CardTitle>
                        {(facility.address || facility.city || facility.country) && (
                          <CardDescription className="mt-1 flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {[
                              facility.address,
                              facility.city,
                              capitalize(facility.country),
                              facility.postal_code,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </CardDescription>
                        )}
                      </div>
                    </div>
                    {facility.facility_sport && facility.facility_sport.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 justify-end max-w-[200px]">
                        {facility.facility_sport.map(fs => (
                          <Badge key={fs.sport_id} variant="default" className="text-xs">
                            {capitalize(fs.sport.name)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardHeader>
                {facility.facility_file && facility.facility_file.length > 0 && (
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {facility.facility_file
                        .filter(ff => ff.file)
                        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
                        .slice(0, 4)
                        .map(facilityFile => (
                          <div
                            key={facilityFile.id}
                            className={`relative aspect-video rounded-lg overflow-hidden border-2 ${
                              facilityFile.is_primary ? 'border-primary' : 'border-transparent'
                            } shadow-sm`}
                          >
                            <Image
                              src={facilityFile.file!.thumbnail_url || facilityFile.file!.url}
                              alt={facility.name}
                              fill
                              className="object-cover"
                            />
                            {facilityFile.is_primary && (
                              <div className="absolute top-2 left-2">
                                <Badge variant="default" className="text-xs shadow">
                                  {t('primary')}
                                </Badge>
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
