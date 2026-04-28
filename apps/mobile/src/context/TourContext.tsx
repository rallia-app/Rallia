/**
 * TourContext - Interactive User Guide/Walkthrough Management
 *
 * This context provides the tour/walkthrough functionality using react-native-copilot.
 * It handles:
 * - Tour state management (active, step, progress)
 * - Tour completion persistence
 * - Resetting and restarting tours
 * - Styling that matches Rallia's design system
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { CopilotProvider, CopilotStep, walkthroughable, useCopilot } from 'react-native-copilot';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  InteractionManager,
} from 'react-native';
import { useTranslation } from '../hooks';
import { useThemeStyles } from '@rallia/shared-hooks';
import { tourService, TourId, TourStatus } from '@rallia/shared-services';
import { Logger } from '@rallia/shared-services';
import { lightHaptic, selectionHaptic, successHaptic } from '../utils/haptics';

// =============================================================================
// TYPES
// =============================================================================

export interface TourContextType {
  /** Start a specific tour */
  startTour: (tourId: TourId) => Promise<void>;
  /** Stop the current tour */
  stopTour: () => void;
  /** Check if a tour has been completed */
  isTourCompleted: (tourId: TourId) => boolean;
  /** Mark a tour as completed */
  completeTour: (tourId: TourId) => Promise<void>;
  /** Reset a specific tour (mark as not completed) */
  resetTour: (tourId: TourId) => Promise<void>;
  /** Reset all tours */
  resetAllTours: () => Promise<void>;
  /** Current active tour ID */
  activeTourId: TourId | null;
  /** Whether any tour is currently active */
  isTourActive: boolean;
  /** Tour status for all tours */
  tourStatus: TourStatus;
  /** Whether tour data is loading */
  isLoading: boolean;
  /** Whether to show the tour completion modal */
  showCompletionModal: boolean;
  /** Dismiss the completion modal */
  dismissCompletionModal: () => void;
  /** The ID of the last completed tour (for completion modal) */
  lastCompletedTourId: TourId | null;
}

// =============================================================================
// CONTEXT
// =============================================================================

const TourContext = createContext<TourContextType | undefined>(undefined);

// =============================================================================
// CUSTOM TOOLTIP COMPONENT
// =============================================================================

interface TooltipProps {
  labels: {
    skip?: string;
    previous?: string;
    next?: string;
    finish?: string;
  };
}

const CustomTooltip: React.FC<TooltipProps> = ({ labels }) => {
  const { t } = useTranslation();
  const { colors } = useThemeStyles();
  const {
    goToNext,
    goToPrev,
    stop,
    currentStep,
    isFirstStep,
    isLastStep,
    currentStepNumber,
    totalStepsNumber,
  } = useCopilot();

  // Get translated labels (fallback to provided labels or defaults)
  const skipLabel = t('tour.buttons.skip') || labels?.skip || 'Skip';
  const previousLabel = t('tour.buttons.previous') || labels?.previous || 'Previous';
  const nextLabel = t('tour.buttons.next') || labels?.next || 'Next';
  const finishLabel = t('tour.buttons.finish') || labels?.finish || 'Finish';

  const handleNext = async () => {
    // Subtle tick on every step advance; success notification on the final tap.
    if (isLastStep) {
      successHaptic();
    } else {
      selectionHaptic();
    }
    try {
      await goToNext();
    } catch (error) {
      Logger.error('Tour goToNext failed', error as Error);
    }
  };

  const handlePrev = async () => {
    selectionHaptic();
    try {
      await goToPrev();
    } catch (error) {
      Logger.error('Tour goToPrev failed', error as Error);
    }
  };

  const handleStop = async () => {
    // The same handler is used for "Skip" (first step) and "Finish" (last step).
    if (isLastStep) {
      successHaptic();
    } else {
      lightHaptic();
    }
    try {
      await stop();
    } catch (error) {
      Logger.error('Tour stop failed', error as Error);
    }
  };

  return (
    <View style={[tooltipStyles.container, { backgroundColor: colors.cardBackground }]}>
      {/* Step content */}
      <Text style={[tooltipStyles.text, { color: colors.text }]}>{currentStep?.text || ''}</Text>

      {/* Navigation buttons */}
      <View style={tooltipStyles.buttonContainer}>
        {/* Skip button (only on first step) */}
        {isFirstStep && (
          <TouchableOpacity
            onPress={handleStop}
            style={[tooltipStyles.skipButton, { backgroundColor: colors.buttonInactive }]}
            accessibilityLabel={skipLabel}
            accessibilityRole="button"
          >
            <Text style={[tooltipStyles.skipButtonText, { color: colors.textSecondary }]}>
              {skipLabel}
            </Text>
          </TouchableOpacity>
        )}

        {/* Previous button (not on first step) */}
        {!isFirstStep && (
          <TouchableOpacity
            onPress={handlePrev}
            style={[tooltipStyles.prevButton, { backgroundColor: colors.buttonInactive }]}
            accessibilityLabel={previousLabel}
            accessibilityRole="button"
          >
            <Text style={[tooltipStyles.prevButtonText, { color: colors.textSecondary }]}>
              {previousLabel}
            </Text>
          </TouchableOpacity>
        )}

        {/* Spacer */}
        <View style={tooltipStyles.spacer} />

        {/* Next/Finish button */}
        <TouchableOpacity
          onPress={isLastStep ? handleStop : handleNext}
          style={[tooltipStyles.nextButton, { backgroundColor: colors.primary }]}
          accessibilityLabel={isLastStep ? finishLabel : nextLabel}
          accessibilityRole="button"
        >
          <Text style={[tooltipStyles.nextButtonText, { color: colors.primaryForeground }]}>
            {isLastStep ? finishLabel : nextLabel}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Step indicator */}
      {currentStep && (
        <Text style={[tooltipStyles.stepIndicator, { color: colors.textMuted }]}>
          {t('tour.stepIndicator', { current: currentStepNumber, total: totalStepsNumber })}
        </Text>
      )}
    </View>
  );
};

