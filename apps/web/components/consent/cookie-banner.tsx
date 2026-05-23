'use client';

import { Cookie } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { useConsent } from './consent-provider';

export function CookieBanner() {
  const t = useTranslations('cookieConsent');
  const { consent, ready, acceptAll, rejectAll, openPreferences } = useConsent();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Mount the node once we know the user hasn't decided; then on the next
  // frame flip `visible` so the CSS transition runs. Without the double rAF
  // dance, React would render the final state on the very first paint and
  // the entrance animation would be skipped.
  useEffect(() => {
    if (!ready || consent !== null) {
      setMounted(false);
      setVisible(false);
      return;
    }
    setMounted(true);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
    return () => cancelAnimationFrame(id);
  }, [ready, consent]);

  const close = (action: () => void) => {
    if (leaving) return;
    setLeaving(true);
    setVisible(false);
    // Match the duration-300 below so the exit animation finishes before the
    // consent state mutates and removes us from the tree.
    setTimeout(() => {
      action();
      setLeaving(false);
    }, 250);
  };

  if (!mounted) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-body"
      aria-modal="false"
      className={[
        'fixed z-[100] pointer-events-none',
        'inset-x-2 bottom-2',
        'sm:inset-x-4 sm:bottom-4',
        'md:inset-x-auto md:right-6 md:bottom-6 md:left-6',
        'lg:left-auto lg:max-w-2xl',
      ].join(' ')}
    >
      <div
        className={[
          'pointer-events-auto',
          'rounded-2xl border border-border/60',
          'bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-xl',
          'shadow-2xl shadow-black/10 dark:shadow-black/40',
          'ring-1 ring-black/5 dark:ring-white/10',
          'transform transition-all duration-300 ease-out motion-reduce:transition-none',
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6',
        ].join(' ')}
      >
        <div className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-start md:gap-5">
          <div className="hidden sm:flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--secondary-500)]/10 text-[var(--secondary-500)] dark:bg-[var(--secondary-500)]/15">
            <Cookie className="size-5" aria-hidden="true" />
          </div>

          <div className="flex-1 min-w-0">
            <p id="cookie-banner-title" className="text-sm font-semibold leading-tight">
              {t('title')}
            </p>
            <p
              id="cookie-banner-body"
              className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground"
            >
              {t('body')}{' '}
              <Link
                href="/privacy"
                className="font-medium text-foreground/90 underline underline-offset-2 hover:text-foreground"
              >
                {t('learnMore')}
              </Link>
              .
            </p>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 md:flex md:flex-wrap md:items-center md:justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="sm:order-2 md:order-none"
                onClick={openPreferences}
              >
                {t('customize')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="sm:order-1 md:order-none"
                onClick={() => close(rejectAll)}
              >
                {t('rejectAll')}
              </Button>
              <Button
                size="sm"
                className="sm:order-3 md:order-none shadow-sm"
                onClick={() => close(acceptAll)}
              >
                {t('acceptAll')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
