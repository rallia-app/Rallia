/**
 * Bottom padding for a full-screen scrollable on a tab-less route.
 *
 * The inset belongs in the scroll view's contentContainerStyle, never as
 * padding on a SafeAreaView wrapper: a padded wrapper crops the scroll
 * viewport, so the list stops above the home indicator instead of scrolling
 * under it. `contentInsetAdjustmentBehavior` is iOS-only, so Android has to
 * apply it by hand.
 *
 * Max, not sum: the system inset wins where there is one (34pt iPhone home
 * indicator, 24dp Android gesture nav, 48dp 3-button nav) and the baseline
 * covers devices that report zero.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacingPixels } from '@rallia/design-system';

export const SCROLL_BOTTOM_BASELINE = spacingPixels[5];

export function useScrollBottomInset(baseline: number = SCROLL_BOTTOM_BASELINE): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, baseline);
}
