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
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '@rallia/shared-hooks';
import { tourService, TourId, TourStatus, Logger } from '@rallia/shared-services';

// Direct import to avoid the hooks→useTourSequence→TourContext→hooks cycle.
import { useTranslation, type TranslationKey } from '#/hooks/useTranslation';
import { lightHaptic, selectionHaptic, successHaptic } from '#/utils/haptics';
import { runWhenIdle } from '#/utils/runWhenIdle';

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
  /** Reset welcome sheet + main navigation tour so the welcome sheet can show again */
  restartWelcomeTour: () => Promise<void>;
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

// Per-step header: a title + icon keyed by the CopilotStep `name`. Unknown steps
// fall back to description-only (no header), so screen tours degrade gracefully.
const STEP_META: Record<
  string,
  { titleKey: TranslationKey; icon: keyof typeof Ionicons.glyphMap }
> = {
  'home-tab': { titleKey: 'navigation.matches', icon: 'home' },
  'courts-tab': { titleKey: 'tour.mainNavigation.courts.title', icon: 'location' },
  'actions-tab': { titleKey: 'tour.mainNavigation.actions.title', icon: 'add-circle' },
  'community-tab': { titleKey: 'tour.mainNavigation.community.title', icon: 'people' },
  'chat-tab': { titleKey: 'tour.mainNavigation.chat.title', icon: 'chatbubbles' },
  'header-profile': { titleKey: 'tour.header.profile.title', icon: 'person-circle' },
  'header-sport-toggle': { titleKey: 'tour.header.sportToggle.title', icon: 'swap-horizontal' },
  'header-actions': { titleKey: 'tour.header.actions.title', icon: 'notifications' },
  home_my_matches: { titleKey: 'tour.homeScreen.upcomingMatches.title', icon: 'calendar' },
  profile_picture: { titleKey: 'tour.profileScreen.picture.title', icon: 'camera' },
  my_sports: { titleKey: 'tour.profileScreen.sports.title', icon: 'stats-chart' },
  my_availability: { titleKey: 'tour.profileScreen.availability.title', icon: 'time' },
  chat_search: { titleKey: 'tour.chatScreen.search.title', icon: 'search' },
  chat_filters: { titleKey: 'tour.chatScreen.filters.title', icon: 'filter' },
};

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

  const stepName = currentStep?.name;
  const meta = stepName ? STEP_META[stepName] : undefined;
  const tintedPrimaryBg = `${colors.primary}26`; // ~15% alpha tint for the icon ring

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
    // Used by the always-present close (✕) and by "Finish" on the last step.
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
      {/* Header: icon + title, with an always-available close */}
      <View style={tooltipStyles.header}>
        <View style={tooltipStyles.titleRow}>
          {meta && (
            <>
              <View style={[tooltipStyles.iconCircle, { backgroundColor: tintedPrimaryBg }]}>
                <Ionicons name={meta.icon} size={18} color={colors.primary} />
              </View>
              <Text style={[tooltipStyles.title, { color: colors.text }]} numberOfLines={1}>
                {t(meta.titleKey)}
              </Text>
            </>
          )}
        </View>
        <TouchableOpacity
          onPress={handleStop}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={skipLabel}
          accessibilityRole="button"
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Step content */}
      <Text style={[tooltipStyles.text, { color: colors.textMuted }]}>
        {currentStep?.text || ''}
      </Text>

      {/* Footer: previous · progress dots · next */}
      <View style={tooltipStyles.footer}>
        {!isFirstStep && (
          <TouchableOpacity
            onPress={handlePrev}
            style={tooltipStyles.prevButton}
            accessibilityLabel={previousLabel}
            accessibilityRole="button"
          >
            <Text style={[tooltipStyles.prevButtonText, { color: colors.textMuted }]}>
              {previousLabel}
            </Text>
          </TouchableOpacity>
        )}

        {totalStepsNumber > 1 && (
          <View
            style={tooltipStyles.dots}
            accessibilityLabel={`${currentStepNumber}/${totalStepsNumber}`}
          >
            {Array.from({ length: totalStepsNumber }).map((_, i) => (
              <View
                key={i}
                style={[
                  tooltipStyles.dot,
                  i === currentStepNumber - 1
                    ? [tooltipStyles.dotActive, { backgroundColor: colors.primary }]
                    : { backgroundColor: colors.progressInactive },
                ]}
              />
            ))}
          </View>
        )}

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
    </View>
  );
};

