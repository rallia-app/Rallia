'use client';

import { useCallback, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  DAY_PARTS,
  ORDERED_DAYS,
  SUPPORTED_HOURS,
  cellKey,
  formatHourLabel,
  isWeekendDay,
  type HourGrid,
} from '@rallia/shared-utils';

import { cn } from '@/lib/utils';

/**
 * 7-day × 17-hour weekly availability picker (hours 06–22; each cell is the
 * [h:00, h+1:00) window). The web counterpart to mobile's HourlyAvailabilityGrid —
 * same shape, same cell encoding, both from @rallia/shared-utils.
 *
 * Supports the same three interactions as mobile:
 *  - click a cell to toggle
 *  - click-and-drag to paint (the first cell's inverse sets the paint mode, so
 *    dragging from an empty cell fills and from a filled cell clears)
 *  - click a day or hour label to bulk-toggle that column/row
 *
 * Pointer events rather than mouse events so a drag works with touch and pen on a
 * tablet, which is the width where this grid is most awkward to tap cell by cell.
 *
 * Presentation is doing real work here: 119 identical squares are unreadable, so rows
 * are banded by day part, hours are labelled in the locale's own clock, contiguous
 * selections merge into one block, and weekends are tinted. A player should be able to
 * verify "weekday evenings" at a glance instead of counting rows.
 */
export function AvailabilityGrid({
  value,
  onChange,
}: {
  value: HourGrid;
  onChange: (next: HourGrid) => void;
}) {
  const t = useTranslations('playerDirectory.dayLetters');
  const tDays = useTranslations('availability.days');
  const tParts = useTranslations('publicMatches.filters.timeOfDay');
  const locale = useLocale();

  // null when not dragging; true = filling, false = clearing.
  const paintMode = useRef<boolean | null>(null);
  const [isPainting, setIsPainting] = useState(false);

  const applyCell = useCallback(
    (key: string, fill: boolean) => {
      const next = new Set(value);
      if (fill) next.add(key);
      else next.delete(key);
      onChange(next);
    },
    [value, onChange]
  );

  const endPaint = useCallback(() => {
    paintMode.current = null;
    setIsPainting(false);
  }, []);

  const startPaint = useCallback(
    (key: string) => {
      const fill = !value.has(key);
      paintMode.current = fill;
      setIsPainting(true);
      applyCell(key, fill);
    },
    [value, applyCell]
  );

  const paintOver = useCallback(
    (key: string) => {
      if (paintMode.current === null) return;
      applyCell(key, paintMode.current);
    },
    [applyCell]
  );

  const toggleDay = useCallback(
    (dayIndex: number) => {
      const day = ORDERED_DAYS[dayIndex];
      const keys = SUPPORTED_HOURS.map(hour => cellKey(day, hour));
      const allFilled = keys.every(key => value.has(key));
      const next = new Set(value);
      keys.forEach(key => (allFilled ? next.delete(key) : next.add(key)));
      onChange(next);
    },
    [value, onChange]
  );

  const toggleHour = useCallback(
    (hour: number) => {
      const keys = ORDERED_DAYS.map(day => cellKey(day, hour));
      const allFilled = keys.every(key => value.has(key));
      const next = new Set(value);
      keys.forEach(key => (allFilled ? next.delete(key) : next.add(key)));
      onChange(next);
    },
    [value, onChange]
  );

  return (
    <div
      onPointerUp={endPaint}
      onPointerLeave={endPaint}
      // Without this a drag selects the labels instead of painting cells.
      style={{ userSelect: isPainting ? 'none' : undefined }}
    >
      {/* table-fixed so all seven day columns share equal width; auto layout sizes them
          by the day letter, which differs per locale (M/T/W vs L/M/M). No min-width:
          paint-dragging inside a horizontal scroller is miserable on touch, so the
          columns squeeze to fit even the narrowest phones instead of overflowing.
          Column gaps but no row gap — that is what lets a vertical run read as one
          block rather than a stack of stripes. */}
      <table className="w-full table-fixed border-separate [border-spacing:0.25rem_0]">
        <thead>
          <tr>
            <th className="w-12 sm:w-16" />
            {ORDERED_DAYS.map((day, dayIndex) => (
              <th key={day} className="p-0 pb-1.5">
                <button
                  type="button"
                  onClick={() => toggleDay(dayIndex)}
                  title={tDays(day)}
                  aria-label={tDays(day)}
                  className={cn(
                    'w-full rounded py-1 text-xs font-semibold uppercase transition-colors',
                    'hover:bg-muted hover:text-foreground',
                    isWeekendDay(day) ? 'text-foreground/70' : 'text-muted-foreground'
                  )}
                >
                  {/* Full names where they fit; letters on a phone, where three
                      characters of "Wednesday" would be worse than "W". */}
                  <span className="hidden sm:inline">{tDays(day).slice(0, 3)}</span>
                  <span className="sm:hidden">{t(day)}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>

        {/* One tbody per day part: the browser's default row-group separation plus the
            caption row gives the bands structure without extra borders. */}
        {DAY_PARTS.map(part => (
          <tbody key={part.key}>
            <tr>
              <th
                colSpan={ORDERED_DAYS.length + 1}
                scope="colgroup"
                className="px-0 pb-1 pt-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {tParts(part.key)}
              </th>
            </tr>

            {part.hours.map((hour, hourIndexInPart) => {
              const isFirstOfBand = hourIndexInPart === 0;
              const isLastOfBand = hourIndexInPart === part.hours.length - 1;

              return (
                <tr key={hour}>
                  <th className="p-0 pr-1">
                    <button
                      type="button"
                      onClick={() => toggleHour(hour)}
                      className="w-full rounded px-1 py-1 text-right text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {formatHourLabel(hour, locale)}
                    </button>
                  </th>

                  {ORDERED_DAYS.map(day => {
                    const key = cellKey(day, hour);
                    const selected = value.has(key);
                    // Round only where a run actually starts or ends. Band edges always
                    // count as edges, since the caption row visually breaks the run.
                    const runStart = isFirstOfBand || !value.has(cellKey(day, hour - 1));
                    const runEnd = isLastOfBand || !value.has(cellKey(day, hour + 1));

                    return (
                      <td key={key} className="p-0 py-px">
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-label={`${tDays(day)} ${formatHourLabel(hour, locale)}`}
                          onPointerDown={event => {
                            // Touch sets an implicit pointer capture on the origin element,
                            // which retargets every later pointer event there and stops
                            // pointerenter firing on the cells being dragged over. Release
                            // it so painting works — but only when it is actually held:
                            // releasing an uncaptured pointer (any mouse press) throws
                            // NotFoundError and would abort before the cell ever toggles.
                            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                              event.currentTarget.releasePointerCapture(event.pointerId);
                            }
                            startPaint(key);
                          }}
                          onPointerEnter={() => paintOver(key)}
                          className={cn(
                            'h-7 w-full border-x transition-colors',
                            selected
                              ? 'border-primary bg-primary'
                              : cn(
                                  'border-border hover:border-primary/50 hover:bg-primary/10',
                                  isWeekendDay(day) ? 'bg-muted/70' : 'bg-muted/30'
                                ),
                            selected && (runStart ? 'rounded-t-md border-t' : 'border-t-0'),
                            selected && (runEnd ? 'rounded-b-md border-b' : 'border-b-0'),
                            !selected && 'rounded-md border-y'
                          )}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
