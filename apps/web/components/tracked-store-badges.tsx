'use client';

import Image from 'next/image';

import { APP_STORE_URL } from '@/lib/store-urls';
import { appStoreClicked, type AppStorePlacement } from '@/lib/analytics';
import type { ReferralContext } from '@/lib/attribution-token';
import { useAttributionHandoff } from '@/lib/use-attribution-handoff';

/**
 * Tracked App Store / Play Store badge pair used on deep-link landings
 * (/match/[id], /invite/[code]) where the play store URL is per-page
 * (carries the install-referrer payload) and the iOS-only Play Store
 * suppression is controlled by the caller.
 *
 * The marketing AppStoreButtons component covers the simpler hero/footer
 * placements; this variant exists because those pages need a custom
 * `playStoreUrl` and conditional rendering tied to platform.
 */
export function TrackedStoreBadges({
  placement,
  playStoreUrl,
  hidePlayStore = false,
  appStoreLabel,
  playStoreLabel,
  matchId,
  invitationCode,
  referral,
}: {
  placement: AppStorePlacement;
  playStoreUrl: string;
  hidePlayStore?: boolean;
  appStoreLabel: string;
  playStoreLabel: string;
  matchId?: string;
  invitationCode?: string;
  /**
   * Referral context for the iOS clipboard handoff — when present, the
   * signed token carries it so the mobile app auto-attributes the invite
   * on first launch (no manual code entry needed in onboarding).
   */
  referral?: ReferralContext;
}) {
  const writeClipboard = useAttributionHandoff({ referral });
  return (
    <div className="flex gap-4">
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          writeClipboard();
          appStoreClicked({
            store: 'app_store',
            placement,
            ...(matchId ? { match_id: matchId } : {}),
            ...(invitationCode ? { invitation_code: invitationCode } : {}),
          });
        }}
      >
        <Image
          src="/app-store-badge-light.svg"
          alt={appStoreLabel}
          width={120}
          height={40}
          className="button-scale block dark:hidden"
        />
        <Image
          src="/app-store-badge.svg"
          alt={appStoreLabel}
          width={120}
          height={40}
          className="button-scale hidden dark:block"
        />
      </a>
      {!hidePlayStore && (
        <a
          href={playStoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            writeClipboard();
            appStoreClicked({
              store: 'play_store',
              placement,
              ...(matchId ? { match_id: matchId } : {}),
              ...(invitationCode ? { invitation_code: invitationCode } : {}),
            });
          }}
        >
          <Image
            src="/google-play-badge-light.svg"
            alt={playStoreLabel}
            width={135}
            height={40}
            className="button-scale block dark:hidden"
          />
          <Image
            src="/google-play-badge.svg"
            alt={playStoreLabel}
            width={135}
            height={40}
            className="button-scale hidden dark:block"
          />
        </a>
      )}
    </div>
  );
}