const tooltipStyles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  dots: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    marginHorizontal: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 14,
  },
  prevButton: {
    paddingVertical: 10,
    paddingRight: 8,
  },
  prevButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  nextButton: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 10,
  },
  nextButtonText: {
    fontSize: 14,
    fontWeight: '600',
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

        // Wait for the JS thread to go idle (interactions/animations settling),
        // then add additional delay for layout stabilization across different devices.
        // This ensures all CopilotStep elements have been properly laid out and measured
        runWhenIdle(() => {
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

  const restartWelcomeTour = useCallback(async () => {
    await resetTour('welcome');
    await resetTour('main_navigation');
    Logger.logUserAction('welcome_tour_restarted', {});
  }, [resetTour]);

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
      restartWelcomeTour,
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
      restartWelcomeTour,
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

// Horizontal gutter for the tooltip card. We pin the card to the full container
// width (left + right margins) instead of letting copilot size it to the target,
// so the bubble is the same width on every step.
const TOOLTIP_H_MARGIN = 16;

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

  const stepName: string | undefined = step?.name;
  const isCenterAction = stepName === 'actions-tab';
  // Labeled bottom tabs (home/courts/community/chat) wrap tightly around the glyph
  // but the tab cell reserves space below for the text label. Shift the spotlight
  // down (less top pad, more bottom pad) to cover the label. The center "+" button
  // has no label, so it stays symmetric (handled by the defaults below).
  const isLabeledTab = typeof stepName === 'string' && stepName.endsWith('-tab') && !isCenterAction;
  const isHeaderProfile = stepName === 'header-profile';

  let padTop = SPOTLIGHT_PADDING;
  let padBottom = SPOTLIGHT_PADDING;
  let padLeft = SPOTLIGHT_PADDING;
  let padRight = SPOTLIGHT_PADDING;

  if (isLabeledTab) {
    padTop = 2;
    padBottom = 18;
  } else if (isHeaderProfile) {
    // The avatar is measured as a row that includes ~8px of left margin before
    // the ring. Crop that margin out and hug the ring with a tight halo.
    padTop = 4;
    padBottom = 4;
    padLeft = -4;
    padRight = 4;
  }

  const x = px - padLeft;
  const y = py - padTop;
  const w = sx + padLeft + padRight;
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
  const { width: screenWidth } = useWindowDimensions();

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
      // The default copilot arrow is positioned on its (transparent) wrapper, so it
      // detaches from our custom card and can't share its shadow. Hide it — the
      // spotlight cutout already points at the target.
      arrowColor="transparent"
      backdropColor="rgba(0, 0, 0, 0.7)"
      svgMaskPath={buildSpotlightPath}
      // Copilot wraps the tooltipComponent in its own card. We render the card
      // ourselves inside CustomTooltip so the wrapper has to be a transparent
      // passthrough — otherwise we get a stale white card behind the themed one.
      // tooltipStyle is applied last (after copilot's computed position), so we
      // override left/right/maxWidth to pin the card to the full container width
      // on every step, and overflow:visible so the card's shadow isn't clipped.
      tooltipStyle={{
        backgroundColor: 'transparent',
        padding: 0,
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
        borderRadius: 16,
        overflow: 'visible',
        left: TOOLTIP_H_MARGIN,
        right: TOOLTIP_H_MARGIN,
        maxWidth: screenWidth,
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
