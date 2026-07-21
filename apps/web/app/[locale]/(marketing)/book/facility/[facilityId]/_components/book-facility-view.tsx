'use client';

import { useCallback, useState } from 'react';

import type { WebBookFacilityContext, WebBookSlotGroup } from '../_lib/facility-context';
import { WebBookWizard } from '../web-book-wizard';

import { FacilityProfileView } from './facility-profile-view';

import { courtsSlotSwitched } from '@/lib/analytics';

interface BookFacilityViewProps {
  facility: WebBookFacilityContext;
  locale: string;
}

/**
 * Owns the live slot selection so the summary panel and the wizard stay in
 * sync. Every open group already ships with its courts from the server, so
 * switching slots re-resolves the bookable courts instantly — no round trip
 * and no re-running the signup wizard the visitor may be halfway through.
 */
export function BookFacilityView({ facility, locale }: BookFacilityViewProps) {
  const [selectedGroup, setSelectedGroup] = useState<WebBookSlotGroup | null>(
    facility.selectedGroup
  );
  // Server-resolved from `?start=` on first load; a fresh pick clears it.
  const [slotMissing, setSlotMissing] = useState(facility.slotMissing);

  const syncUrl = useCallback((group: WebBookSlotGroup | null) => {
    const url = new URL(window.location.href);
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
      syncUrl(group);
    },
    [facility.id, syncUrl]
  );

  const handleClearSlot = useCallback(() => {
    setSelectedGroup(null);
    setSlotMissing(false);
    syncUrl(null);
  }, [syncUrl]);

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
      <FacilityProfileView
        facility={facility}
        selectedGroup={selectedGroup}
        onSelectGroup={handleSelectGroup}
      />

      <div className="w-full lg:sticky lg:top-8">
        <WebBookWizard
          facility={facility}
          selectedGroup={selectedGroup}
          slotMissing={slotMissing}
          onClearSlot={handleClearSlot}
          locale={locale}
        />
      </div>
    </div>
  );
}
