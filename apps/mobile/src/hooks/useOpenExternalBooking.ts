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

import { usePendingExternalBooking } from '../context/PendingExternalBookingContext';

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
}

export function useOpenExternalBooking() {
  const { setPendingBooking } = usePendingExternalBooking();

  const openExternalBooking = useCallback(
    async ({ facility, slot, selectedCourt, bookingUrl, matchId }: OpenExternalBookingParams) => {
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
        setPendingBooking({ facility, slot, selectedCourt, matchId });

        Logger.logUserAction('external_booking_opened', {
          facilityId: facility.id,
          facilityName: facility.name,
          slotTime: slot.time,
          bookingUrl: url,
          courtName: selectedCourt?.courtName,
          matchId,
        });

        await Linking.openURL(url);
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
