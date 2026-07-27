import { cn } from '@/lib/utils';

export type MatchChipTone = 'primary' | 'secondary';

const toneClasses: Record<MatchChipTone, string> = {
  primary:
    'bg-[color-mix(in_srgb,var(--primary-500)_15%,transparent)] text-[var(--primary-700)] dark:bg-[color-mix(in_srgb,var(--primary-500)_30%,transparent)] dark:text-[var(--primary-500)]',
  secondary:
    'bg-[color-mix(in_srgb,var(--secondary-500)_15%,transparent)] text-[var(--secondary-700)] dark:bg-[color-mix(in_srgb,var(--secondary-500)_30%,transparent)] dark:text-[var(--secondary-500)]',
};

type MatchChipProps = {
  label: string;
  icon?: React.ReactNode;
  tone?: MatchChipTone;
  className?: string;
};

/** Tinted pill chip — mirrors mobile MatchCard / MatchDetailSheet badge styling. */
export function MatchChip({ label, icon, tone = 'primary', className }: MatchChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm',
        toneClasses[tone],
        className
      )}
    >
      {icon && <span className="inline-flex shrink-0 [&>svg]:size-2.5">{icon}</span>}
      {label}
    </span>
  );
}

export type MatchChipDef = {
  key: string;
  label: string;
  tone?: MatchChipTone;
  icon?: React.ReactNode;
};

export function MatchChipRow({ chips, className }: { chips: MatchChipDef[]; className?: string }) {
  if (chips.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {chips.map(chip => (
        <MatchChip key={chip.key} label={chip.label} icon={chip.icon} tone={chip.tone} />
      ))}
    </div>
  );
}
