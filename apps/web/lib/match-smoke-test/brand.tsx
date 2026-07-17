/**
 * PLACEHOLDER brand for the /find-a-match willingness-to-pay smoke test.
 *
 * The test runs under a neutral, non-Rallia identity so visitors evaluate the
 * offer on its own merits (and so results aren't skewed by Rallia recognition).
 * Everything here is a stand-in — swap SMOKE_BRAND_NAME and the mark below for
 * the final fictional brand once design signs off.
 */
import type { CSSProperties } from 'react';

export const SMOKE_BRAND_NAME = 'CourtMate';

/** Square app-style logo mark (self-contained SVG, theme-token colors). */
export function SmokeBrandMark({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label={SMOKE_BRAND_NAME}
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id="smokeBrandGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary-500)" />
          <stop offset="100%" stopColor="var(--secondary-500)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="40" height="40" rx="11" fill="url(#smokeBrandGradient)" />
      {/* Two rackets meeting — a "match" mark. */}
      <circle
        cx="20"
        cy="20"
        r="11.5"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        opacity="0.95"
      />
      <path
        d="M20 8.5 L20 31.5 M8.5 20 L31.5 20"
        stroke="white"
        strokeWidth="1.6"
        opacity="0.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Logo mark + wordmark, for the persistent flow header. */
export function SmokeBrandLockup({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <SmokeBrandMark className="h-7 w-7" />
      <span className="text-base font-bold tracking-tight text-foreground">{SMOKE_BRAND_NAME}</span>
    </span>
  );
}
