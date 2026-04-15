import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-urls';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface AppStoreButtonsProps {
  className?: string;
  badgeHeight?: number;
  appStoreUrl?: string;
  playStoreUrl?: string;
}

export function AppStoreButtons({
  className,
  badgeHeight = 40,
  appStoreUrl = APP_STORE_URL,
  playStoreUrl = PLAY_STORE_URL,
}: AppStoreButtonsProps) {
  const badgeWidth = Math.round(badgeHeight * 3);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <a href={appStoreUrl} target="_blank" rel="noopener noreferrer">
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
      <a href={playStoreUrl} target="_blank" rel="noopener noreferrer">
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
