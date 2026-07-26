'use client';

import { useLocale } from 'next-intl';

import { MarketingSignOutButton } from '@/components/marketing-sign-out-button';

/**
 * Shows which account is being onboarded, with a way out.
 *
 * Onboarding renders chromeless — no nav, no header — so without this a player who
 * signed in with the wrong address has no escape but clearing cookies. Surfacing the
 * email is what makes the sign-out button meaningful: it answers "wrong account?"
 * before the player has to wonder.
 */
export function OnboardingAccountBar({ email }: { email: string }) {
  const locale = useLocale();

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-4 py-2.5">
      <span className="min-w-0 truncate text-sm text-muted-foreground" title={email}>
        {email}
      </span>
      <MarketingSignOutButton
        className="shrink-0"
        // Full navigation rather than the button's default router.refresh(): signing out
        // is an auth transition, and a client-side revalidate can serve a cached
        // authenticated payload — the same failure that stranded players on a blank
        // page after sign-in.
        onSignedOut={() => window.location.assign(`/${locale}/app/sign-in`)}
      />
    </div>
  );
}
