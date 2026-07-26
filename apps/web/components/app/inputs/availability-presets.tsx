'use client';

import { Check, Eraser } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  AVAILABILITY_PRESETS,
  emptyGrid,
  isPresetApplied,
  togglePreset,
  type HourGrid,
} from '@rallia/shared-utils';

import { cn } from '@/lib/utils';

/**
 * One-tap patterns above the availability grid — the same presets (and the same
 * cells) as mobile's chip row, both reading AVAILABILITY_PRESETS from shared-utils.
 * A chip reads as applied only when every one of its cells is selected; clicking an
 * applied chip removes exactly those cells.
 */
export function AvailabilityPresets({
  value,
  onChange,
}: {
  value: HourGrid;
  onChange: (next: HourGrid) => void;
}) {
  const t = useTranslations('onboarding.availabilityStep.presets');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {AVAILABILITY_PRESETS.map(preset => {
        const active = isPresetApplied(value, preset);
        return (
          <button
            key={preset.key}
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => onChange(togglePreset(value, preset))}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors outline-none',
              'focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'
            )}
          >
            {active && <Check className="size-3.5" aria-hidden="true" />}
            {t(preset.key)}
          </button>
        );
      })}

      {/* Last, not first like mobile: appearing at the end keeps the preset chips
          from shifting position the moment a first cell is picked. */}
      {value.size > 0 && (
        <button
          type="button"
          onClick={() => onChange(emptyGrid())}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors outline-none',
            'hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50'
          )}
        >
          <Eraser className="size-3.5" aria-hidden="true" />
          {t('clear')}
        </button>
      )}
    </div>
  );
}
