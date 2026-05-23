'use client';

import { createClient } from '@/lib/supabase/client';
import { syncLocaleToBackend } from '@/lib/sync-locale';
import { usePathname } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import { Button } from './ui/button';

const locales = [
  { code: 'en-US', short: 'EN', name: 'English' },
  { code: 'fr-CA', short: 'FR', name: 'Français' },
] as const;

type LocaleCode = (typeof locales)[number]['code'];

export default function LocaleToggle() {
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
      className="h-8 px-2.5 text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground"
      disabled={isPending}
      onClick={handleToggle}
      aria-label={`Switch language to ${next.name}`}
      title={`Switch to ${next.name}`}
    >
      {current.short}
    </Button>
  );
}
