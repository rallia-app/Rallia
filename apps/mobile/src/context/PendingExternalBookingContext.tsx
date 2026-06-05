/**
 * PendingExternalBookingContext
 *
 * Tracks when a user opens an external booking URL.
 *
 * Two return flows are supported:
 *
 *  - Directory / facility-screen flow: no matchId is attached. On return we show
 *    the BookingConfirmationSheet (via SheetManager) which leads into the match
 *    creation wizard.
 *
 *  - Match-linked flow (from MatchDetailSheet's available-courts section): a
 *    matchId is attached. On return we show the MatchBookingConfirmationSheet
 *    (via SheetManager) — a stacked actions sheet, NOT a React Native <Modal>,
 *    so it sits on top of the still-open match-detail sheet instead of behind
 *    it. Confirming updates the existing match (court_id, court_status, and —
 *    when we know the slot price — estimated_cost / is_court_free) and
 *    re-renders the already-open match detail sheet in place.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { SheetManager } from 'react-native-actions-sheet';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@rallia/shared-components';
import { matchKeys } from '@rallia/shared-hooks';
import type { FormattedSlot, CourtOption } from '@rallia/shared-hooks';
import type { CreateMatchInput } from '@rallia/shared-services';
import {
  getMatchWithDetails,
  getOrCreateCourt,
  Logger,
  updateMatch,
} from '@rallia/shared-services';

import { useTranslation } from '#/hooks/useTranslation';
import * as Analytics from '#/services/analytics';

import { useActionsSheet } from './ActionsSheetContext';
import { useMatchDetailSheet, type MatchDetailData } from './MatchDetailSheetContext';

// =============================================================================
// TYPES
// =============================================================================

interface PendingBookingData {
  /** Facility object (FacilitySearchResult or FacilityWithDetails) */
  facility: {
    id: string;
    name: string;
    address?: string | null;
    city?: string | null;
    timezone?: string | null;
  };
  /** The slot that was booked */
  slot: FormattedSlot;
  /** Selected court (if user chose from multiple) */
  selectedCourt?: CourtOption;
  /** When the booking was initiated for an existing match, we update that match on confirm
   *  instead of opening the match-creation wizard. */
  matchId?: string;
  /** Sport context, when known — propagated to analytics on confirm */
  sportId?: string;
  sportName?: string;
  /** Timestamp when the booking was initiated */
  timestamp: number;
}

