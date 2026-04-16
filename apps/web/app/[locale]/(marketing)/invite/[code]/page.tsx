import { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  computeFingerprint,
  detectPlatform,
  logReferralClick,
  logReferralFingerprint,
  buildPlayStoreUrl,
  APP_STORE_URL,
} from '@/lib/referral-tracking';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { ClipboardDownloadButton } from './_components/clipboard-download-button';

type InvitationType = 'referral' | 'match' | 'group' | 'community' | 'flyer' | 'poster';

const PHYSICAL_CHANNEL_TYPES: readonly InvitationType[] = ['flyer', 'poster'] as const;
function isPhysicalChannel(type: InvitationType): boolean {
  return (PHYSICAL_CHANNEL_TYPES as readonly string[]).includes(type);
}

type Props = {
  params: Promise<{ code: string; locale: string }>;
  searchParams: Promise<{ type?: string; id?: string; share?: string }>;
};

async function getInviter(code: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('profile')
    .select('first_name')
    .eq('referral_code', code.toUpperCase())
    .single();
  return data;
}

async function getMatchDetails(matchId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (name),
      participants:match_participant!match_id (status)
    `
    )
    .eq('id', matchId)
    .single();
  return data;
}

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

function parseInvitationType(type?: string): InvitationType {
  if (type && ['match', 'group', 'community', 'referral', 'flyer', 'poster'].includes(type)) {
    return type as InvitationType;
  }
  return 'referral';
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { code, locale } = await params;
  const query = await searchParams;
  const invitationType = parseInvitationType(query.type);
  const t = await getTranslations({ locale, namespace: 'invitePage' });

  if (isPhysicalChannel(invitationType)) {
    const title = t('physicalTitle');
    return {
      title,
      description: t('physicalDescription'),
      openGraph: { title, description: t('physicalDescription'), type: 'website' },
      twitter: { card: 'summary_large_image', title, description: t('physicalDescription') },
    };
  }

  const inviter = await getInviter(code);

  let title: string;

  if (invitationType === 'match' && query.id) {
    const match = await getMatchDetails(query.id);
    const rawSport = match?.sport?.name;
    const sportName = rawSport ? rawSport.charAt(0).toUpperCase() + rawSport.slice(1) : 'a game';
    title = inviter?.first_name
      ? t('matchInviteTitle', { name: inviter.first_name, sport: sportName })
      : t('matchInviteTitleGeneric', { sport: sportName });
  } else if (invitationType === 'group' && query.id) {
    const group = await getGroupDetails(query.id);
    title = group?.name ? t('groupInviteTitle', { group: group.name }) : t('title');
  } else if (invitationType === 'community' && query.id) {
    const community = await getCommunityDetails(query.id);
    title = community?.name ? t('communityInviteTitle', { community: community.name }) : t('title');
  } else {
    title = inviter?.first_name ? t('invitedBy', { name: inviter.first_name }) : t('title');
  }

  return {
    title,
    description: t('description'),
    openGraph: { title, description: t('description'), type: 'website' },
    twitter: { card: 'summary_large_image', title, description: t('description') },
  };
}

export default async function InvitePage({ params, searchParams }: Props) {
  const { code, locale } = await params;
  const query = await searchParams;
  const invitationType = parseInvitationType(query.type);
  const targetId = query.id;

  const headersList = await headers();
  const userAgent = headersList.get('user-agent') ?? '';
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const acceptLanguage = headersList.get('accept-language') ?? '';

  const fingerprint = computeFingerprint(ip, userAgent, acceptLanguage);
  const platform = detectPlatform(userAgent);

  // Log click for all visitors (non-blocking)
  logReferralClick(code, fingerprint, ip, userAgent, invitationType, targetId).catch(() => {});

  // Log fingerprint for iOS deferred deep linking (fallback attribution)
  if (platform === 'ios') {
    logReferralFingerprint(code, fingerprint, ip, userAgent, invitationType, targetId).catch(
      () => {}
    );
  }

  if (platform === 'android') {
    redirect(buildPlayStoreUrl(code, invitationType, targetId));
  }

  // iOS + Desktop: show landing page (iOS gets clipboard CTA, desktop gets QR code)
  const t = await getTranslations({ locale, namespace: 'invitePage' });
  const isPhysical = isPhysicalChannel(invitationType);

  // Physical channels (flyer/poster) have no referring user — skip inviter lookup
  const inviter = isPhysical ? null : await getInviter(code);

  if (!isPhysical && !inviter) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 w-full">
        <h1 className="text-2xl font-bold">{t('notFound')}</h1>
        <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      </div>
    );
  }

  // Build the full invite URL preserving query params for the QR code
  let inviteUrl = `https://rallia.app/invite/${code}`;
  if (invitationType !== 'referral' || targetId) {
    const qsParams = new URLSearchParams();
    if (invitationType !== 'referral') qsParams.set('type', invitationType);
    if (targetId) qsParams.set('id', targetId);
    inviteUrl += `?${qsParams.toString()}`;
  }

  // Fetch contextual details for rich preview
  let contextHeading: string | null = null;
  let contextDescription: string | null = null;

  if (invitationType === 'match' && targetId) {
    const match = await getMatchDetails(targetId);
    if (match) {
      const rawSport = match.sport?.name;
      const sportName = rawSport ? rawSport.charAt(0).toUpperCase() + rawSport.slice(1) : 'a game';
      const [year, month, day] = (match.match_date as string).split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      const matchDate = dateObj.toLocaleDateString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const matchTime = match.start_time?.substring(0, 5) || '';
      const location = match.location_name || '';
      contextHeading = inviter?.first_name
        ? t('matchInviteHeading', { name: inviter.first_name, sport: sportName })
        : t('matchInviteHeadingGeneric', { sport: sportName });
      const parts = [`📅 ${matchDate}${matchTime ? ` ${t('at')} ${matchTime}` : ''}`];
      if (location) parts.push(`📍 ${location}`);
      contextDescription = parts.join(' · ');
    }
  } else if (invitationType === 'group' && targetId) {
    const group = await getGroupDetails(targetId);
    if (group) {
      contextHeading = t('groupInviteHeading', { group: group.name });
      contextDescription = group.description || null;
    }
  } else if (invitationType === 'community' && targetId) {
    const community = await getCommunityDetails(targetId);
    if (community) {
      contextHeading = t('communityInviteHeading', { community: community.name });
      contextDescription = community.description || null;
    }
  }

  const heading =
    contextHeading ||
    (isPhysical
      ? t('physicalHeading')
      : inviter?.first_name
        ? t('invitedBy', { name: inviter.first_name })
        : t('invitedByGeneric'));

  const fallbackDescription = isPhysical ? t('physicalDescription') : t('description');

  return (
    <div className="flex flex-col items-center gap-8 py-16 w-full max-w-lg mx-auto animate-fade-in">
      <Image src="/rallia_logo_light.svg" alt="Rallia" width={140} height={40} priority />

      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">{heading}</h1>
        {contextDescription ? (
          <p className="text-muted-foreground">{contextDescription}</p>
        ) : (
          <p className="text-muted-foreground">{fallbackDescription}</p>
        )}
      </div>

      {platform === 'ios' ? (
        <ClipboardDownloadButton
          inviteUrl={inviteUrl}
          appStoreUrl={APP_STORE_URL}
          label={t('downloadCta')}
          hint={t('clipboardHint')}
        />
      ) : (
        <>
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
              href={buildPlayStoreUrl(code, invitationType, targetId)}
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
        </>
      )}
    </div>
  );
}
