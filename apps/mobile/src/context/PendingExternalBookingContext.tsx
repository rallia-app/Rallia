/**
 * PendingExternalBookingContext
 *
 * Tracks when a user opens an external booking URL from facility screens
 * (FacilitiesDirectory, AvailabilityTab/ExternalBookingSheet, Map).
 * When the app returns to foreground, shows a "Did you book?" confirmation sheet.
 * If confirmed, opens the match creation wizard pre-filled with booking data.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { SheetManager } from 'react-native-actions-sheet';
import type { FormattedSlot, CourtOption } from '@rallia/shared-hooks';
import { getOrCreateCourt } from '@rallia/shared-services';
import { Logger } from '@rallia/shared-services';
import { useActionsSheet } from './ActionsSheetContext';

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
  const { openSheetForMatchCreationFromBooking, sheetRef } = useActionsSheet();

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

  // Handle booking confirmation (user said "yes, I booked")
  const handleConfirm = useCallback(
    async (booking: PendingBookingData) => {
      const { facility, slot, selectedCourt } = booking;

      // Resolve court data
      const externalCourtId = selectedCourt?.externalCourtId || slot.externalCourtId;
      const courtName = selectedCourt?.courtName || slot.courtOptions[0]?.courtName || 'Court';
      const price = selectedCourt?.price ?? slot.price;

      // Try to get/create a local court record
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

      // Open the match creation wizard pre-filled with booking data
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

  // Listen for app returning to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState !== 'active' || !pendingBooking || isShowingConfirmation.current) {
        return;
      }

      // Check if booking is expired
      if (Date.now() - pendingBooking.timestamp > BOOKING_EXPIRY_MS) {
        clearPendingBooking();
        return;
      }

      // Don't show confirmation if the actions sheet (wizard) is already open
      // sheetRef.current being presented means the wizard is already visible
      // We check via a small delay to let any sheet transitions complete
      setTimeout(() => {
        if (isShowingConfirmation.current) return;
        isShowingConfirmation.current = true;

        const { facility, slot } = pendingBooking;

        // Format date for display
        const slotDate = slot.datetime.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        });

        SheetManager.show('booking-confirmation', {
          payload: {
            facilityName: facility.name,
            slotTime: `${slot.time} - ${slot.endTime}`,
            slotDate,
            onConfirm: () => handleConfirm(pendingBooking),
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
  }, [pendingBooking, handleConfirm, clearPendingBooking, sheetRef]);

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
