import type { Metadata } from 'next';

import { AuthHeader } from '@/components/auth-header';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Sign-in chrome for the player app. Sits outside the (player) group because that
 * group's layout redirects unauthenticated visitors here — nesting them would loop.
 */
export default function PlayerAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <AuthHeader />
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
