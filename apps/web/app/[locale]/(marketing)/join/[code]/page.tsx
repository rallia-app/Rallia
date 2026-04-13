import { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { detectPlatform, buildPlayStoreUrl, APP_STORE_URL } from '@/lib/referral-tracking';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';

type Props = {
  params: Promise<{ code: string; locale: string }>;
};

async function getGroupDetails(inviteCode: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('network')
    .select('name, description')
    .eq('invite_code', inviteCode.toUpperCase())
    .eq('network_type', 'group')
    .single();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, locale } = await params;
  const group = await getGroupDetails(code);
  const t = await getTranslations({ locale, namespace: 'invitePage' });

  const title = group?.name ? t('groupInviteTitle', { group: group.name }) : t('title');

  return {
    title,
    description: t('description'),
    openGraph: { title, description: t('description'), type: 'website' },
    twitter: { card: 'summary_large_image', title, description: t('description') },
  };
}

export default async function GroupJoinPage({ params }: Props) {
  const { code, locale } = await params;

  const headersList = await headers();
  const userAgent = headersList.get('user-agent') ?? '';
  const platform = detectPlatform(userAgent);

  if (platform === 'ios') {
    redirect(APP_STORE_URL);
  }

  if (platform === 'android') {
    redirect(buildPlayStoreUrl(undefined, 'group', code));
  }

  // Desktop: show landing page with QR code
  const group = await getGroupDetails(code);
  const t = await getTranslations({ locale, namespace: 'invitePage' });

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 w-full">
        <h1 className="text-2xl font-bold">{t('notFound')}</h1>
        <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      </div>
    );
  }

  const inviteUrl = `https://rallia.app/join/${code}`;
  const heading = t('groupInviteHeading', { group: group.name });

  return (
    <div className="flex flex-col items-center gap-8 py-16 w-full max-w-lg mx-auto animate-fade-in">
      <Image src="/rallia_logo_light.svg" alt="Rallia" width={140} height={40} priority />

      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">{heading}</h1>
        {group.description ? (
          <p className="text-muted-foreground">{group.description}</p>
        ) : (
          <p className="text-muted-foreground">{t('description')}</p>
        )}
      </div>

      <Card className="p-6">
        <CardContent className="flex flex-col items-center gap-4 p-0">
          <QRCodeSVG value={inviteUrl} size={200} level="M" />
          <p className="text-sm text-muted-foreground text-center">{t('scanQr')}</p>
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
          <Image
            src="/app-store-badge-light.svg"
            alt={t('appStore')}
            width={120}
            height={40}
            className="button-scale block dark:hidden"
          />
          <Image
            src="/app-store-badge.svg"
            alt={t('appStore')}
            width={120}
            height={40}
            className="button-scale hidden dark:block"
          />
        </a>
        <a
          href={buildPlayStoreUrl(undefined, 'group', code)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            src="/google-play-badge-light.svg"
            alt={t('googlePlay')}
            width={135}
            height={40}
            className="button-scale block dark:hidden"
          />
          <Image
            src="/google-play-badge.svg"
            alt={t('googlePlay')}
            width={135}
            height={40}
            className="button-scale hidden dark:block"
          />
        </a>
      </div>
    </div>
  );
}
