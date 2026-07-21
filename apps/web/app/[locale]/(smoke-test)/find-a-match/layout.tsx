import type { Locale } from '@rallia/shared-translations';
import { setRequestLocale } from 'next-intl/server';

import { SharedSupabaseSync } from '@/components/shared-supabase-sync';

import './smoke-theme.css';

export default async function FindAMatchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  return (
    <div className="smk min-h-[100svh]">
      <SharedSupabaseSync />
      {children}
    </div>
  );
}
