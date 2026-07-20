'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { appStoreClicked, courtsBookDialogViewed } from '@/lib/analytics';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-urls';

interface BookFacilityDialogProps {
  facilityId: string | null;
  facilityName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function BookFacilityDialog({
  facilityId,
  facilityName,
  open,
  onOpenChange,
}: BookFacilityDialogProps) {
  const t = useTranslations('courtsPage.bookDialog');

  useEffect(() => {
    if (open && facilityId) courtsBookDialogViewed({ facility_id: facilityId });
  }, [open, facilityId]);

  // Deep link straight to the facility in the app. /courts is deliberately
  // excluded from the app's universal-link (AASA) allowlist, so we encode the
  // `rallia://` scheme directly — the native camera opens the app to this
  // facility when it's installed; the store buttons cover the rest.
  const deepLink = facilityId ? `rallia://courts/${facilityId}?src=web_courts` : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {facilityName ? t('descriptionNamed', { name: facilityName }) : t('description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {deepLink && (
            <div className="rounded-xl bg-white p-4">
              <QRCodeSVG value={deepLink} size={200} level="M" />
            </div>
          )}
          <p className="text-center text-sm text-muted-foreground">{t('qrHint')}</p>
          <div className="flex items-center gap-3 pt-2">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                appStoreClicked({ store: 'app_store', placement: 'courts_book_dialog' })
              }
            >
              <img
                src="/app-store-badge-light.svg"
                alt="App Store"
                className="h-10 block dark:hidden"
              />
              <img src="/app-store-badge.svg" alt="App Store" className="h-10 hidden dark:block" />
            </a>
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                appStoreClicked({ store: 'play_store', placement: 'courts_book_dialog' })
              }
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
