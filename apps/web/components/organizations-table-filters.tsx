'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { useDebounce } from '@rallia/shared-hooks';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL_VALUE = '__all__';

export function OrganizationsTableFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('admin.organizations');

  const initialSearch = searchParams.get('filter[name_like]') ?? '';
  const initialNature = searchParams.get('filter[nature]') ?? ALL_VALUE;
  const initialStatus = searchParams.get('filter[is_active]') ?? ALL_VALUE;

  const [searchValue, setSearchValue] = useState(initialSearch);
  const debouncedSearch = useDebounce(searchValue, 300);

  const hasActiveFilters =
    debouncedSearch !== '' || initialNature !== ALL_VALUE || initialStatus !== ALL_VALUE;

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const current = new URLSearchParams(Array.from(searchParams.entries()));

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '' || value === ALL_VALUE) {
          current.delete(key);
        } else {
          current.set(key, value);
        }
      }

      // Reset to page 1 when filters change
      current.delete('page');

      router.push(`?${current.toString()}`);
    },
    [router, searchParams]
  );

  // Sync debounced search to URL
  useEffect(() => {
    const currentUrlValue = searchParams.get('filter[name_like]') ?? '';
    if (debouncedSearch !== currentUrlValue) {
      updateParams({ 'filter[name_like]': debouncedSearch || null });
    }
  }, [debouncedSearch, searchParams, updateParams]);

  // Sync URL back to local state when navigating (e.g. back/forward)
  useEffect(() => {
    const urlSearch = searchParams.get('filter[name_like]') ?? '';
    if (urlSearch !== searchValue && urlSearch !== debouncedSearch) {
      setSearchValue(urlSearch);
    }
    // Only react to URL changes, not local state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleNatureChange = (value: string) => {
    updateParams({ 'filter[nature]': value === ALL_VALUE ? null : value });
  };

  const handleStatusChange = (value: string) => {
    updateParams({ 'filter[is_active]': value === ALL_VALUE ? null : value });
  };

  const handleClearFilters = () => {
    setSearchValue('');
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    // Remove all filter params
    for (const key of Array.from(current.keys())) {
      if (key.startsWith('filter[')) {
        current.delete(key);
      }
    }
    current.delete('page');
    router.push(`?${current.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        placeholder={t('filters.searchPlaceholder')}
        value={searchValue}
        onChange={e => setSearchValue(e.target.value)}
        className="flex-1 min-w-[200px]"
      />

      <Select value={initialNature} onValueChange={handleNatureChange}>
        <SelectTrigger className="w-40 focus:ring-offset-0">
          <SelectValue placeholder={t('filters.nature')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t('filters.allNatures')}</SelectItem>
          <SelectItem value="public">{t('nature.public')}</SelectItem>
          <SelectItem value="private">{t('nature.private')}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={initialStatus} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-40 focus:ring-offset-0">
          <SelectValue placeholder={t('filters.status')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t('filters.allStatuses')}</SelectItem>
          <SelectItem value="true">{t('status.active')}</SelectItem>
          <SelectItem value="false">{t('status.inactive')}</SelectItem>
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={handleClearFilters}>
          <X className="h-4 w-4 mr-1" />
          {t('filters.clearFilters')}
        </Button>
      )}
    </div>
  );
}
