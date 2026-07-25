import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Auth chrome for the player app. Sits outside the (player) group because that
 * group's layout redirects unauthenticated visitors here — nesting them would loop.
 *
 * Deliberately a passthrough: the sign-in page owns the whole viewport (split hero),
 * so any centering or width constraint here would fight it.
 */
export default function PlayerAuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
