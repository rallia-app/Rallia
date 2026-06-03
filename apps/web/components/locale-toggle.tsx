'use client';

import { createClient } from '@/lib/supabase/client';
import { syncLocaleToBackend } from '@/lib/sync-locale';
import { usePathname } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useTransition } from 'react';
import { Button } from './ui/button';

const locales = [
  { code: 'en-US', short: 'EN', name: 'English' },
  { code: 'fr-CA', short: 'FR', name: 'Français' },
] as const;

type LocaleCode = (typeof locales)[number]['code'];

const BUTTON_CLASS =
  'h-8 px-2.5 text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground';

function LocaleToggleInner() {
  const locale = useLocale() as LocaleCode;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const supabase = useMemo(() => createClient(), []);

  const current = locales.find(l => l.code === locale) ?? locales[0];
  const next = locales.find(l => l.code !== current.code) ?? locales[1];

  const handleToggle = () => {
    startTransition(async () => {
      await syncLocaleToBackend(supabase, next.code);

      const pathWithoutLocale = pathname.startsWith('/') ? pathname : `/${pathname}`;
      const queryString = searchParams.toString();
      const queryPart = queryString ? `?${queryString}` : '';
      const newUrl = `/${next.code}${pathWithoutLocale}${queryPart}`;

      window.location.href = newUrl;
    });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className={BUTTON_CLASS}
      disabled={isPending}
      onClick={handleToggle}
      aria-label={`Switch language to ${next.name}`}
      title={`Switch to ${next.name}`}
    >
      {current.short}
    </Button>
  );
}

// Static placeholder shown in the prerendered shell (mirrors the button so
// there's no layout shift) until the interactive version hydrates.
function LocaleTogglePlaceholder() {
  const locale = useLocale() as LocaleCode;
  const current = locales.find(l => l.code === locale) ?? locales[0];
  return (
    <Button variant="ghost" size="sm" className={BUTTON_CLASS} disabled aria-hidden>
      {current.short}
    </Button>
  );
}

/**
 * useSearchParams() must sit under a Suspense boundary, otherwise Next bails the
 * whole surrounding page to client-side rendering and it can't be statically
 * prerendered. Wrapping here keeps every render site (headers, mobile nav) safe.
 */
export default function LocaleToggle() {
  return (
    <Suspense fallback={<LocaleTogglePlaceholder />}>
      <LocaleToggleInner />
    </Suspense>
  );
}