const tooltipStyles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    maxWidth: 320,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  skipButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  skipButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  prevButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  prevButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  spacer: {
    flex: 1,
  },
  nextButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  nextButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  stepIndicator: {
    marginTop: 12,
    fontSize: 12,
    textAlign: 'center',
  },
});

// =============================================================================
// TOUR PROVIDER INNER COMPONENT
// =============================================================================

interface TourProviderInnerProps {
  children: ReactNode;
}

const TourProviderInner: React.FC<TourProviderInnerProps> = ({ children }) => {
  const { start, stop, visible } = useCopilot();
  const [activeTourId, setActiveTourId] = useState<TourId | null>(null);
  const [tourStatus, setTourStatus] = useState<TourStatus>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [lastCompletedTourId, setLastCompletedTourId] = useState<TourId | null>(null);
  // Track if tour was skipped (stopped early) vs completed naturally
  const [wasSkipped, setWasSkipped] = useState(false);
  // Track if tour has actually started (was visible at least once)
  const [tourHasStarted, setTourHasStarted] = useState(false);

  // Store visible in ref to prevent causing re-renders in context consumers
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // Load tour status on mount
  useEffect(() => {
    const loadTourStatus = async () => {
      try {
        const status = await tourService.getAllTourStatus();
        setTourStatus(status);
      } catch (error) {
        Logger.error('Failed to load tour status', error as Error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTourStatus();
  }, []);

  // Start a specific tour
  const startTour = useCallback(
    async (tourId: TourId) => {
      try {
        Logger.logUserAction('tour_started', { tourId });
        setActiveTourId(tourId);
        setWasSkipped(false); // Reset skip flag when starting new tour
        setTourHasStarted(false); // Reset - will be set to true when visible becomes true

        // Use InteractionManager to wait for all interactions/animations to complete
        // Then add additional delay for layout stabilization across different devices
        // This ensures all CopilotStep elements have been properly laid out and measured
        InteractionManager.runAfterInteractions(() => {
          // Additional delay for slower devices to complete layout
          setTimeout(() => {
            // Request animation frame to ensure we're in sync with the render cycle
            requestAnimationFrame(() => {
              start();
            });
          }, 300);
        });
      } catch (error) {
        Logger.error('Failed to start tour', error as Error, { tourId });
      }
    },
    [start]
  );

  // Stop the current tour (user skipped)
  const stopTour = useCallback(() => {
    Logger.logUserAction('tour_stopped', { tourId: activeTourId });
    setWasSkipped(true); // Mark as skipped so we don't show completion modal
    stop();
    setActiveTourId(null);
  }, [stop, activeTourId]);

  // Dismiss the completion modal
  const dismissCompletionModal = useCallback(() => {
    setShowCompletionModal(false);
    setLastCompletedTourId(null);
  }, []);

  // Store tourStatus in a ref for stable function references
  const tourStatusRef = useRef(tourStatus);
  useEffect(() => {
    tourStatusRef.current = tourStatus;
  }, [tourStatus]);

  // Check if a tour has been completed - use ref for stability
  const isTourCompleted = useCallback(
    (tourId: TourId) => {
      return tourStatusRef.current[tourId] === true;
    },
    [] // No dependencies - uses ref
  );

  // Mark a tour as completed
  const completeTour = useCallback(async (tourId: TourId) => {
    try {
      await tourService.setTourCompleted(tourId, true);
      setTourStatus(prev => ({ ...prev, [tourId]: true }));
      Logger.logUserAction('tour_completed', { tourId });
    } catch (error) {
      Logger.error('Failed to complete tour', error as Error, { tourId });
    }
  }, []);

  // Reset a specific tour
  const resetTour = useCallback(async (tourId: TourId) => {
    try {
      await tourService.setTourCompleted(tourId, false);
      setTourStatus(prev => ({ ...prev, [tourId]: false }));
      Logger.logUserAction('tour_reset', { tourId });
    } catch (error) {
      Logger.error('Failed to reset tour', error as Error, { tourId });
    }
  }, []);

  // Reset all tours
  const resetAllTours = useCallback(async () => {
    try {
      await tourService.resetAllTours();
      setTourStatus({});
      Logger.logUserAction('all_tours_reset', {});
    } catch (error) {
      Logger.error('Failed to reset all tours', error as Error);
    }
  }, []);

  // Ref to track if we're processing tour completion to prevent loops
  const isProcessingCompletionRef = useRef(false);
  // Ref to track tourHasStarted to avoid dependency loop
  const tourHasStartedRef = useRef(tourHasStarted);
  tourHasStartedRef.current = tourHasStarted;

  // Ref to store completeTour to avoid dependency issues
  const completeTourRef = useRef(completeTour);
  useEffect(() => {
    completeTourRef.current = completeTour;
  }, [completeTour]);

  // Track when tour actually becomes visible (has started)
  // Using ref to check tourHasStarted to avoid dependency loop
  useEffect(() => {
    if (visible && activeTourId && !tourHasStartedRef.current) {
      setTourHasStarted(true);
      Logger.logUserAction('tour_visible', { tourId: activeTourId });
    }
  }, [visible, activeTourId]); // Removed tourHasStarted from deps - using ref instead

  // Handle tour completion when it ends naturally
  // Only triggers when: tour was visible, then became not visible, and tour had actually started
  useEffect(() => {
    // Prevent re-entry
    if (isProcessingCompletionRef.current) return;

    if (!visible && activeTourId && tourHasStartedRef.current) {
      isProcessingCompletionRef.current = true;

      // Tour ended after being shown, mark as completed
      completeTourRef.current(activeTourId);

      // Show completion modal only for main_navigation tour and only if not skipped
      if (activeTourId === 'main_navigation' && !wasSkipped) {
        setLastCompletedTourId(activeTourId);
        setShowCompletionModal(true);
      }

      setActiveTourId(null);
      setWasSkipped(false);
      setTourHasStarted(false);

      // Reset the flag after state updates have been processed
      setTimeout(() => {
        isProcessingCompletionRef.current = false;
      }, 0);
    }
  }, [visible, activeTourId, wasSkipped]); // Removed tourHasStarted from deps - using ref instead

  const contextValue = useMemo<TourContextType>(
    () => ({
      startTour,
      stopTour,
      isTourCompleted,
      completeTour,
      resetTour,
      resetAllTours,
      activeTourId,
      isTourActive: visible,
      tourStatus,
      isLoading,
      showCompletionModal,
      dismissCompletionModal,
      lastCompletedTourId,
    }),
    [
      startTour,
      stopTour,
      isTourCompleted,
      completeTour,
      resetTour,
      resetAllTours,
      activeTourId,
      visible,
      tourStatus,
      isLoading,
      showCompletionModal,
      dismissCompletionModal,
      lastCompletedTourId,
    ]
  );

  return <TourContext.Provider value={contextValue}>{children}</TourContext.Provider>;
};

// =============================================================================
// TOUR PROVIDER (WRAPPER WITH COPILOT)
// =============================================================================

interface TourProviderProps {
  children: ReactNode;
}

/**
 * SVG path for the spotlight cutout: full-canvas outer rect with a rounded-rect
 * hole around the highlighted element. We inflate the measured rect by `pad` so
 * tightly-measured targets (tab icons, header buttons) get a comfortable halo
 * instead of cropping flush to the content.
 */
const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 14;

// react-native-copilot's TS type claims Animated.ValueXY for size/position/canvasSize,
// but at runtime it actually passes plain `{x: number, y: number}`. We accept either.
const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const maybeAnim = v as { __getValue?: () => number; _value?: number };
    if (typeof maybeAnim.__getValue === 'function') return maybeAnim.__getValue();
    if (typeof maybeAnim._value === 'number') return maybeAnim._value;
  }
  return 0;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildSpotlightPath = (args: any): string => {
  const { size, position, canvasSize, step } = args;
  const px = num(position?.x);
  const py = num(position?.y);
  const sx = num(size?.x);
  const sy = num(size?.y);
  const cx = num(canvasSize?.x);
  const cy = num(canvasSize?.y);

  // Bottom-tab icons are wrapped tightly around the glyph but the tab cell also
  // reserves space below for the label. Without compensation, the spotlight sits
  // at the icon's vertical center and reads as "too high" relative to the tab
  // slot. Shift it downward by reducing top pad and adding bottom pad.
  const stepName: string | undefined = step?.name;
  const isTabStep = typeof stepName === 'string' && stepName.endsWith('-tab');
  const padTop = isTabStep ? 2 : SPOTLIGHT_PADDING;
  const padBottom = isTabStep ? 18 : SPOTLIGHT_PADDING;
  const padX = SPOTLIGHT_PADDING;

  const x = px - padX;
  const y = py - padTop;
  const w = sx + padX * 2;
  const h = sy + padTop + padBottom;
  const r = Math.max(0, Math.min(SPOTLIGHT_RADIUS, w / 2, h / 2));
  // Outer canvas rect (even-odd / non-zero fill rule -> hole), then rounded cutout.
  return (
    `M0,0 H${cx} V${cy} H0 V0 Z ` +
    `M${x + r},${y} ` +
    `h${w - 2 * r} ` +
    `a${r},${r} 0 0 1 ${r},${r} ` +
    `v${h - 2 * r} ` +
    `a${r},${r} 0 0 1 -${r},${r} ` +
    `h-${w - 2 * r} ` +
    `a${r},${r} 0 0 1 -${r},-${r} ` +
    `v-${h - 2 * r} ` +
    `a${r},${r} 0 0 1 ${r},-${r} Z`
  );
};

export const TourProvider: React.FC<TourProviderProps> = ({ children }) => {
  const { colors } = useThemeStyles();

  // With `androidStatusBarVisible={true}` and expo-status-bar (translucent by
  // default), the Copilot Modal and `measure()` share the same coordinate
  // origin (top of the window, including the status bar area on Android), so
  // no manual offset is needed on either platform.
  return (
    <CopilotProvider
      tooltipComponent={CustomTooltip}
      stepNumberComponent={() => null} // We handle step numbers in the tooltip
      animated
      overlay="svg"
      androidStatusBarVisible={true}
      verticalOffset={0}
      arrowColor={colors.cardBackground}
      backdropColor="rgba(0, 0, 0, 0.7)"
      svgMaskPath={buildSpotlightPath}
      // Copilot wraps the tooltipComponent in its own card. We render the card
      // ourselves inside CustomTooltip so the wrapper has to be a transparent
      // passthrough — otherwise we get a stale white card behind the themed one.
      tooltipStyle={{
        backgroundColor: 'transparent',
        padding: 0,
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
        borderRadius: 16,
      }}
      stopOnOutsideClick={false}
    >
      <TourProviderInner>{children}</TourProviderInner>
    </CopilotProvider>
  );
};

// =============================================================================
// HOOK
// =============================================================================

export const useTour = (): TourContextType => {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error('useTour must be used within a TourProvider');
  }
  return context;
};

// =============================================================================
// RE-EXPORT COPILOT COMPONENTS FOR CONVENIENCE
// =============================================================================

export { CopilotStep, walkthroughable };

/**
 * Create walkthroughable View with collapsable={false} for reliable Android measurement.
 * The collapsable prop prevents Android from optimizing away view groups which can affect
 * the accuracy of measure() calls used by react-native-copilot.
 *
 * We wrap the native View to always include collapsable={false}.
 */
const CollapsableView = React.forwardRef<View, React.ComponentProps<typeof View>>((props, ref) => (
  <View {...props} ref={ref} collapsable={false} />
));
CollapsableView.displayName = 'CollapsableView';

// Create walkthroughable components
// Note: TouchableOpacity doesn't need collapsable since it's already a native view
export const WalkthroughableView = walkthroughable(CollapsableView);
export const WalkthroughableText = walkthroughable(Text);
export const WalkthroughableTouchableOpacity = walkthroughable(TouchableOpacity);
