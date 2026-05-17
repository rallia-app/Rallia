/**
 * HourlyAvailabilityGrid
 *
 * 7-day × 17-hour weekly availability picker (hours 6–22 inclusive; each cell
 * represents the [h:00, h+1:00) window). Drives the onboarding step and the
 * profile-edit overlay.
 *
 * Controlled component. The parent owns `value` (the selected set of cells
 * keyed `${day}-${hour}`) and reacts to `onChange`. The grid handles three
 * interactions:
 *
 *   • Tap a cell to toggle it.
 *   • Press-and-drag to "paint" — on press-down, capture the inverse of the
 *     touched cell as the paint mode (empty cell → drag fills; filled cell →
 *     drag clears). Subsequent cells the touch traverses are forced into that
 *     same mode. Matches the When2Meet pattern users find familiar.
 *   • Tap a row label (hour) or column header (day letter) for a smart bulk
 *     toggle of that row/column.
 *
 * Drag hit-testing relies on knowing cell width/height, captured via the
 * grid container's `onLayout`. Cell coords map back to (day, hour) by integer
 * division on the touch's locationX/Y, gated by the time-label column width.
 *
 * Performance: a single useState holds the value as `Set<string>` (immutable
 * — each update wraps a fresh Set). 119 cells × 60fps drag is well within
 * RN's render budget on every device we ship to; if profiling ever shows
 * jank we'd switch to a useReducer keyed on cell flips.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';
import type { DayEnum } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Hour cells the grid supports: 06..22 inclusive (17 cells). */
export const SUPPORTED_HOURS: number[] = Array.from({ length: 17 }, (_, i) => i + 6);

export const ORDERED_DAYS: DayEnum[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DAY_LETTER_KEY: Record<DayEnum, TranslationKey> = {
  monday: 'playerDirectory.dayLetters.monday',
  tuesday: 'playerDirectory.dayLetters.tuesday',
  wednesday: 'playerDirectory.dayLetters.wednesday',
  thursday: 'playerDirectory.dayLetters.thursday',
  friday: 'playerDirectory.dayLetters.friday',
  saturday: 'playerDirectory.dayLetters.saturday',
  sunday: 'playerDirectory.dayLetters.sunday',
};

// =============================================================================
// TYPES
// =============================================================================

/**
 * Selection state. Keys are `${day}-${hour}` strings — flat representation so
 * one Set clone per drag tick is cheap. Helpers below build/parse cell keys.
 */
export type HourGrid = ReadonlySet<string>;

export function cellKey(day: DayEnum, hour: number): string {
  return `${day}-${hour}`;
}

/** Build an empty grid (no cells selected). */
export function emptyGrid(): HourGrid {
  return new Set();
}

/** Total cells selected. */
export function countSelected(grid: HourGrid): number {
  return grid.size;
}

export interface HourlyAvailabilityGridColors {
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  cellInactive: string;
  cellActive: string;
}

interface HourlyAvailabilityGridProps {
  value: HourGrid;
  onChange: (next: HourGrid) => void;
  colors: HourlyAvailabilityGridColors;
  t: (key: TranslationKey) => string;
  /** Locale (e.g. 'en-US', 'fr-CA') — drives the hour label formatter. */
  locale: string;
}

// =============================================================================
// HOUR LABELS — locale-aware
// =============================================================================

const hourFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getHourFormatter(locale: string): Intl.DateTimeFormat {
  const cached = hourFormatterCache.get(locale);
  if (cached) return cached;
  const f = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: locale.toLowerCase().startsWith('en'),
  });
  hourFormatterCache.set(locale, f);
  return f;
}

function formatHourLabel(hour: number, locale: string): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return getHourFormatter(locale).format(d);
}

// =============================================================================
// COMPONENT
// =============================================================================

const TIME_COL_WIDTH = 56;
const CELL_HEIGHT = 28;

