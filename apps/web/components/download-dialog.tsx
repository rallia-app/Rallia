'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useEffect } from 'react';

import {
  appStoreClicked,
  downloadDialogViewed,
  type DownloadDialogPlacement,
} from '@/lib/analytics';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-urls';
import { useAttributionHandoff } from '@/lib/use-attribution-handoff';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placement: DownloadDialogPlacement;
}

export default function DownloadDialog({ open, onOpenChange, placement }: DownloadDialogProps) {
  const t = useTranslations('home.landing.downloadDialog');
  const writeClipboard = useAttributionHandoff();

  useEffect(() => {
    if (open) downloadDialogViewed({ placement });
  }, [open, placement]);

  // Tag the QR-scanned visit so it lands as utm_source=qr in PostHog/profile,
  // attributable just like any other inbound channel. The dialog-placement
  // context is preserved in utm_content for funnel slicing.
  const qrQuery = `utm_source=qr&utm_medium=qr&utm_campaign=download&utm_content=${placement}`;
  const qrUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}?${qrQuery}`
      : `https://rallia.app?${qrQuery}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="rounded-xl bg-white p-4">
            <QRCodeSVG value={qrUrl} size={200} level="M" />
          </div>
          <p className="text-sm text-muted-foreground text-center">{t('qrHint')}</p>
          <div className="flex items-center gap-3 pt-2">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                writeClipboard();
                appStoreClicked({ store: 'app_store', placement: 'download_dialog' });
              }}
            >
              <Image
                src="/app-store-badge-light.svg"
                alt="App Store"
                width={120}
                height={40}
                className="button-scale block dark:hidden"
              />
              <Image
                src="/app-store-badge.svg"
                alt="App Store"
                width={120}
                height={40}
                className="button-scale hidden dark:block"
              />
            </a>
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                writeClipboard();
                appStoreClicked({ store: 'play_store', placement: 'download_dialog' });
              }}
            >
              <Image
                src="/google-play-badge-light.svg"
                alt="Google Play"
                width={120}
                height={40}
                className="button-scale block dark:hidden"
              />
              <Image
                src="/google-play-badge.svg"
                alt="Google Play"
                width={120}
                height={40}
                className="button-scale hidden dark:block"
              />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
