/**
 * useOpenExternalBooking hook
 *
 * Wraps external booking URL opening with pending booking state storage.
 * When the user returns to the app, the PendingExternalBookingContext
 * will detect the return and show a "Did you book?" confirmation.
 */

import { useCallback } from 'react';
import { Linking } from 'react-native';
import type { FormattedSlot, CourtOption } from '@rallia/shared-hooks';
import { Logger } from '@rallia/shared-services';

import * as Analytics from '#/services/analytics';
import { usePendingExternalBooking } from '#/context/PendingExternalBookingContext';

interface FacilityForBooking {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  timezone?: string | null;
}

interface OpenExternalBookingParams {
  facility: FacilityForBooking;
  slot: FormattedSlot;
  selectedCourt?: CourtOption;
  /** Override the booking URL (e.g. when resolved from court selection) */
  bookingUrl?: string;
  /** When set, the confirmation flow will update this match instead of opening the match creation wizard */
  matchId?: string;
  /** Where in the app the redirect was initiated, for analytics breakdowns */
  source?: 'facility_directory' | 'facility_card' | 'match_courts' | 'map' | 'external_sheet';
  /** Sport context, when known */
  sportId?: string;
  sportName?: string;
  /** True when confirming should relocate the match to this facility (nearby alternative). */
  relocatesMatch?: boolean;
}

export function useOpenExternalBooking() {
  const { setPendingBooking } = usePendingExternalBooking();

  const openExternalBooking = useCallback(
    async ({
      facility,
      slot,
      selectedCourt,
      bookingUrl,
      matchId,
      source,
      sportId,
      sportName,
      relocatesMatch,
    }: OpenExternalBookingParams) => {
      // Resolve booking URL
      const url =
        bookingUrl ||
        selectedCourt?.bookingUrl ||
        slot.courtOptions[0]?.bookingUrl ||
        slot.bookingUrl;

      if (!url) return false;

      try {
        const canOpen = await Linking.canOpenURL(url);
        if (!canOpen) return false;

        // Store pending booking context before leaving the app
        setPendingBooking({
          facility,
          slot,
          selectedCourt,
          matchId,
          sportId,
          sportName,
          relocatesMatch,
        });

        Logger.logUserAction('external_booking_opened', {
          facilityId: facility.id,
          facilityName: facility.name,
          slotTime: slot.time,
          bookingUrl: url,
          courtName: selectedCourt?.courtName,
          matchId,
        });

        await Linking.openURL(url);

        Analytics.bookingRedirected({
          facility_id: facility.id,
          sport_id: sportId ?? 'unknown',
          sport_name: sportName ?? 'unknown',
          is_match_linked: !!matchId,
          source: source ?? 'unknown',
        });

        return true;
      } catch (error) {
        Logger.error('Failed to open external booking URL', error as Error);
        return false;
      }
    },
    [setPendingBooking]
  );

  return { openExternalBooking };
}
