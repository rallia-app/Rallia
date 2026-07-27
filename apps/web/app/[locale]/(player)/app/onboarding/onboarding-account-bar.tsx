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
    <div className="flex min-w-0 items-center gap-2.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 backdrop-blur-sm">
      {/* The email is a luxury on a phone-width header; sign-out is not. */}
      <span
        className="hidden max-w-[11rem] truncate text-xs text-muted-foreground sm:block"
        title={email}
      >
        {email}
      </span>
      <MarketingSignOutButton
        className="shrink-0 text-xs"
        // Full navigation rather than the button's default router.refresh(): signing out
        // is an auth transition, and a client-side revalidate can serve a cached
        // authenticated payload — the same failure that stranded players on a blank
        // page after sign-in.
        onSignedOut={() => window.location.assign(`/${locale}/app/sign-in`)}
      />
    </div>
  );
}
