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
 * Why react-native-gesture-handler instead of PanResponder:
 *   When the grid renders inside a react-native-actions-sheet, the sheet
 *   attaches a `Gesture.Pan()` with `.activeOffsetY([-5, 5])` and
 *   `.failOffsetX([-5, 5])` for its drag-to-dismiss / snap behavior. Even
 *   with `gestureEnabled={false}` (where the handler no-ops), the gesture
 *   STILL participates in arbitration and wins vertical drags before a
 *   plain PanResponder can claim them. Horizontal drags work because the
 *   sheet's gesture fails on horizontal movement. By using
 *   `Gesture.Pan().blocksExternalGesture(sheetPanRef)` we force the sheet's
 *   gesture to defer to ours whenever a touch starts on the cells area.
 *
 * Layout split: time-label column and day-header row sit *outside* the
 * GestureDetector. The cells container is the only thing the pan gesture
 * wraps, so `e.x` / `e.y` from the event are simple cell-local coordinates
 * — no `measureInWindow` required.
 *
 * Performance: a single Set is mutated in place during a gesture (a fresh
 * wrapper Set is published to the parent only when at least one cell flips
 * in a given move event). Fast drags interpolate the line between
 * consecutive samples so no cell is skipped between PanResponder ticks.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useScrollHandlers } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';
import type { DayEnum } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';

// =============================================================================
// CONSTANTS
// =============================================================================

// The grid's shape and cell encoding live in @rallia/shared-utils so mobile, the web
// onboarding wizard and the weekly check-in cannot disagree about which hours exist or
// how a cell is keyed. Re-exported here because this module is the established import
// site across the app.
import {
  SUPPORTED_HOURS,
  ORDERED_DAYS,
  cellKey,
  emptyGrid,
  countSelected,
  formatHourLabel,
  parseCellKey,
  type HourGrid,
} from '@rallia/shared-utils';

export {
  SUPPORTED_HOURS,
  ORDERED_DAYS,
  cellKey,
  emptyGrid,
  countSelected,
  parseCellKey,
  type HourGrid,
};

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
  /**
   * Which day columns to render, in order. Defaults to the full Mon–Sun week
   * (onboarding / profile edit). The rolling check-in passes the 4-day window
   * (today + next 3). Cell keys are still `${day}-${hour}`, so a subset here
   * only changes which columns are shown/edited — never the key format.
   */
  days?: DayEnum[];
  /**
   * Optional per-day column header text (e.g. "Fri 20"). When a day is absent
   * the header falls back to the localized day letter. Used by the check-in
   * window to show concrete dates while keeping day-of-week semantics.
   */
  columnLabels?: Partial<Record<DayEnum, string>>;
}

// =============================================================================
// COMPONENT
// =============================================================================

// 28pt rows give ~25pt tappable height — below Apple's 44pt HIG floor, but
// paint-drag + bulk-toggle row/column headers mitigate it. TIME_COL_WIDTH
// 40 just fits the longest right-aligned hour label ("12 PM" in en-US).
const TIME_COL_WIDTH = 40;
const CELL_HEIGHT = 28;

