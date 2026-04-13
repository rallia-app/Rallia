'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QRCodeSVG } from 'qrcode.react';
import { useLocale, useTranslations } from 'next-intl';

const APP_STORE_URL = 'https://apps.apple.com/app/rallia/id6760482014';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp';

interface JoinMatchDialogProps {
  matchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function JoinMatchDialog({ matchId, open, onOpenChange }: JoinMatchDialogProps) {
  const t = useTranslations('gamesPage.joinDialog');
  const locale = useLocale();

  // Build the match detail URL which handles mobile redirects server-side
  const matchUrl = matchId
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/${locale}/match/${matchId}?src=qr`
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
            <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
              <img
                src="/app-store-badge-light.svg"
                alt="App Store"
                className="h-10 block dark:hidden"
              />
              <img src="/app-store-badge.svg" alt="App Store" className="h-10 hidden dark:block" />
            </a>
            <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
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
