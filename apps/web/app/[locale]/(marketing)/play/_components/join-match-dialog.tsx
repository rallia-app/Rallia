'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { appStoreClicked, joinMatchDialogViewed } from '@/lib/analytics';
import { APP_STORE_URL } from '@/lib/store-urls';
import { useAttributionHandoff } from '@/lib/use-attribution-handoff';
import { useAttributedPlayStoreUrl } from '@/lib/use-play-store-url';

interface JoinMatchDialogProps {
  matchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function JoinMatchDialog({ matchId, open, onOpenChange }: JoinMatchDialogProps) {
  const t = useTranslations('gamesPage.joinDialog');
  const locale = useLocale();
  const referral = matchId ? { type: 'match' as const, targetId: matchId } : undefined;
  // iOS clipboard token + Android install-referrer URL both carry the match
  // context so the install attributes on first launch.
  const writeClipboard = useAttributionHandoff(referral ? { referral } : {});
  const playStoreUrl = useAttributedPlayStoreUrl(referral);

  useEffect(() => {
    if (open && matchId) joinMatchDialogViewed({ match_id: matchId });
  }, [open, matchId]);

  // Universal link with tracking param — iOS/Android will open the app
  // directly if installed. UTM tags make the QR-scanned visit attributable
  // alongside other inbound channels.
  const matchUrl = matchId
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/${locale}/match/${matchId}?utm_source=qr&utm_medium=qr&utm_campaign=join_match`
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {matchUrl && (
            <div className="rounded-xl bg-white p-4">
              <QRCodeSVG value={matchUrl} size={200} level="M" />
            </div>
          )}
          <p className="text-sm text-muted-foreground text-center">{t('qrHint')}</p>
          <div className="flex items-center gap-3 pt-2">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                writeClipboard();
                appStoreClicked({
                  store: 'app_store',
                  placement: 'join_dialog',
                  ...(matchId ? { match_id: matchId } : {}),
                });
              }}
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
              onClick={() => {
                writeClipboard();
                appStoreClicked({
                  store: 'play_store',
                  placement: 'join_dialog',
                  ...(matchId ? { match_id: matchId } : {}),
                });
              }}
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
