/**
 * Decorative tennis-court line art for the sign-in hero panel.
 *
 * Stroke inherits currentColor so the parent sets both the colour and the opacity
 * with a text utility — it stays token-driven in both themes and never hardcodes
 * a hex value.
 */
export function CourtLines({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 780 360"
      fill="none"
      aria-hidden="true"
      className={className}
      // The court reads as background texture, not content.
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="2">
        {/* Outer doubles court */}
        <rect x="10" y="10" width="760" height="340" rx="2" />
        {/* Singles sidelines */}
        <line x1="10" y1="52" x2="770" y2="52" />
        <line x1="10" y1="308" x2="770" y2="308" />
        {/* Net */}
        <line x1="390" y1="10" x2="390" y2="350" strokeWidth="4" />
        {/* Service lines */}
        <line x1="215" y1="52" x2="215" y2="308" />
        <line x1="565" y1="52" x2="565" y2="308" />
        {/* Centre service line */}
        <line x1="215" y1="180" x2="565" y2="180" />
        {/* Centre marks on the baselines */}
        <line x1="10" y1="180" x2="24" y2="180" />
        <line x1="756" y1="180" x2="770" y2="180" />
      </g>
    </svg>
  );
}
