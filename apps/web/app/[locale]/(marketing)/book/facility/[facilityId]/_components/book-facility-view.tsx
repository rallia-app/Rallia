'use client';

import { useCallback, useMemo, useState } from 'react';

import type {
  WebBookFacilityContext,
  WebBookSlotGroup,
  WebBookSport,
} from '../_lib/facility-context';
import { WebBookWizard } from '../web-book-wizard';

import { FacilityProfileView } from './facility-profile-view';

import { courtsSlotSwitched, courtsSportSwitched } from '@/lib/analytics';

interface BookFacilityViewProps {
  facility: WebBookFacilityContext;
  locale: string;
}

/**
 * Owns the live sport and slot selection so the summary panel and the wizard
 * stay in sync. Every sport's groups already ship from the server, so both
 * toggles re-resolve instantly — no round trip, and no re-running the signup
 * wizard the visitor may be halfway through.
 */
export function BookFacilityView({ facility, locale }: BookFacilityViewProps) {
  const [sportSlug, setSportSlug] = useState<string | null>(facility.initialSportSlug);
  const [selectedGroup, setSelectedGroup] = useState<WebBookSlotGroup | null>(
    facility.selectedGroup
  );
  // Server-resolved from `?start=` on first load; a fresh pick clears it.
  const [slotMissing, setSlotMissing] = useState(facility.slotMissing);

  const selectedSport: WebBookSport | null =
    facility.sports.find(s => s.slug === sportSlug) ?? facility.sports[0] ?? null;

  const groups = useMemo(
    () => (selectedSport ? (facility.groupsBySport[selectedSport.slug] ?? []) : []),
    [facility.groupsBySport, selectedSport]
  );

  const syncUrl = useCallback((slug: string | null, group: WebBookSlotGroup | null) => {
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set('sport', slug);
    else url.searchParams.delete('sport');

    if (group) {
      // Z-form, never the DB's `+00:00`: a bare `+` in a query string decodes
      // as a space, so an offset timestamp is one sloppy re-encode away from
      // silently failing to match.
      url.searchParams.set('start', new Date(group.slotStart).toISOString());
      url.searchParams.set('end', new Date(group.slotEnd).toISOString());
    } else {
      url.searchParams.delete('start');
      url.searchParams.delete('end');
    }
    // Keep the URL shareable and refresh-safe without re-rendering the server
    // component (which would reset wizard progress).
    window.history.replaceState(null, '', url.toString());
  }, []);

  const handleSelectGroup = useCallback(
    (group: WebBookSlotGroup) => {
      setSelectedGroup(prev => {
        if (prev && prev.slotStart === group.slotStart && prev.slotEnd === group.slotEnd) {
          return prev;
        }
        courtsSlotSwitched({ facility_id: facility.id, court_count: group.courts.length });
        return group;
      });
      setSlotMissing(false);
      syncUrl(selectedSport?.slug ?? null, group);
    },
    [facility.id, selectedSport?.slug, syncUrl]
  );

  /**
   * Switching sport always drops the slot: a tennis 4pm group and a pickleball
   * 4pm group are different courts, so carrying the selection across would
   * point the CTA at the wrong sport's booking page.
   */
  const handleSelectSport = useCallback(
    (slug: string) => {
      if (slug === selectedSport?.slug) return;
      courtsSportSwitched({ facility_id: facility.id, sport_slug: slug });
      setSportSlug(slug);
      setSelectedGroup(null);
      setSlotMissing(false);
      syncUrl(slug, null);
    },
    [facility.id, selectedSport?.slug, syncUrl]
  );

  const handleClearSlot = useCallback(() => {
    setSelectedGroup(null);
    setSlotMissing(false);
    syncUrl(selectedSport?.slug ?? null, null);
  }, [selectedSport?.slug, syncUrl]);

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2 lg:gap-10">
      <FacilityProfileView
        facility={facility}
        sports={facility.sports}
        selectedSport={selectedSport}
        onSelectSport={handleSelectSport}
        groups={groups}
        selectedGroup={selectedGroup}
        onSelectGroup={handleSelectGroup}
      />

      <div className="w-full lg:sticky lg:top-8">
        <WebBookWizard
          facility={facility}
          selectedSport={selectedSport}
          selectedGroup={selectedGroup}
          slotMissing={slotMissing}
          onClearSlot={handleClearSlot}
          locale={locale}
        />
      </div>
    </div>
  );
}