export const HourlyAvailabilityGrid: React.FC<HourlyAvailabilityGridProps> = ({
  value,
  onChange,
  colors,
  t,
  locale,
  days: daysProp,
  columnLabels,
}) => {
  // Effective day columns. Defaults to the full week. Pinned via a ref so the
  // gesture callbacks (memoized) always read the current set without forcing a
  // gesture rebuild mid-drag when the parent passes a fresh array identity.
  const days = daysProp ?? ORDERED_DAYS;
  const daysRef = useRef<DayEnum[]>(days);
  daysRef.current = days;

  // ─── Refs the gesture closures read from ──────────────────────────────────
  //
  // The gesture is created via useMemo and rebuilt only when its deps change.
  // We pin value/onChange/cell-width via refs so the gesture callbacks always
  // see the latest state without needing to recreate the gesture on every
  // render (which would invalidate the gesture mid-touch).
  const valueRef = useRef<HourGrid>(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Cell width: derived from cells-container width / 7. Captured at layout.
  const cellWidthRef = useRef<number>(0);

  // ─── Per-gesture refs ─────────────────────────────────────────────────────
  //
  // paintMode: 'fill' or 'clear', decided from the first touched cell.
  // visited: cells the touch has already traversed (no re-toggle on drag-back).
  // draft: mutable working copy of the selection for the gesture's life; a
  //   fresh Set wrapper is published to the parent per move event in which
  //   at least one cell actually flipped.
  // lastCell: last cell the touch sampled, used to interpolate the line to
  //   the next sample (PanResponder ticks at ~60fps; fast drags would
  //   otherwise skip whole rows).
  const paintModeRef = useRef<'fill' | 'clear' | null>(null);
  const visitedRef = useRef<Set<string> | null>(null);
  const draftRef = useRef<Set<string> | null>(null);
  const lastCellRef = useRef<{ day: DayEnum; hour: number } | null>(null);

  // ─── Action-sheet integration ─────────────────────────────────────────────
  //
  // Inside a react-native-actions-sheet, the sheet's own Gesture.Pan
  // (configured with .activeOffsetY([-5,5]) and .failOffsetX([-5,5])) wins
  // vertical drags before our gesture can claim them — that's why
  // horizontal-first drags work but pure vertical drags get yanked away.
  // useScrollHandlers exposes the sheet's gesture ref via simultaneousHandlers
  // so we can pass it to .blocksExternalGesture(), which makes the sheet's
  // gesture defer to ours whenever a touch starts on this area.
  //
  // Outside an action sheet, the hook returns a default no-op ref; passing
  // it to blocksExternalGesture is harmless.
  const scrollHandlers = useScrollHandlers<View>();
  const sheetGestureRef = scrollHandlers.simultaneousHandlers[0];

  // ─── Cells container layout ───────────────────────────────────────────────

  const onCellsLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width } = e.nativeEvent.layout;
      cellWidthRef.current = width / daysRef.current.length;
      // useScrollHandlers tracks layout for the draggable-node registration
      // (which the sheet uses to defer to nested scrollables on web).
      scrollHandlers.onLayout();
    },
    [scrollHandlers]
  );

  // ─── Hit-testing ──────────────────────────────────────────────────────────

  const computeCellFromLocal = useCallback(
    (localX: number, localY: number): { day: DayEnum; hour: number } | null => {
      const cols = daysRef.current;
      const cellW = cellWidthRef.current;
      if (cellW <= 0) return null;
      if (localX < 0 || localY < 0) return null;
      const dayIdx = Math.floor(localX / cellW);
      const hourIdx = Math.floor(localY / CELL_HEIGHT);
      if (dayIdx < 0 || dayIdx >= cols.length) return null;
      if (hourIdx < 0 || hourIdx >= SUPPORTED_HOURS.length) return null;
      return { day: cols[dayIdx], hour: SUPPORTED_HOURS[hourIdx] };
    },
    []
  );

  // ─── Gesture handler ──────────────────────────────────────────────────────

  const handleTouch = useCallback(
    (x: number, y: number) => {
      const currentCell = computeCellFromLocal(x, y);
      if (!currentCell) {
        // Off-grid: end this sub-stroke. If the finger re-enters somewhere
        // else, we don't want to draw a long line across the gap.
        lastCellRef.current = null;
        return;
      }

      // First touch of the entire gesture: decide paint mode + seed the
      // draft from the LATEST committed value (via ref).
      if (!paintModeRef.current) {
        const firstKey = cellKey(currentCell.day, currentCell.hour);
        const currentValue = valueRef.current;
        paintModeRef.current = currentValue.has(firstKey) ? 'clear' : 'fill';
        visitedRef.current = new Set();
        draftRef.current = new Set(currentValue);
        void selectionHaptic();
      }

      const prevCell = lastCellRef.current;
      lastCellRef.current = currentCell;

      // Build the list of cells this sample should touch. If we have a
      // previous on-grid cell, walk the line from there to currentCell so
      // fast drags don't skip rows. Otherwise (first touch, or re-entry
      // after an off-grid excursion) just touch currentCell.
      const cols = daysRef.current;
      const cells: { day: DayEnum; hour: number }[] = [];
      if (prevCell) {
        const fromDayIdx = cols.indexOf(prevCell.day);
        const fromHourIdx = SUPPORTED_HOURS.indexOf(prevCell.hour);
        const toDayIdx = cols.indexOf(currentCell.day);
        const toHourIdx = SUPPORTED_HOURS.indexOf(currentCell.hour);
        const dx = toDayIdx - fromDayIdx;
        const dy = toHourIdx - fromHourIdx;
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        if (steps === 0) {
          cells.push(currentCell);
        } else {
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const dIdx = fromDayIdx + Math.round(dx * t);
            const hIdx = fromHourIdx + Math.round(dy * t);
            cells.push({ day: cols[dIdx], hour: SUPPORTED_HOURS[hIdx] });
          }
        }
      } else {
        cells.push(currentCell);
      }

      // Apply paint mode to every cell along the segment, deduping via the
      // visited set. Batch all flips into a single onChange so the parent
      // re-renders at most once per move event regardless of how many cells
      // a fast drag covers.
      const visited = visitedRef.current!;
      const draft = draftRef.current!;
      const mode = paintModeRef.current;
      let mutated = false;
      for (const c of cells) {
        const key = cellKey(c.day, c.hour);
        if (visited.has(key)) continue;
        visited.add(key);
        if (mode === 'fill') {
          if (!draft.has(key)) {
            draft.add(key);
            mutated = true;
          }
        } else {
          if (draft.has(key)) {
            draft.delete(key);
            mutated = true;
          }
        }
      }
      if (mutated) {
        onChangeRef.current(new Set(draft));
      }
    },
    [computeCellFromLocal]
  );

  const resetGesture = useCallback(() => {
    paintModeRef.current = null;
    visitedRef.current = null;
    draftRef.current = null;
    lastCellRef.current = null;
  }, []);

  // ─── Pan gesture ──────────────────────────────────────────────────────────
  //
  // .minDistance(0) activates immediately on touch-down so a single tap
  // flips a cell. .blocksExternalGesture(sheetGestureRef) tells the sheet's
  // pan to defer to us when a touch lands on the cells area — the key fix
  // for vertical paint-drag inside the sheet. runOnJS(true) keeps callbacks
  // on the JS thread (we don't need worklet performance for this).

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .blocksExternalGesture(sheetGestureRef)
        .minDistance(0)
        .runOnJS(true)
        .onBegin(e => handleTouch(e.x, e.y))
        .onUpdate(e => handleTouch(e.x, e.y))
        .onFinalize(() => resetGesture()),
    [sheetGestureRef, handleTouch, resetGesture]
  );

  // ─── Bulk toggles ─────────────────────────────────────────────────────────

  const toggleDay = useCallback((day: DayEnum) => {
    void selectionHaptic();
    const next = new Set(valueRef.current);
    const allFilled = SUPPORTED_HOURS.every(h => next.has(cellKey(day, h)));
    if (allFilled) {
      for (const h of SUPPORTED_HOURS) next.delete(cellKey(day, h));
    } else {
      for (const h of SUPPORTED_HOURS) next.add(cellKey(day, h));
    }
    onChangeRef.current(next);
  }, []);

  const toggleHour = useCallback((hour: number) => {
    void selectionHaptic();
    const cols = daysRef.current;
    const next = new Set(valueRef.current);
    const allFilled = cols.every(d => next.has(cellKey(d, hour)));
    if (allFilled) {
      for (const d of cols) next.delete(cellKey(d, hour));
    } else {
      for (const d of cols) next.add(cellKey(d, hour));
    }
    onChangeRef.current(next);
  }, []);

  return (
    <View style={styles.container}>
      {/* Two-column row layout: hours column on the left (TouchableOpacities
          for bulk toggle), header + cells stack on the right. */}
      <View style={[styles.timeColumn, { width: TIME_COL_WIDTH }]}>
        {/* Spacer matching the day-header row's height so the time labels
            line up vertically with the cell rows. */}
        <View style={styles.timeColumnHeaderSpacer} />
        {SUPPORTED_HOURS.map(hour => (
          <TouchableOpacity
            key={`time-${hour}`}
            style={[styles.timeLabel, { height: CELL_HEIGHT }]}
            onPress={() => toggleHour(hour)}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={formatHourLabel(hour, locale)}
          >
            <Text size="xs" weight="semibold" color={colors.text}>
              {formatHourLabel(hour, locale)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.rightArea}>
        {/* Day-letter headers — tappable to bulk-toggle the day. Outside
            the GestureDetector so they don't compete with the pan gesture. */}
        <View style={styles.headerRow}>
          {days.map(day => {
            const label = columnLabels?.[day] ?? t(DAY_LETTER_KEY[day]);
            return (
              <TouchableOpacity
                key={`hdr-${day}`}
                style={styles.dayHeader}
                onPress={() => toggleDay(day)}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={label}
              >
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Cells. GestureDetector wraps ONLY this container, so the pan
            gesture's e.x/e.y are cell-local coordinates and no inner
            interactive child competes with the gesture. */}
        <GestureDetector gesture={pan}>
          <View ref={scrollHandlers.ref} onLayout={onCellsLayout} collapsable={false}>
            {SUPPORTED_HOURS.map(hour => (
              <View key={`row-${hour}`} style={[styles.row, { height: CELL_HEIGHT }]}>
                {days.map(day => {
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
                      // pointerEvents="none" so touches always reach the
                      // GestureDetector — never get absorbed by a cell view.
                      pointerEvents="none"
                      accessibilityRole="switch"
                      accessibilityState={{ checked: filled }}
                      accessibilityLabel={`${t(DAY_LETTER_KEY[day])} ${formatHourLabel(hour, locale)}`}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </GestureDetector>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flexDirection: 'row',
  },
  timeColumn: {
    flexDirection: 'column',
  },
  timeColumnHeaderSpacer: {
    // Matches the headerRow's effective height so timeLabel rows line up
    // with their cell rows. The headerRow's children render at the natural
    // height of the day-letter Text (~16pt) plus 2pt marginBottom on the
    // row. Bump if the day-header typography changes.
    height: 16 + 2,
  },
  rightArea: {
    flex: 1,
    flexDirection: 'column',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  dayHeader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeLabel: {
    paddingRight: spacingPixels[1],
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  cell: {
    flex: 1,
    height: CELL_HEIGHT - 3,
    marginHorizontal: 1,
    borderRadius: radiusPixels.sm,
    borderWidth: 1,
  },
});

export default HourlyAvailabilityGrid;
