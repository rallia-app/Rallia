import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';

import { AnalyticsInit } from '@/components/analytics-init';

import './globals.css';

// smoke-theme.css reads these as --smk-font-display / --smk-font-body.
const spaceGrotesk = Space_Grotesk({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const inter = Inter({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${inter.variable} smk min-h-[100svh]`}>
        <AnalyticsInit />
        {children}
      </body>
    </html>
  );
}
