import { PostHogPageview } from '@/components/posthog-pageview';
import { PostHogProvider } from '@/components/posthog-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { routing } from '@/i18n/routing';
import { getTranslations, type Locale as SharedLocale } from '@rallia/shared-translations';
import type { Metadata } from 'next';
import { Locale, NextIntlClientProvider } from 'next-intl';
import { Inter, Outfit, Poppins, Space_Grotesk } from 'next/font/google';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import './globals.css';

import { Analytics } from '@vercel/analytics/next';

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

export const metadata: Metadata = {
  title: 'Rallia - Tennis & Pickleball Matchmaking Platform | Coming Early 2026',
  description:
    'Join the waitlist for Rallia - the revolutionary platform connecting tennis and pickleball players. Smart matchmaking, instant scheduling, and reliable partners. Sign up for exclusive early access.',
  keywords: [
    'tennis matchmaking',
    'pickleball partners',
    'tennis scheduling',
    'find tennis partners',
    'tennis app',
    'pickleball app',
    'sports matchmaking',
  ],
  authors: [{ name: 'Rallia' }],
  creator: 'Rallia',
  metadataBase: new URL('https://rallia.app'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://rallia.app',
    title: 'Rallia - Where Rallies Live On',
    description:
      'Join the waitlist for the future of tennis and pickleball matchmaking. Smart player matching, instant scheduling, and reliable games.',
    siteName: 'Rallia',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Rallia - Tennis & Pickleball Matchmaking',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Rallia - Where Rallies Live On',
    description:
      'Join the waitlist for the future of tennis and pickleball matchmaking. Coming Early 2026.',
    images: ['/og-image.png'],
    creator: '@rallia',
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
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
};

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

  // Get translations from shared package
  const messages = getTranslations(locale as SharedLocale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head />
      <body
        className={`${outfit.variable} ${poppins.variable} ${spaceGrotesk.variable} ${inter.variable} antialiased flex min-h-screen flex-col bg-[var(--primary-50)] dark:bg-[var(--primary-900)]`}
      >
        <Analytics />
        <PostHogProvider>
          <Suspense>
            <PostHogPageview />
          </Suspense>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <NextIntlClientProvider locale={locale} messages={messages}>
              {children}
            </NextIntlClientProvider>
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
