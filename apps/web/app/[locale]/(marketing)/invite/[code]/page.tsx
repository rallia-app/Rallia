import { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createHash } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';

const APP_STORE_URL = 'https://apps.apple.com/app/rallia/idXXXXXXXXXX';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.rallia.app';

type Props = {
  params: Promise<{ code: string; locale: string }>;
};

function computeFingerprint(ip: string, userAgent: string): string {
  return createHash('sha256').update(`${ip}:${userAgent}`).digest('hex');
}

async function getInviter(code: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('profile')
    .select('first_name')
    .eq('referral_code', code.toUpperCase())
    .single();
  return data;
}

function isMobile(userAgent: string): 'ios' | 'android' | null {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return null;
}

async function logClick(code: string, fingerprint: string, ip: string, userAgent: string) {
  const supabase = createServiceRoleClient();
  await supabase.rpc('log_referral_click', {
    p_referral_code: code.toUpperCase(),
    p_device_fingerprint: fingerprint,
    p_ip_address: ip,
    p_user_agent: userAgent,
  });
}

async function logFingerprint(code: string, fingerprint: string, ip: string, userAgent: string) {
  const supabase = createServiceRoleClient();
  await supabase.rpc('log_referral_fingerprint', {
    p_referral_code: code.toUpperCase(),
    p_device_fingerprint: fingerprint,
    p_ip_address: ip,
    p_user_agent: userAgent,
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, locale } = await params;
  const inviter = await getInviter(code);
  const t = await getTranslations({ locale, namespace: 'invitePage' });

  const title = inviter?.first_name ? t('invitedBy', { name: inviter.first_name }) : t('title');

  return {
    title,
    description: t('description'),
    openGraph: {
      title,
      description: t('description'),
    },
  };
}

export default async function InvitePage({ params }: Props) {
  const { code, locale } = await params;
  const headersList = await headers();
  const userAgent = headersList.get('user-agent') ?? '';
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';

  const fingerprint = computeFingerprint(ip, userAgent);
  const platform = isMobile(userAgent);

  // Log click for all visitors (non-blocking)
  logClick(code, fingerprint, ip, userAgent).catch(() => {});

  if (platform === 'ios') {
    // Log fingerprint for iOS deferred deep linking
    logFingerprint(code, fingerprint, ip, userAgent).catch(() => {});
    redirect(APP_STORE_URL);
  }

  if (platform === 'android') {
    // Append referrer param for Play Install Referrer API
    const referrerParam = encodeURIComponent(`referral_code=${code.toUpperCase()}`);
    redirect(`${PLAY_STORE_URL}&referrer=${referrerParam}`);
  }

  const inviter = await getInviter(code);
  const t = await getTranslations({ locale, namespace: 'invitePage' });

  if (!inviter) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 w-full">
        <h1 className="text-2xl font-bold">{t('notFound')}</h1>
        <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      </div>
    );
  }

  const inviteUrl = `https://rallia.app/invite/${code}`;
  const heading = inviter.first_name
    ? t('invitedBy', { name: inviter.first_name })
    : t('invitedByGeneric');

  return (
    <div className="flex flex-col items-center gap-8 py-16 w-full max-w-lg mx-auto animate-fade-in">
      <Image src="/rallia_logo_light.svg" alt="Rallia" width={140} height={40} priority />

      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">{heading}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
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
            src="/app-store-badge.svg"
            alt={t('appStore')}
            width={120}
            height={40}
            className="button-scale"
          />
        </a>
        <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
          <Image
            src="/google-play-badge.svg"
            alt={t('googlePlay')}
            width={135}
            height={40}
            className="button-scale"
          />
        </a>
      </div>
    </div>
  );
}
