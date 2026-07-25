import { getLocale } from 'next-intl/server';
import { UserRoundCheck } from 'lucide-react';

import { redirect } from '@/i18n/navigation';
import { AppStoreButtons } from '@/components/app-store-buttons';
import { EmptyState } from '@/components/app/primitives/empty-state';
import { getPlayerShellData } from '@/lib/supabase/check-player';
import { createClient } from '@/lib/supabase/server';

/**
 * Where the shell sends a signed-in player whose record is missing a name, a sport
 * or a location.
 *
 * Interim by design: the full resumable wizard (reusing the consent/personal/rating/
 * location steps from the web-join flow) lands with the onboarding-parity phase. Until
 * then this hands off to the app rather than dead-ending, because the guard redirects
 * here and a placeholder with no way out would trap the player.
 */
export default async function PlayerOnboardingPage() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The layout guard already ran; this only catches a direct hit after the record was
  // completed elsewhere (most likely in the app), so the player is not shown a wizard
  // for work they have already done.
  if (user) {
    const shellData = await getPlayerShellData(user.id);
    if (shellData.isOnboardingComplete) {
      redirect({ href: '/app', locale });
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Finish setting up</h1>
      <EmptyState
        icon={UserRoundCheck}
        title="Your profile needs a few more details"
        description="Pick your sport, add your level and set your area, and the app opens up. For now that setup lives in the Rallia app; it is coming to the web shortly."
        action={<AppStoreButtons />}
      />
    </div>
  );
}
