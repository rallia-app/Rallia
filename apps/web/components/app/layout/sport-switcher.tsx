'use client';

import { useTranslations } from 'next-intl';
import { Check, ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useSport } from '@/components/app/sport-provider';

/**
 * Header sport switcher. Hidden for single-sport players — a picker with one option
 * is noise, and mobile hides it the same way.
 */
export function SportSwitcher() {
  const t = useTranslations('sportSelector');
  const { selectedSport, userSports, isLoading, setSelectedSport } = useSport();

  if (isLoading) return <Skeleton className="h-9 w-28 rounded-md" />;
  if (!selectedSport || userSports.length < 2) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('selectSport')}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <span className="truncate">{selectedSport.display_name}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {userSports.map(sport => (
          <DropdownMenuItem
            key={sport.id}
            onSelect={() => void setSelectedSport(sport)}
            className="gap-2"
          >
            <Check
              className={sport.id === selectedSport.id ? 'size-4' : 'size-4 opacity-0'}
              aria-hidden="true"
            />
            {sport.display_name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
