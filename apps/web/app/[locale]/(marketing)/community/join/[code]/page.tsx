import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { QRCodeSVG } from 'qrcode.react';

import { IOSCodeHandoff } from '../../../invite/[code]/_components/ios-code-handoff';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { logReferralClick, buildPlayStoreUrl, APP_STORE_URL } from '@/lib/referral-tracking';
import { getLandingContext } from '@/lib/landing-attribution';
import { Card, CardContent } from '@/components/ui/card';
import { TrackedStoreBadges } from '@/components/tracked-store-badges';
import { InviteLandingTracker } from '@/components/invite-landing-tracker';
import ThemeLogo from '@/components/theme-logo';

type Props = {
  params: Promise<{ code: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function getCommunityDetails(inviteCode: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('network')
    .select('name, description')
    .eq('invite_code', inviteCode.toUpperCase())
    .eq('network_type', 'community')
    .single();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, locale } = await params;
  const community = await getCommunityDetails(code);
  const t = await getTranslations({ locale, namespace: 'invitePage' });

  const title = community?.name
    ? t('communityInviteTitle', { community: community.name })
    : t('title');

  return {
    title,
    description: t('description'),
    robots: { index: false, follow: false },
    openGraph: { title, description: t('description'), type: 'website' },
    twitter: { card: 'summary_large_image', title, description: t('description') },
  };
}

export default async function CommunityJoinPage({ params, searchParams }: Props) {
  const { code, locale } = await params;
  const query = await searchParams;

  // Attribution: log click and detect platform
  const { platform, ip, userAgent, webDistinctId, utm } = await getLandingContext(query);

  // Log click for analytics (non-blocking, no referral code)
  logReferralClick('', ip, userAgent, 'community', code, webDistinctId, utm).catch(() => {});

  if (platform === 'android') {
    redirect(buildPlayStoreUrl(undefined, 'community', code, { webDistinctId, utm }));
  }

  // iOS + Desktop: show landing page (iOS gets clipboard CTA, desktop gets QR code)
  const community = await getCommunityDetails(code);
  const t = await getTranslations({ locale, namespace: 'invitePage' });

  if (!community) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 w-full">
        <h1 className="text-2xl font-bold">{t('notFound')}</h1>
        <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      </div>
    );
  }

  const inviteUrl = `https://rallia.app/community/join/${code}`;
  const heading = t('communityInviteHeading', { community: community.name });

  return (
    <div className="flex flex-col items-center gap-8 py-16 w-full max-w-lg mx-auto animate-fade-in">
      <InviteLandingTracker
        surface="community_join"
        invitationType="community"
        platform={platform ?? 'desktop'}
        code={code}
      />
      <ThemeLogo width={140} height={40} />

      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">{heading}</h1>
        {community.description ? (
          <p className="text-muted-foreground">{community.description}</p>
        ) : (
          <p className="text-muted-foreground">{t('description')}</p>
        )}
      </div>

      {platform === 'ios' ? (
        <IOSCodeHandoff
          code={code.toUpperCase()}
          appStoreUrl={APP_STORE_URL}
          downloadLabel={t('downloadCta')}
          codeLabel={t('iosCommunityCodeLabel')}
          codeHint={t('iosCommunityCodeHint')}
          copyLabel={t('iosCopyCode')}
          copiedLabel={t('iosCommunityCodeCopied')}
        />
      ) : (
        <>
          <Card className="p-6">
            <CardContent className="flex flex-col items-center gap-4 p-0">
              <QRCodeSVG value={inviteUrl} size={200} level="M" />
              <p className="text-sm text-muted-foreground text-center">{t('scanQr')}</p>
            </CardContent>
          </Card>

          <TrackedStoreBadges
            placement="invite_page"
            playStoreUrl={buildPlayStoreUrl(undefined, 'community', code, { webDistinctId, utm })}
            appStoreLabel={t('appStore')}
            playStoreLabel={t('googlePlay')}
            invitationCode={code}
            referral={{ type: 'community', targetId: code }}
          />
        </>
      )}
    </div>
  );
}
