'use client';

import { useTranslations } from 'next-intl';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { PLAYER_NAV_ITEMS, isNavItemActive } from './player-nav-items';

import { Link, usePathname } from '@/i18n/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/sidebar-context';
import ThemeLogo from '@/components/theme-logo';
import { cn } from '@/lib/utils';

/**
 * The lg-and-up rail. Same destinations as the bottom bar, laid out vertically —
 * the collapse behaviour and storage key are shared with the org and admin sidebars
 * via `sidebar-context`, so the three feel like one app.
 */
export function PlayerSidebar({ onAction }: { onAction: () => void }) {
  const t = useTranslations('navigation');
  const pathname = usePathname();
  const { isCollapsed, toggleCollapse } = useSidebar();

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 lg:flex',
        isCollapsed ? 'w-16' : 'w-60'
      )}
    >
      <div
        className={cn(
          'flex h-16 items-center border-b border-border px-3',
          isCollapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!isCollapsed && <ThemeLogo width={96} height={28} href="/app" />}
        <button
          type="button"
          onClick={toggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {isCollapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {PLAYER_NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          const active = item.href ? isNavItemActive(item.href, pathname) : false;

          const body = (
            <>
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              {!isCollapsed && <span className="truncate">{label}</span>}
            </>
          );

          const shared = cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isCollapsed && 'justify-center px-0'
          );

          const node = item.isAction ? (
            <button
              type="button"
              onClick={onAction}
              aria-label={label}
              className={cn(shared, 'bg-primary text-primary-foreground hover:bg-primary/90')}
            >
              {body}
            </button>
          ) : (
            <Link
              href={item.href!}
              aria-current={active ? 'page' : undefined}
              className={cn(
                shared,
                active
                  ? 'bg-muted text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {body}
            </Link>
          );

          // Collapsed, the label is gone, so the tooltip is the only affordance left.
          return isCollapsed ? (
            <Tooltip key={item.labelKey}>
              <TooltipTrigger asChild>{node}</TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ) : (
            <div key={item.labelKey}>{node}</div>
          );
        })}
      </nav>
    </aside>
  );
}
