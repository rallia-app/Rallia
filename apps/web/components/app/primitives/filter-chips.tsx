'use client';

import { cn } from '@/lib/utils';

export interface FilterChip<T extends string = string> {
  value: T;
  label: string;
  /** Rendered as a trailing count pill, e.g. unread conversations. */
  count?: number;
}

interface FilterChipsProps<T extends string> {
  chips: FilterChip<T>[];
  selected: T | T[];
  onSelect: (value: T) => void;
  /** Multi-select turns chips into toggles and switches to aria-pressed semantics. */
  multiple?: boolean;
  className?: string;
}

/**
 * Horizontal filter chip row. Mobile has four near-identical copies of this
 * (PlayerMatchFilterChips, BookingFilterChips, ConversationFilterChips, facility
 * filters); web keeps one.
 *
 * Scrolls inside itself rather than widening the page — a long chip row must never
 * make the whole layout scroll sideways.
 */
export function FilterChips<T extends string>({
  chips,
  selected,
  onSelect,
  multiple = false,
  className,
}: FilterChipsProps<T>) {
  const selectedValues = Array.isArray(selected) ? selected : [selected];

  return (
    <div
      className={cn('-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]', className)}
      role={multiple ? 'group' : 'radiogroup'}
    >
      {chips.map(chip => {
        const isSelected = selectedValues.includes(chip.value);
        return (
          <button
            key={chip.value}
            type="button"
            onClick={() => onSelect(chip.value)}
            role={multiple ? undefined : 'radio'}
            aria-checked={multiple ? undefined : isSelected}
            aria-pressed={multiple ? isSelected : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              isSelected
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {chip.label}
            {chip.count !== undefined && chip.count > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  isSelected ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15'
                )}
              >
                {chip.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
