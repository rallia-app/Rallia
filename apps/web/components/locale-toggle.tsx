'use client';

import { createClient } from '@/lib/supabase/client';
import { syncLocaleToBackend } from '@/lib/sync-locale';
import { usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Globe } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

const locales = [
  { code: 'en-US', name: 'English', short: 'EN' },
  { code: 'fr-CA', name: 'Français', short: 'FR' },
] as const;

export default function LocaleToggle() {
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const supabase = useMemo(() => createClient(), []);

  const handleLocaleChange = (newLocale: string) => {
    if (newLocale === locale) return;

    startTransition(async () => {
      await syncLocaleToBackend(supabase, newLocale);

      const pathWithoutLocale = pathname.startsWith('/') ? pathname : `/${pathname}`;
      const queryString = searchParams.toString();
      const queryPart = queryString ? `?${queryString}` : '';
      const newUrl = `/${newLocale}${pathWithoutLocale}${queryPart}`;

      window.location.href = newUrl;
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          disabled={isPending}
        >
          <Globe className="size-4" />
          <span className="sr-only">Change language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map(loc => (
          <DropdownMenuItem
            key={loc.code}
            onClick={() => handleLocaleChange(loc.code)}
            className={cn('cursor-pointer', locale === loc.code && 'bg-accent font-medium')}
          >
            {loc.name}
            {locale === loc.code && <span className="ml-auto">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
