'use client';

import { useEffect, useState } from 'react';
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

  /**
   * The sport list is client-fetched, so the server always renders the loading branch
   * while the client's first render may already have data. That made this component's
   * subtree a different shape on each side, which shifts every `useId` after it in the
   * header — the avatar menu's Radix trigger ended up with a different generated id on
   * server and client and React logged a hydration mismatch.
   *
   * Rendering nothing until mounted makes both sides agree on the first pass. The
   * switcher then appears in a normal client update.
   */
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  if (!isMounted) return null;
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
