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
 *    matchId is attached. On return we show a lightweight ConfirmationModal;
 *    confirming updates the existing match (court_id, court_status, and — when
 *    we know the slot price — estimated_cost / is_court_free) and re-renders
 *    the already-open match detail sheet in place.
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

import { ConfirmationModal } from '../components/ConfirmationModal';
import { useTranslation } from '../hooks/useTranslation';
import * as Analytics from '../services/analytics';

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
  // The match-linked confirmation modal is rendered inline by this provider. We
  // snapshot the booking into its own state so the modal's content stays stable
  // while we clear `pendingBooking` on confirm/decline.
  const [matchConfirmBooking, setMatchConfirmBooking] = useState<PendingBookingData | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const { openSheetForMatchCreationFromBooking } = useActionsSheet();
  const { updateSelectedMatch } = useMatchDetailSheet();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const toast = useToast();

  // Track if confirmation is already being shown to prevent duplicates
  const isShowingConfirmation = useRef(false);

  const setPendingBooking = useCallback((data: Omit<PendingBookingData, 'timestamp'>) => {
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
  // Match-linked confirmation flow (ConfirmationModal)
  // ---------------------------------------------------------------------------

  const handleMatchConfirm = useCallback(async () => {
    if (!matchConfirmBooking || isConfirming) return;
    const { facility, slot, selectedCourt, matchId, sportId, sportName } = matchConfirmBooking;
    if (!matchId) return;

    Analytics.bookingConfirmed({
      facility_id: facility.id,
      sport_id: sportId ?? 'unknown',
      sport_name: sportName ?? 'unknown',
      is_match_linked: true,
    });

    setIsConfirming(true);

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

      setMatchConfirmBooking(null);
      clearPendingBooking();
    } catch (error) {
      Logger.error('Failed to update match after booking confirmation', error as Error);
      toast.error(t('matchDetail.bookingConfirmation.error'));
      setMatchConfirmBooking(null);
      clearPendingBooking();
    } finally {
      setIsConfirming(false);
    }
  }, [
    matchConfirmBooking,
    isConfirming,
    queryClient,
    updateSelectedMatch,
    clearPendingBooking,
    toast,
    t,
  ]);

  const handleMatchDecline = useCallback(() => {
    if (isConfirming) return;
    if (matchConfirmBooking) {
      Logger.logUserAction('booking_confirmation_declined', {
        facilityId: matchConfirmBooking.facility.id,
        matchId: matchConfirmBooking.matchId,
      });
    }
    setMatchConfirmBooking(null);
    clearPendingBooking();
  }, [isConfirming, matchConfirmBooking, clearPendingBooking]);

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

      // Small delay so any pending sheet transitions complete before we show UI
      setTimeout(() => {
        if (isShowingConfirmation.current) return;
        isShowingConfirmation.current = true;

        // Match-linked flow: show the inline ConfirmationModal.
        if (pendingBooking.matchId) {
          setMatchConfirmBooking(pendingBooking);
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
      }, 500);
    });

    return () => subscription.remove();
  }, [pendingBooking, handleDirectoryConfirm, clearPendingBooking]);

  const contextValue: PendingExternalBookingContextType = {
    setPendingBooking,
    clearPendingBooking,
    hasPendingBooking: pendingBooking !== null,
  };

  // Build modal body info string (facility • court • date • time range)
  const matchModalAdditionalInfo = matchConfirmBooking
    ? (() => {
        const court = matchConfirmBooking.selectedCourt;
        const courtLabel = court
          ? court.courtNumber !== undefined && court.courtNumber !== null
            ? t('matchCreation.booking.courtNumber').replace('{number}', String(court.courtNumber))
            : court.courtName
          : null;
        return [
          matchConfirmBooking.facility.name,
          courtLabel,
          matchConfirmBooking.slot.datetime.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          }),
          `${matchConfirmBooking.slot.time} - ${matchConfirmBooking.slot.endTime}`,
        ]
          .filter(Boolean)
          .join(' • ');
      })()
    : undefined;

  return (
    <PendingExternalBookingContext.Provider value={contextValue}>
      {children}
      <ConfirmationModal
        visible={!!matchConfirmBooking}
        onClose={handleMatchDecline}
        onConfirm={() => {
          void handleMatchConfirm();
        }}
        title={t('booking.confirmation.title')}
        message={t('matchDetail.bookingConfirmation.message')}
        additionalInfo={matchModalAdditionalInfo}
        confirmLabel={t('matchDetail.bookingConfirmation.confirm')}
        cancelLabel={t('matchDetail.bookingConfirmation.decline')}
        isLoading={isConfirming}
      />
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
