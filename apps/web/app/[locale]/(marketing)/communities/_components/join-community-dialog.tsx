'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { APP_STORE_URL } from '@/lib/store-urls';
import { useAttributionHandoff } from '@/lib/use-attribution-handoff';
import { useAttributedPlayStoreUrl } from '@/lib/use-play-store-url';

interface JoinCommunityDialogProps {
  communityId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function JoinCommunityDialog({
  communityId,
  open,
  onOpenChange,
}: JoinCommunityDialogProps) {
  const t = useTranslations('communitiesPage.joinDialog');
  const referral = communityId ? { type: 'community' as const, targetId: communityId } : undefined;
  // iOS clipboard token + Android install-referrer URL both carry the
  // community context so the install attributes on first launch.
  const writeClipboard = useAttributionHandoff(referral ? { referral } : {});
  const playStoreUrl = useAttributedPlayStoreUrl(referral);

  // QR code links to App Store (no community-specific deep link available)
  const qrUrl = communityId ? APP_STORE_URL : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {qrUrl && (
            <div className="rounded-xl bg-white p-4">
              <QRCodeSVG value={qrUrl} size={200} level="M" />
            </div>
          )}
          <p className="text-sm text-muted-foreground text-center">{t('qrHint')}</p>
          <div className="flex items-center gap-3 pt-2">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => writeClipboard()}
            >
              <img
                src="/app-store-badge-light.svg"
                alt="App Store"
                className="h-10 block dark:hidden"
              />
              <img src="/app-store-badge.svg" alt="App Store" className="h-10 hidden dark:block" />
            </a>
            <a
              href={playStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => writeClipboard()}
            >
              <img
                src="/google-play-badge-light.svg"
                alt="Google Play"
                className="h-10 block dark:hidden"
              />
              <img
                src="/google-play-badge.svg"
                alt="Google Play"
                className="h-10 hidden dark:block"
              />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
