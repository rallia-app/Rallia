import { getLocale } from 'next-intl/server';

// next-intl's redirect keeps the caller's locale; next/navigation's would let the intl
// middleware re-prefix with the default one.
import { redirect } from '@/i18n/navigation';

/**
 * The Compete hub has no page of its own — it is a segmented control over
 * Tournaments | Leagues | Leaderboard, each a real route so every segment is linkable.
 * Landing on the hub picks the first segment.
 */
export default async function CompetePage() {
  const locale = await getLocale();
  redirect({ href: '/app/compete/tournaments', locale });
}
