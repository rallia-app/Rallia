/**
 * "Slice" — the standalone brand for the /find-a-match willingness-to-pay
 * smoke test. The test runs under its own identity so visitors evaluate
 * the offer on its own merits. Colors are hardcoded on purpose: the brand is
 * self-contained and never reads outside theme tokens.
 */
import type { CSSProperties } from 'react';

export const SMOKE_BRAND_NAME = 'Slice';

/** Contact + data-deletion inbox; deletion is email-only, there is no /erase flow. */
export const SMOKE_CONTACT_EMAIL = 'sliceapp29@gmail.com';

export const SMOKE_BRAND_COLORS = {
  ink: '#171a12',
  lime: '#d6f437',
  paper: '#f4f3ea',
} as const;

/** Square app-style logo mark: a ball sliced along the diagonal. */
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
      <rect x="0" y="0" width="40" height="40" rx="11" fill={SMOKE_BRAND_COLORS.ink} />
      {/* Upper-left half of the ball, nudged away from the cut. */}
      <path
        d="M13.4 26.6 A10 10 0 0 1 27.5 12.5 Z"
        fill={SMOKE_BRAND_COLORS.lime}
        transform="translate(-1.4 -1.4)"
      />
      {/* Lower-right half, nudged the other way. */}
      <path
        d="M13.4 26.6 A10 10 0 0 0 27.5 12.5 Z"
        fill={SMOKE_BRAND_COLORS.lime}
        transform="translate(1.4 1.4)"
      />
    </svg>
  );
}

/** Logo mark + wordmark, for the persistent flow header. */
export function SmokeBrandLockup({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <SmokeBrandMark className="h-7 w-7" />
      <span
        className="text-lg font-bold lowercase tracking-tight"
        style={{ fontFamily: 'var(--smk-font-display)', color: 'var(--smk-ink)' }}
      >
        {SMOKE_BRAND_NAME}
        <span style={{ color: 'var(--smk-lime-deep)' }}>.</span>
      </span>
    </span>
  );
}
