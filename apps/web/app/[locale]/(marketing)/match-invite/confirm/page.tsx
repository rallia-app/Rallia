import { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    opponent?: string;
    facility?: string;
    sport?: string;
    date?: string;
    start_time?: string;
    end_time?: string;
    src?: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'inviteConfirmSheet' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Marketing fallback for the email's "Send invite" CTA.
 *
 * On a device with the Rallia app installed, the universal link opens the app
 * and the mobile MatchInviteConfirmSheet handles the flow. This page is the
 * fallback for desktop browsers and signed-out web — it surfaces the same
 * proposed slot and routes the user to the app to confirm.
 */
export default async function MatchInviteConfirmPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'inviteConfirmSheet' });

  // If essential params are missing, treat as expired/invalid.
  const valid = !!(sp.opponent && sp.facility && sp.sport && sp.date && sp.start_time);

  const summary = valid ? `${sp.date} · ${sp.start_time?.slice(0, 5)}` : null;

  // Universal-link URL — same path; the mobile linking parser intercepts on
  // installed devices. Desktop browsers stay on this page.
  const appLink = `https://rallia.app/${locale}/match-invite/confirm?${new URLSearchParams(
    sp as Record<string, string>
  ).toString()}`;

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t('title')}</h1>
        {valid && summary ? (
          <p className="mt-3 text-sm leading-relaxed text-neutral-600">
            {t('subtitle')}
            <br />
            <span className="font-medium text-neutral-900">{summary}</span>
          </p>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-neutral-600">{t('errorMessage')}</p>
        )}
        {valid && (
          <Link
            href={appLink}
            className="mt-6 inline-block rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700"
          >
            {t('confirmButton')}
          </Link>
        )}
      </div>
    </main>
  );
}
