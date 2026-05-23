'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/analytics', key: 'overview' },
  { href: '/admin/analytics/acquisition', key: 'acquisition' },
  { href: '/admin/analytics/invitations', key: 'invitations' },
  { href: '/admin/analytics/matches', key: 'matches' },
  { href: '/admin/analytics/users', key: 'users' },
] as const;

/**
 * Tab nav for the admin analytics surface. Uses next/link so each tab is a
 * real route — deep-linkable, browser back/forward works, sub-page state
 * resets cleanly. Visual style mirrors shadcn `<Tabs>`.
 */
export function AnalyticsTabsNav() {
  const t = useTranslations('admin.analytics.tabs');
  const pathname = usePathname();

  // Strip the locale prefix (e.g. "/en-US/admin/analytics/...") so matching
  // is locale-agnostic.
  const stripLocale = (p: string): string => p.replace(/^\/[a-z]{2}-[A-Z]{2}/, '') || '/';
  const current = stripLocale(pathname ?? '');

  return (
    <div className="border-b">
      <nav className="flex gap-1 -mb-px" aria-label="Analytics sections">
        {TABS.map(tab => {
          const active =
            tab.href === '/admin/analytics'
              ? current === '/admin/analytics'
              : current.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-3 py-2 text-sm border-b-2 transition-colors ${
                active
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
              }`}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
