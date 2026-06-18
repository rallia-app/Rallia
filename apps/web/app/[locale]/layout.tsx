import { ThemeProvider } from '@/components/theme-provider';
import { routing } from '@/i18n/routing';

import { getTranslations, type Locale as SharedLocale } from '@rallia/shared-translations';
import type { Metadata } from 'next';
import { getTranslations as getServerTranslations, setRequestLocale } from 'next-intl/server';
import { Locale, NextIntlClientProvider } from 'next-intl';
import { Inter, Outfit, Poppins, Space_Grotesk } from 'next/font/google';
import { notFound } from 'next/navigation';
import './globals.css';

import { AnalyticsRuntime } from '@/components/consent/analytics-runtime';
import { ConsentProvider } from '@/components/consent/consent-provider';
import { ConsentedVercelAnalytics } from '@/components/consent/consented-vercel-analytics';
import { CookieBanner } from '@/components/consent/cookie-banner';
import { CookiePreferencesDialog } from '@/components/consent/cookie-preferences-dialog';
import { ConsentedUtmCapture } from '@/components/consent/consented-utm-capture';
import { PostHogProvider } from '@/components/posthog-provider';
import {
  JsonLd,
  mobileApplicationJsonLd,
  organizationJsonLd,
  websiteJsonLd,
} from '@/components/json-ld';
import {
  SITE_NAME,
  SITE_URL,
  TWITTER_HANDLE,
  buildAlternates,
  ogAlternateLocales,
  ogLocale,
} from '@/lib/seo';

// Theme A: Court Classic - Outfit for headlines
const outfit = Outfit({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-outfit',
});

// Theme B: Energy & Trust - Poppins for headlines
const poppins = Poppins({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-poppins',
});

// Theme C: Minimal Sport - Space Grotesk for headlines
const spaceGrotesk = Space_Grotesk({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

// All themes use Inter for body text
const inter = Inter({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-inter',
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale: localeParam } = await params;
  const locale = localeParam as SharedLocale;
  const t = await getServerTranslations({ locale, namespace: 'seo.root' });

  const title = t('title');
  const description = t('description');
  const ogTitle = t('ogTitle');
  const ogDescription = t('ogDescription');

  return {
    title: {
      default: title,
      template: `%s | ${SITE_NAME}`,
    },
    description,
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME, url: SITE_URL }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    metadataBase: new URL(SITE_URL),
    alternates: buildAlternates('', locale),
    keywords: [
      'tennis matchmaking',
      'pickleball partners',
      'tennis scheduling',
      'find tennis partners',
      'tennis app',
      'pickleball app',
      'sports matchmaking',
      'tennis near me',
      'pickleball near me',
    ],
    openGraph: {
      type: 'website',
      locale: ogLocale(locale),
      alternateLocale: ogAlternateLocales(locale),
      url: `${SITE_URL}/${locale}`,
      title: ogTitle,
      description: ogDescription,
      siteName: SITE_NAME,
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
      creator: TWITTER_HANDLE,
      site: TWITTER_HANDLE,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      ],
      shortcut: '/favicon.ico',
      apple: '/apple-touch-icon.png',
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;

  // Validate locale
  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }

  // Enable static rendering: primes the locale so next-intl reads it instead of
  // request headers, which would otherwise force every page into dynamic mode.
  setRequestLocale(locale);

  // Get translations from shared package
  const messages = getTranslations(locale as SharedLocale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <JsonLd data={[organizationJsonLd, websiteJsonLd, ...mobileApplicationJsonLd]} />
      </head>
      <body
        className={`${outfit.variable} ${poppins.variable} ${spaceGrotesk.variable} ${inter.variable} antialiased flex min-h-screen flex-col bg-[var(--primary-50)] dark:bg-[var(--primary-900)]`}
      >
        <PostHogProvider>
          <ConsentProvider>
            <AnalyticsRuntime />
            <ConsentedVercelAnalytics />
            <ConsentedUtmCapture />
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <NextIntlClientProvider locale={locale} messages={messages}>
                {children}
                <CookieBanner />
                <CookiePreferencesDialog />
              </NextIntlClientProvider>
            </ThemeProvider>
          </ConsentProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
