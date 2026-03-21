/**
 * Feedback Report Sheet Context
 *
 * Provides global control over the feedback report bottom sheet.
 * Can be triggered via shake gesture, FAB, or settings menu.
 */

import React, { createContext, useContext, useRef, useCallback, useState, ReactNode } from 'react';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';

// =============================================================================
// TYPES
// =============================================================================

export type FeedbackReportTrigger = 'shake' | 'help_menu' | 'settings' | 'fab';

interface FeedbackReportSheetContextType {
  /** Open the feedback report sheet */
  openFeedbackReport: (trigger?: FeedbackReportTrigger) => void;

  /** Close the feedback report sheet */
  closeFeedbackReport: () => void;

  /** Called when the sheet finishes dismissing (resets isOpen state) */
  onSheetDismiss: () => void;

  /** Whether the sheet is currently open */
  isOpen: boolean;

  /** How the sheet was triggered (for analytics) */
  trigger: FeedbackReportTrigger | null;

  /** Reference to the bottom sheet for direct control if needed */
  sheetRef: React.RefObject<BottomSheetModal | null>;
}

// =============================================================================
// CONTEXT
// =============================================================================

const FeedbackReportSheetContext = createContext<FeedbackReportSheetContextType | undefined>(
  undefined
);

// =============================================================================
// PROVIDER
// =============================================================================

interface FeedbackReportSheetProviderProps {
  children: ReactNode;
}

export const FeedbackReportSheetProvider: React.FC<FeedbackReportSheetProviderProps> = ({
  children,
}) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [trigger, setTrigger] = useState<FeedbackReportTrigger | null>(null);

  /**
   * Open the feedback report sheet
   */
  const openFeedbackReport = useCallback((triggerSource: FeedbackReportTrigger = 'help_menu') => {
    setTrigger(triggerSource);
    setIsOpen(true);
    sheetRef.current?.present();
  }, []);

  /**
   * Close the feedback report sheet
   */
  const closeFeedbackReport = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  /**
   * Called when the sheet finishes its dismiss animation.
   * This reliably resets open state regardless of how the sheet was closed
   * (swipe down, submit, cancel button, etc.).
   */
  const onSheetDismiss = useCallback(() => {
    setIsOpen(false);
    setTrigger(null);
  }, []);

  const contextValue: FeedbackReportSheetContextType = {
    openFeedbackReport,
    closeFeedbackReport,
    onSheetDismiss,
    isOpen,
    trigger,
    sheetRef,
  };

  return (
    <FeedbackReportSheetContext.Provider value={contextValue}>
      {children}
    </FeedbackReportSheetContext.Provider>
  );
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access the feedback report sheet context
 */
export const useFeedbackReportSheet = (): FeedbackReportSheetContextType => {
  const context = useContext(FeedbackReportSheetContext);
  if (!context) {
    throw new Error('useFeedbackReportSheet must be used within a FeedbackReportSheetProvider');
  }
  return context;
};
