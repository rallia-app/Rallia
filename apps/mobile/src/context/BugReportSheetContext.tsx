/**
 * Feedback Report Sheet Context
 *
 * Provides global control over the feedback report action sheet.
 * Can be triggered via shake gesture, FAB, or settings menu.
 */

import React, { createContext, useContext, useCallback, useState, ReactNode } from 'react';
import { SheetManager } from 'react-native-actions-sheet';

import { useProfile } from '@rallia/shared-hooks';

import { useAuth } from '../hooks/useAuth';
import { useActionsSheet } from './ActionsSheetContext';

// =============================================================================
// TYPES
// =============================================================================

export type FeedbackReportTrigger = 'shake' | 'help_menu' | 'settings' | 'fab';

interface FeedbackReportSheetContextType {
  /** Open the feedback report sheet */
  openFeedbackReport: (trigger?: FeedbackReportTrigger) => void;

  /** Close the feedback report sheet */
  closeFeedbackReport: () => void;

  /** Whether the sheet is currently open */
  isOpen: boolean;

  /** How the sheet was triggered (for analytics) */
  trigger: FeedbackReportTrigger | null;
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
  const [isOpen, setIsOpen] = useState(false);
  const [trigger, setTrigger] = useState<FeedbackReportTrigger | null>(null);
  const { session } = useAuth();
  const { profile } = useProfile();
  const { openSheet } = useActionsSheet();

  /**
   * Open the feedback report sheet.
   * Guards: requires signed-in + onboarded user.
   * If not ready, opens the actions sheet (sign-in / onboarding) instead.
   */
  const openFeedbackReport = useCallback(
    (triggerSource: FeedbackReportTrigger = 'help_menu') => {
      const isSignedIn = Boolean(session?.user);
      const isOnboarded = Boolean(profile?.onboarding_completed);

      if (!isSignedIn || !isOnboarded) {
        openSheet();
        return;
      }

      setTrigger(triggerSource);
      setIsOpen(true);
      SheetManager.show('feedback-report', {
        payload: { trigger: triggerSource },
        onClose: () => {
          setIsOpen(false);
          setTrigger(null);
        },
      });
    },
    [session?.user, profile?.onboarding_completed, openSheet]
  );

  /**
   * Close the feedback report sheet
   */
  const closeFeedbackReport = useCallback(() => {
    SheetManager.hide('feedback-report');
  }, []);

  const contextValue: FeedbackReportSheetContextType = {
    openFeedbackReport,
    closeFeedbackReport,
    isOpen,
    trigger,
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
