'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

export interface FilterDef {
  key: string;
  type: 'search' | 'select';
  placeholder: string;
  options?: { value: string; label: string }[];
}

interface DataTableFiltersProps {
  filters: FilterDef[];
  clearLabel: string;
}

export function DataTableFilters({ filters, clearLabel }: DataTableFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Track local search values for debouncing (one per search filter)
  const searchFilters = filters.filter(f => f.type === 'search');
  const selectFilters = filters.filter(f => f.type === 'select');

  const getInitialSearchValues = useCallback(() => {
    const values: Record<string, string> = {};
    for (const f of searchFilters) {
      values[f.key] = searchParams.get(f.key) ?? '';
    }
    return values;
  }, [searchFilters, searchParams]);

  const [searchValues, setSearchValues] = useState(getInitialSearchValues);
  const debouncedSearchValues = useDebounce(searchValues, 300);

  const hasActiveFilters = filters.some(f => {
    if (f.type === 'search') {
      return (debouncedSearchValues[f.key] ?? '') !== '';
    }
    return (searchParams.get(f.key) ?? ALL_VALUE) !== ALL_VALUE;
  });

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

      current.delete('page');
      router.push(`?${current.toString()}`);
    },
    [router, searchParams]
  );

  // Sync debounced search values to URL
  useEffect(() => {
    const updates: Record<string, string | null> = {};
    let hasChanges = false;

    for (const f of searchFilters) {
      const currentUrlValue = searchParams.get(f.key) ?? '';
      const debouncedValue = debouncedSearchValues[f.key] ?? '';
      if (debouncedValue !== currentUrlValue) {
        updates[f.key] = debouncedValue || null;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      updateParams(updates);
    }
  }, [debouncedSearchValues, searchFilters, searchParams, updateParams]);

  // Sync URL back to local state (e.g. back/forward navigation)
  useEffect(() => {
    setSearchValues(prev => {
      const next = { ...prev };
      let changed = false;
      for (const f of searchFilters) {
        const urlValue = searchParams.get(f.key) ?? '';
        if (urlValue !== prev[f.key] && urlValue !== (debouncedSearchValues[f.key] ?? '')) {
          next[f.key] = urlValue;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // Only react to URL changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSelectChange = (key: string, value: string) => {
    updateParams({ [key]: value === ALL_VALUE ? null : value });
  };

  const handleClearFilters = () => {
    setSearchValues(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = '';
      }
      return next;
    });
    const current = new URLSearchParams(Array.from(searchParams.entries()));
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
      {searchFilters.map(f => (
        <Input
          key={f.key}
          placeholder={f.placeholder}
          value={searchValues[f.key] ?? ''}
          onChange={e => setSearchValues(prev => ({ ...prev, [f.key]: e.target.value }))}
          className="flex-1 min-w-[200px]"
        />
      ))}

      {selectFilters.map(f => (
        <Select
          key={f.key}
          value={searchParams.get(f.key) ?? ALL_VALUE}
          onValueChange={value => handleSelectChange(f.key, value)}
        >
          <SelectTrigger className="w-40 focus:ring-offset-0">
            <SelectValue placeholder={f.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>{f.placeholder}</SelectItem>
            {f.options?.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={handleClearFilters}>
          <X className="h-4 w-4 mr-1" />
          {clearLabel}
        </Button>
      )}
    </div>
  );
}
