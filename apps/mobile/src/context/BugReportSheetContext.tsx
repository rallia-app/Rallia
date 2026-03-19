/**
 * Bug Report Sheet Context
 *
 * Provides global control over the quick bug report bottom sheet.
 * Can be triggered via shake gesture or help menu.
 */

import React, { createContext, useContext, useRef, useCallback, useState, ReactNode } from 'react';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';

// =============================================================================
// TYPES
// =============================================================================

export type BugReportTrigger = 'shake' | 'help_menu' | 'settings' | 'fab';

interface BugReportSheetContextType {
  /** Open the bug report sheet */
  openBugReport: (trigger?: BugReportTrigger) => void;

  /** Close the bug report sheet */
  closeBugReport: () => void;

  /** Called when the sheet finishes dismissing (resets isOpen state) */
  onSheetDismiss: () => void;

  /** Whether the sheet is currently open */
  isOpen: boolean;

  /** How the sheet was triggered (for analytics) */
  trigger: BugReportTrigger | null;

  /** Reference to the bottom sheet for direct control if needed */
  sheetRef: React.RefObject<BottomSheetModal | null>;
}

// =============================================================================
// CONTEXT
// =============================================================================

const BugReportSheetContext = createContext<BugReportSheetContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface BugReportSheetProviderProps {
  children: ReactNode;
}

export const BugReportSheetProvider: React.FC<BugReportSheetProviderProps> = ({ children }) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [trigger, setTrigger] = useState<BugReportTrigger | null>(null);

  /**
   * Open the bug report sheet
   */
  const openBugReport = useCallback((triggerSource: BugReportTrigger = 'help_menu') => {
    setTrigger(triggerSource);
    setIsOpen(true);
    sheetRef.current?.present();
  }, []);

  /**
   * Close the bug report sheet
   */
  const closeBugReport = useCallback(() => {
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

  const contextValue: BugReportSheetContextType = {
    openBugReport,
    closeBugReport,
    onSheetDismiss,
    isOpen,
    trigger,
    sheetRef,
  };

  return (
    <BugReportSheetContext.Provider value={contextValue}>{children}</BugReportSheetContext.Provider>
  );
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access the bug report sheet context
 */
export const useBugReportSheet = (): BugReportSheetContextType => {
  const context = useContext(BugReportSheetContext);
  if (!context) {
    throw new Error('useBugReportSheet must be used within a BugReportSheetProvider');
  }
  return context;
};