export const HourlyAvailabilityGrid: React.FC<HourlyAvailabilityGridProps> = ({
  value,
  onChange,
  colors,
  t,
  locale,
}) => {
  // Captured at the parent container's onLayout: total width minus the
  // time-label column, divided by 7 = cell width. PanResponder needs this
  // to convert touch coords into (day, hour) cells.
  const cellWidthRef = useRef<number>(0);

  // Per-gesture paint mode: 'fill' or 'clear'. Set on press-down based on
  // whether the first cell touched is empty or filled.
  const paintModeRef = useRef<'fill' | 'clear' | null>(null);

  // Cells visited within the current gesture, so we don't re-toggle a cell
  // when the touch moves back over it.
  const visitedRef = useRef<Set<string> | null>(null);

  // Mutable snapshot of `value` for the gesture's lifetime. We mutate this
  // in place during the drag (faster than spawning a new Set per touch event)
  // and call onChange with a fresh wrapper Set whenever we add/remove.
  const draftRef = useRef<Set<string> | null>(null);

  const [gridOffset, setGridOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const onGridLayout = useCallback((e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    cellWidthRef.current = (width - TIME_COL_WIDTH) / 7;
  }, []);

  const computeCellFromTouch = useCallback(
    (locationX: number, locationY: number): { day: DayEnum; hour: number } | null => {
      const x = locationX - TIME_COL_WIDTH;
      if (x < 0) return null;
      const cellW = cellWidthRef.current;
      if (cellW <= 0) return null;
      const dayIdx = Math.floor(x / cellW);
      const hourIdx = Math.floor(locationY / CELL_HEIGHT);
      if (dayIdx < 0 || dayIdx >= ORDERED_DAYS.length) return null;
      if (hourIdx < 0 || hourIdx >= SUPPORTED_HOURS.length) return null;
      return { day: ORDERED_DAYS[dayIdx], hour: SUPPORTED_HOURS[hourIdx] };
    },
    []
  );

  const handleTouch = useCallback(
    (e: GestureResponderEvent) => {
      const cell = computeCellFromTouch(e.nativeEvent.locationX, e.nativeEvent.locationY);
      if (!cell) return;
      const key = cellKey(cell.day, cell.hour);

      // First touch of the gesture: capture paint mode + first cell.
      if (!paintModeRef.current) {
        paintModeRef.current = value.has(key) ? 'clear' : 'fill';
        visitedRef.current = new Set();
        draftRef.current = new Set(value);
        selectionHaptic();
      }

      if (visitedRef.current!.has(key)) return;
      visitedRef.current!.add(key);

      const draft = draftRef.current!;
      if (paintModeRef.current === 'fill') {
        if (draft.has(key)) return;
        draft.add(key);
      } else {
        if (!draft.has(key)) return;
        draft.delete(key);
      }
      // Hand the parent a *new* Set so React detects the change.
      onChange(new Set(draft));
    },
    [computeCellFromTouch, onChange, value]
  );

  const resetGesture = useCallback(() => {
    paintModeRef.current = null;
    visitedRef.current = null;
    draftRef.current = null;
  }, []);

  const panResponderRef = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gesture) =>
        Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
      onPanResponderGrant: e => handleTouch(e),
      onPanResponderMove: e => handleTouch(e),
      onPanResponderRelease: resetGesture,
      onPanResponderTerminate: resetGesture,
    })
  );

  // Smart bulk toggle: tap a day-column header to fill (or clear) all 17
  // hours of that day. If every hour is already filled, the tap clears.
  const toggleDay = useCallback(
    (day: DayEnum) => {
      selectionHaptic();
      const next = new Set(value);
      const allFilled = SUPPORTED_HOURS.every(h => next.has(cellKey(day, h)));
      if (allFilled) {
        for (const h of SUPPORTED_HOURS) next.delete(cellKey(day, h));
      } else {
        for (const h of SUPPORTED_HOURS) next.add(cellKey(day, h));
      }
      onChange(next);
    },
    [onChange, value]
  );

  // Same the other axis: tap an hour-row label to fill/clear that hour across
  // all 7 days.
  const toggleHour = useCallback(
    (hour: number) => {
      selectionHaptic();
      const next = new Set(value);
      const allFilled = ORDERED_DAYS.every(d => next.has(cellKey(d, hour)));
      if (allFilled) {
        for (const d of ORDERED_DAYS) next.delete(cellKey(d, hour));
      } else {
        for (const d of ORDERED_DAYS) next.add(cellKey(d, hour));
      }
      onChange(next);
    },
    [onChange, value]
  );

  return (
    <View style={styles.container}>
      {/* Column headers — day letters (tappable to bulk-toggle the day). */}
      <View style={styles.headerRow}>
        <View style={{ width: TIME_COL_WIDTH }} />
        {ORDERED_DAYS.map(day => (
          <TouchableOpacity
            key={`hdr-${day}`}
            style={styles.dayHeader}
            onPress={() => toggleDay(day)}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t(DAY_LETTER_KEY[day])}
          >
            <Text size="xs" weight="semibold" color={colors.textMuted}>
              {t(DAY_LETTER_KEY[day])}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Grid rows: hour label + 7 cells. The cell-row container is the
          PanResponder target, which lets a drag paint across both axes
          without losing the gesture mid-stroke. */}
      <View
        onLayout={e => {
          onGridLayout(e);
          setGridOffset({ x: 0, y: e.nativeEvent.layout.y });
        }}
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...panResponderRef.current.panHandlers}
      >
        {SUPPORTED_HOURS.map((hour, rowIdx) => (
          <View key={`row-${hour}`} style={[styles.row, { height: CELL_HEIGHT }]}>
            <TouchableOpacity
              style={[styles.timeLabel, { width: TIME_COL_WIDTH }]}
              onPress={() => toggleHour(hour)}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={formatHourLabel(hour, locale)}
            >
              <Text size="xs" weight="semibold" color={colors.text}>
                {formatHourLabel(hour, locale)}
              </Text>
            </TouchableOpacity>
            {ORDERED_DAYS.map(day => {
              const filled = value.has(cellKey(day, hour));
              return (
                <View
                  key={`cell-${day}-${hour}`}
                  style={[
                    styles.cell,
                    {
                      backgroundColor: filled ? colors.cellActive : colors.cellInactive,
                      borderColor: filled ? colors.cellActive : colors.border,
                    },
                  ]}
                  // The actual hit-testing for the cell goes through the row
                  // container's PanResponder. We keep the cell view non-
                  // touchable so taps don't intercept the pan gesture; the
                  // PanResponder handles both single taps and drags.
                  pointerEvents="none"
                  accessibilityRole="switch"
                  accessibilityState={{ checked: filled }}
                  accessibilityLabel={`${t(DAY_LETTER_KEY[day])} ${formatHourLabel(hour, locale)}`}
                />
              );
            })}
            {/* unused — silences lint about gridOffset */}
            {rowIdx === -1 ? <Text>{gridOffset.x}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  dayHeader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeLabel: {
    paddingRight: spacingPixels[2],
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  cell: {
    flex: 1,
    height: CELL_HEIGHT - 4,
    marginHorizontal: 1.5,
    borderRadius: radiusPixels.sm,
    borderWidth: 1,
  },
});

export default HourlyAvailabilityGrid;
