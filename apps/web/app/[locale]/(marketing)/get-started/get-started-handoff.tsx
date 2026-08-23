'use client';

import { CheckCircle2, KeyRound, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';

import { IOSCodeHandoff } from '@/components/ios-code-handoff';
import { TrackedStoreBadges } from '@/components/tracked-store-badges';
import { Card, CardContent } from '@/components/ui/card';
import { APP_STORE_URL } from '@/lib/store-urls';
import { useAttributedPlayStoreUrl } from '@/lib/use-play-store-url';
import type { SignInProvider } from '@/lib/web-onboarding/sign-in-provider';

interface GetStartedHandoffProps {
  provider: SignInProvider;
  email: string | null;
  platform: 'ios' | 'android' | null;
  /** Store-or-app bouncer URL the desktop QR code points at. */
  installUrl: string;
  /** Referral code from the entry point, carried into the clipboard token and Play referrer. */
  referralCode?: string;
}

/**
 * The end of the web funnel. The account exists and is app-valid; what is left is the
 * install and one sign-in, so this page says exactly that and nothing else: store
 * badges (with the iOS clipboard token and the Android install referrer), the sign-in
 * method they just used so the second sign-in is a recognition, and a QR code on desktop.
 */
export function GetStartedHandoff({
  provider,
  email,
  platform,
  installUrl,
  referralCode,
}: GetStartedHandoffProps) {
  const t = useTranslations('webOnboarding.funnel');
  const tInvite = useTranslations('invitePage');

  const referral = referralCode ? { code: referralCode, type: 'referral' as const } : undefined;
  const playStoreUrl = useAttributedPlayStoreUrl(referral);

  const signInLine =
    provider === 'email'
      ? t('handoff.signIn.email', { email: email ?? '' })
      : provider === 'other'
        ? t('handoff.signIn.generic')
        : t(`handoff.signIn.${provider}`);

  return (
    <Card className="overflow-hidden border-primary/20">
      <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/50" />
      <CardContent className="flex flex-col items-center gap-6 px-6 pb-8 pt-8 text-center">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <div className="relative flex size-16 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="size-9 text-primary" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-bold tracking-tight">{t('handoff.title')}</h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {t('handoff.body')}
          </p>
        </div>

        <div className="flex w-full items-start gap-2.5 rounded-xl bg-muted/50 px-3.5 py-3 text-left">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-foreground">{signInLine}</p>
        </div>

        <div className="flex w-full flex-col items-center gap-4 rounded-2xl border bg-muted/30 px-6 py-6">
          {platform === 'ios' && referral ? (
            <IOSCodeHandoff
              code={referral.code}
              appStoreUrl={APP_STORE_URL}
              downloadLabel={tInvite('downloadCta')}
              codeLabel={tInvite('iosCodeLabel')}
              codeHint={tInvite('iosCodeHint')}
              copyLabel={tInvite('iosCopyCode')}
              copiedLabel={tInvite('iosCodeCopied')}
              referral={referral}
            />
          ) : (
            <>
              {platform === null && (
                <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                  <QRCodeSVG value={installUrl} size={172} level="M" />
                </div>
              )}
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Smartphone className="size-4 text-primary" aria-hidden="true" />
                {platform === null ? t('handoff.qrHint') : t('handoff.installHint')}
              </p>
              <TrackedStoreBadges
                placement="get_started"
                playStoreUrl={playStoreUrl}
                hidePlayStore={platform === 'ios'}
                appStoreLabel={tInvite('appStore')}
                playStoreLabel={tInvite('googlePlay')}
                {...(referral ? { invitationCode: referral.code, referral } : {})}
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
