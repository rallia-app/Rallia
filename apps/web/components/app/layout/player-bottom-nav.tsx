'use client';

import { useTranslations } from 'next-intl';

import { PLAYER_NAV_ITEMS, isNavItemActive } from './player-nav-items';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * The under-lg tab bar. Mirrors mobile's bottom tabs slot for slot, including the
 * centre "+" that opens an overlay rather than navigating.
 */
export function PlayerBottomNav({ onAction }: { onAction: () => void }) {
  const t = useTranslations('navigation');
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('home')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur lg:hidden"
      // Home-indicator devices otherwise clip the last few pixels of the row.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch justify-around">
        {PLAYER_NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const label = t(item.labelKey);

          if (item.isAction) {
            return (
              <li key={item.labelKey} className="flex flex-1 justify-center">
                <button
                  type="button"
                  onClick={onAction}
                  aria-label={label}
                  className="my-2 flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95"
                >
                  <Icon className="size-6" aria-hidden="true" />
                </button>
              </li>
            );
          }

          const active = isNavItemActive(item.href!, pathname);
          return (
            <li key={item.labelKey} className="flex-1">
              <Link
                href={item.href!}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