interface PendingExternalBookingContextType {
  /** Store booking context before opening an external URL */
  setPendingBooking: (data: Omit<PendingBookingData, 'timestamp'>) => void;
  /** Clear the pending booking */
  clearPendingBooking: () => void;
  /** Whether there is a pending booking */
  hasPendingBooking: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Auto-expire pending bookings after 10 minutes */
const BOOKING_EXPIRY_MS = 10 * 60 * 1000;

/** Brief settle delay on foreground before showing the confirmation, so any
 *  in-flight sheet/navigation transition can finish first. Kept short so the
 *  prompt feels immediate on return. */
const CONFIRMATION_DELAY_MS = 120;

// =============================================================================
// CONTEXT
// =============================================================================

const PendingExternalBookingContext = createContext<PendingExternalBookingContextType | undefined>(
  undefined
);

// =============================================================================
// PROVIDER
// =============================================================================

interface PendingExternalBookingProviderProps {
  children: ReactNode;
}

export const PendingExternalBookingProvider: React.FC<PendingExternalBookingProviderProps> = ({
  children,
}) => {
  const [pendingBooking, setPendingBookingState] = useState<PendingBookingData | null>(null);

  const { openSheetForMatchCreationFromBooking } = useActionsSheet();
  const { updateSelectedMatch } = useMatchDetailSheet();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const toast = useToast();

  // Track if confirmation is already being shown to prevent duplicates
  const isShowingConfirmation = useRef(false);

  const setPendingBooking = useCallback((data: Omit<PendingBookingData, 'timestamp'>) => {
    // Starting a fresh redirect: clear any leftover "showing" guard from a
    // previous booking that was dismissed without going through confirm/decline.
    isShowingConfirmation.current = false;
    setPendingBookingState({
      ...data,
      timestamp: Date.now(),
    });
  }, []);

  const clearPendingBooking = useCallback(() => {
    setPendingBookingState(null);
    isShowingConfirmation.current = false;
  }, []);

  // ---------------------------------------------------------------------------
  // Match-linked confirmation flow (MatchBookingConfirmationSheet)
  // ---------------------------------------------------------------------------

  // Runs the actual match update. Awaited by the confirmation sheet, which keeps
  // its spinner up until this resolves, then dismisses itself.
  const handleMatchConfirm = useCallback(
    async (booking: PendingBookingData) => {
      const { facility, slot, selectedCourt, matchId, sportId, sportName } = booking;
      if (!matchId) return;

      Analytics.bookingConfirmed({
        facility_id: facility.id,
        sport_id: sportId ?? 'unknown',
        sport_name: sportName ?? 'unknown',
        is_match_linked: true,
      });

      try {
        // Resolve court record (create a local shadow of the external court if needed)
        const externalCourtId = selectedCourt?.externalCourtId || slot.externalCourtId;
        const courtName = selectedCourt?.courtName || slot.courtOptions[0]?.courtName || 'Court';
        let courtId = selectedCourt?.courtId || slot.courtId || '';

        if (externalCourtId && !courtId) {
          try {
            const { court } = await getOrCreateCourt({
              facilityId: facility.id,
              externalProviderId: externalCourtId,
              courtName,
            });
            courtId = court.id;
          } catch (error) {
            Logger.error('Failed to get/create court for booking confirmation', error as Error);
          }
        }

        // Build the update payload. Court identity + status always; cost fields only
        // when we actually know the slot price.
        const payload: Partial<CreateMatchInput> = {
          courtStatus: 'booked',
        };
        if (courtId) payload.courtId = courtId;

        const price = selectedCourt?.price ?? slot.price;
        if (typeof price === 'number') {
          payload.estimatedCost = price;
          payload.isCourtFree = price === 0;
        }

        await updateMatch(matchId, payload);
        void queryClient.invalidateQueries({ queryKey: matchKeys.all });

        const refreshed = await getMatchWithDetails(matchId);
        if (refreshed) {
          updateSelectedMatch(refreshed as MatchDetailData);
        }

        Logger.logUserAction('booking_confirmed_for_existing_match', {
          facilityId: facility.id,
          matchId,
          courtId,
        });
      } catch (error) {
        Logger.error('Failed to update match after booking confirmation', error as Error);
        toast.error(t('matchDetail.bookingConfirmation.error'));
      } finally {
        clearPendingBooking();
      }
    },
    [queryClient, updateSelectedMatch, clearPendingBooking, toast, t]
  );

  const handleMatchDecline = useCallback(
    (booking: PendingBookingData) => {
      Logger.logUserAction('booking_confirmation_declined', {
        facilityId: booking.facility.id,
        matchId: booking.matchId,
      });
      clearPendingBooking();
    },
    [clearPendingBooking]
  );

  // Builds the labelled booking summary rows (court / date / time / price) shown
  // in the confirmation sheet. Each is optional and only renders when known.
  const buildMatchBookingFields = useCallback(
    (booking: PendingBookingData) => {
      const court = booking.selectedCourt;
      const courtLabel = court
        ? court.courtNumber !== undefined && court.courtNumber !== null
          ? t('matchCreation.booking.courtNumber').replace('{number}', String(court.courtNumber))
          : court.courtName
        : undefined;

      const dateLabel = booking.slot.datetime.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });

      const timeLabel = `${booking.slot.time} - ${booking.slot.endTime}`;

      const price = booking.selectedCourt?.price ?? booking.slot.price;
      const priceLabel =
        typeof price === 'number'
          ? price === 0
            ? t('facilityDetail.free')
            : `$${price.toFixed(0)}`
          : undefined;

      return { courtLabel, dateLabel, timeLabel, priceLabel };
    },
    [t]
  );

  // ---------------------------------------------------------------------------
  // Directory-flow confirmation handler (sheet → wizard)
  // ---------------------------------------------------------------------------

  const handleDirectoryConfirm = useCallback(
    async (booking: PendingBookingData) => {
      const { facility, slot, selectedCourt, sportId, sportName } = booking;

      Analytics.bookingConfirmed({
        facility_id: facility.id,
        sport_id: sportId ?? 'unknown',
        sport_name: sportName ?? 'unknown',
        is_match_linked: false,
      });

      const externalCourtId = selectedCourt?.externalCourtId || slot.externalCourtId;
      const courtName = selectedCourt?.courtName || slot.courtOptions[0]?.courtName || 'Court';
      const price = selectedCourt?.price ?? slot.price;

      let courtId = selectedCourt?.courtId || slot.courtId || '';
      let courtNumber: number | null = null;

      if (externalCourtId && !courtId) {
        try {
          const { court } = await getOrCreateCourt({
            facilityId: facility.id,
            externalProviderId: externalCourtId,
            courtName,
          });
          courtId = court.id;
          courtNumber = court.court_number ?? null;
        } catch (error) {
          Logger.error('Failed to get/create court for booking confirmation', error as Error);
        }
      }

      openSheetForMatchCreationFromBooking({
        facility,
        slot: { datetime: slot.datetime, endDateTime: slot.endDateTime },
        facilityId: facility.id,
        courtId,
        courtNumber,
        price,
      });

      Logger.logUserAction('booking_confirmation_accepted', {
        facilityId: facility.id,
        facilityName: facility.name,
      });

      clearPendingBooking();
    },
    [openSheetForMatchCreationFromBooking, clearPendingBooking]
  );

  // ---------------------------------------------------------------------------
  // Listen for app returning to foreground
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState !== 'active' || !pendingBooking || isShowingConfirmation.current) {
        return;
      }

      if (Date.now() - pendingBooking.timestamp > BOOKING_EXPIRY_MS) {
        clearPendingBooking();
        return;
      }

      // Brief settle delay so any pending sheet transitions complete before we show UI
      setTimeout(() => {
        if (isShowingConfirmation.current) return;
        isShowingConfirmation.current = true;

        // Match-linked flow: show a stacked confirmation sheet ON TOP of the
        // still-open match-detail sheet. This must be a SheetManager sheet, not a
        // React Native <Modal> — a <Modal> renders *behind* the actions sheet and
        // silently blocks touches (the app appears frozen until the sheet closes).
        if (pendingBooking.matchId) {
          const booking = pendingBooking;
          void SheetManager.show('match-booking-confirmation', {
            payload: {
              facilityName: booking.facility.name,
              ...buildMatchBookingFields(booking),
              onConfirm: () => handleMatchConfirm(booking),
              onDecline: () => handleMatchDecline(booking),
              // Reset on any close (swipe / backdrop) so the next redirect can
              // re-open the sheet instead of being blocked by a stuck guard.
              onDismiss: () => clearPendingBooking(),
            },
          });
          return;
        }

        // Directory flow: existing sheet + wizard.
        const { facility, slot } = pendingBooking;
        const slotDate = slot.datetime.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        });

        void SheetManager.show('booking-confirmation', {
          payload: {
            facilityName: facility.name,
            slotTime: `${slot.time} - ${slot.endTime}`,
            slotDate,
            onConfirm: () => {
              void handleDirectoryConfirm(pendingBooking);
            },
            onDecline: () => {
              Logger.logUserAction('booking_confirmation_declined', {
                facilityId: facility.id,
              });
              clearPendingBooking();
            },
          },
        });
      }, CONFIRMATION_DELAY_MS);
    });

    return () => subscription.remove();
  }, [
    pendingBooking,
    handleDirectoryConfirm,
    handleMatchConfirm,
    handleMatchDecline,
    buildMatchBookingFields,
    clearPendingBooking,
  ]);

  const contextValue: PendingExternalBookingContextType = {
    setPendingBooking,
    clearPendingBooking,
    hasPendingBooking: pendingBooking !== null,
  };

  return (
    <PendingExternalBookingContext.Provider value={contextValue}>
      {children}
    </PendingExternalBookingContext.Provider>
  );
};

// =============================================================================
// HOOK
// =============================================================================

export const usePendingExternalBooking = (): PendingExternalBookingContextType => {
  const context = useContext(PendingExternalBookingContext);
  if (context === undefined) {
    throw new Error(
      'usePendingExternalBooking must be used within a PendingExternalBookingProvider'
    );
  }
  return context;
};
