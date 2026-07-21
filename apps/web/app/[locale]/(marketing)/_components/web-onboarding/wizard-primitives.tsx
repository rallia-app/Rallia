'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Link } from '@/i18n/navigation';
import { appStoreClicked, type AppStorePlacement } from '@/lib/analytics';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-urls';
import { cn } from '@/lib/utils';

export function StepHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" />
      </div>
      <div className="space-y-0.5">
        <h2 className="text-lg font-bold leading-tight tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground leading-snug">{description}</p>
      </div>
    </div>
  );
}

export function ConsentCheckboxRow({
  id,
  checked,
  onCheckedChange,
  prefix,
  linkLabel,
  suffix,
  href,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  prefix: string;
  linkLabel: string;
  suffix: string;
  href: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
        checked ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/30'
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={value => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <span className="text-sm leading-relaxed text-muted-foreground">
        {prefix}
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2"
        >
          {linkLabel}
        </Link>
        {suffix}
      </span>
    </label>
  );
}

export function OptionButton({
  selected,
  onClick,
  children,
  compact = false,
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  compact?: boolean;
  /** Needed when `children` is markup rather than a plain string. */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={ariaLabel}
      className={cn(
        'flex items-center justify-center rounded-xl border text-center font-medium transition-all duration-150 outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        compact ? 'px-2 py-2.5 text-xs' : 'px-3 py-3 text-sm',
        selected
          ? 'border-primary bg-primary/10 text-foreground shadow-sm ring-1 ring-primary/20'
          : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

export function Stepper({
  totalSteps,
  currentIndex,
  currentLabel,
  counterLabel,
}: {
  totalSteps: number;
  currentIndex: number;
  currentLabel: string;
  counterLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full bg-primary transition-all duration-500 ease-out',
                i <= currentIndex ? 'w-full' : 'w-0'
              )}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">{currentLabel}</span>
        <span className="text-muted-foreground">{counterLabel}</span>
      </div>
    </div>
  );
}

/** Store badges. `placement` and the optional ids feed the appStoreClicked event. */
export function AppStoreBadges({
  placement,
  matchId,
  facilityId,
}: {
  placement: AppStorePlacement;
  matchId?: string;
  facilityId?: string;
}) {
  const extra = {
    ...(matchId ? { match_id: matchId } : {}),
    ...(facilityId ? { facility_id: facilityId } : {}),
  };

  return (
    <div className="flex items-center gap-3">
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => appStoreClicked({ store: 'app_store', placement, ...extra })}
      >
        <img src="/app-store-badge-light.svg" alt="App Store" className="block h-10 dark:hidden" />
        <img src="/app-store-badge.svg" alt="App Store" className="hidden h-10 dark:block" />
      </a>
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => appStoreClicked({ store: 'play_store', placement, ...extra })}
      >
        <img
          src="/google-play-badge-light.svg"
          alt="Google Play"
          className="block h-10 dark:hidden"
        />
        <img src="/google-play-badge.svg" alt="Google Play" className="hidden h-10 dark:block" />
      </a>
    </div>
  );
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
