'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ORDERED_DAYS, SUPPORTED_HOURS, cellKey, type HourGrid } from '@rallia/shared-utils';

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
 */
export function AvailabilityGrid({
  value,
  onChange,
}: {
  value: HourGrid;
  onChange: (next: HourGrid) => void;
}) {
  const t = useTranslations('playerDirectory.dayLetters');
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
      className="overflow-x-auto"
      onPointerUp={endPaint}
      onPointerLeave={endPaint}
      // Without this a drag selects the labels instead of painting cells.
      style={{ userSelect: isPainting ? 'none' : undefined }}
    >
      {/* table-fixed so all seven day columns share equal width; auto layout sizes them
          by the day letter, which differs per locale (M/T/W vs L/M/M). No min-width:
          paint-dragging inside a horizontal scroller is miserable on touch, so the
          columns squeeze to fit even the narrowest phones instead of overflowing. */}
      <table className="w-full table-fixed border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="w-8" />
            {ORDERED_DAYS.map((day, dayIndex) => (
              <th key={day} className="p-0">
                <button
                  type="button"
                  onClick={() => toggleDay(dayIndex)}
                  className="w-full rounded py-1 text-xs font-semibold uppercase text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t(day)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SUPPORTED_HOURS.map(hour => (
            <tr key={hour}>
              <th className="p-0">
                <button
                  type="button"
                  onClick={() => toggleHour(hour)}
                  className="w-full rounded px-1 py-1 text-right text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {String(hour).padStart(2, '0')}
                </button>
              </th>
              {ORDERED_DAYS.map(day => {
                const key = cellKey(day, hour);
                const selected = value.has(key);
                return (
                  <td key={key} className="p-0">
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${t(day)} ${String(hour).padStart(2, '0')}:00`}
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
                        'h-6 w-full rounded border transition-colors',
                        selected
                          ? 'border-primary bg-primary'
                          : 'border-border bg-muted/40 hover:border-primary/40'
                      )}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
