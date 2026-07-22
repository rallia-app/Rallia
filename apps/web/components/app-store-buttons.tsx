'use client';

import Image from 'next/image';

import { APP_STORE_URL } from '@/lib/store-urls';
import { appStoreClicked, type AppStorePlacement } from '@/lib/analytics';
import { useAttributionHandoff } from '@/lib/use-attribution-handoff';
import { useAttributedPlayStoreUrl } from '@/lib/use-play-store-url';
import { cn } from '@/lib/utils';

interface AppStoreButtonsProps {
  className?: string;
  badgeHeight?: number;
  appStoreUrl?: string;
  playStoreUrl?: string;
  placement?: AppStorePlacement;
  matchId?: string;
  invitationCode?: string;
}

export function AppStoreButtons({
  className,
  badgeHeight = 40,
  appStoreUrl = APP_STORE_URL,
  playStoreUrl,
  placement = 'hero',
  matchId,
  invitationCode,
}: AppStoreButtonsProps) {
  const badgeWidth = Math.round(badgeHeight * 3);
  const writeClipboard = useAttributionHandoff();
  // Default Play URL carries ph_did + first-touch UTM in the install
  // referrer; callers with richer context (landing pages) still override.
  const attributedPlayStoreUrl = useAttributedPlayStoreUrl();
  const resolvedPlayStoreUrl = playStoreUrl ?? attributedPlayStoreUrl;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <a
        href={appStoreUrl}
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
          alt="Download on the App Store"
          width={badgeWidth}
          height={badgeHeight}
          className="button-scale block dark:hidden"
        />
        <Image
          src="/app-store-badge.svg"
          alt="Download on the App Store"
          width={badgeWidth}
          height={badgeHeight}
          className="button-scale hidden dark:block"
        />
      </a>
      <a
        href={resolvedPlayStoreUrl}
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
          alt="Get it on Google Play"
          width={badgeWidth}
          height={badgeHeight}
          className="button-scale block dark:hidden"
        />
        <Image
          src="/google-play-badge.svg"
          alt="Get it on Google Play"
          width={badgeWidth}
          height={badgeHeight}
          className="button-scale hidden dark:block"
        />
      </a>
    </div>
  );
}
