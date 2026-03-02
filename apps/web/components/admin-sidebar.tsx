'use client';

import { ModeToggle } from '@/components/mode-toggle';
import ThemeLogo from '@/components/theme-logo';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, usePathname } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { syncLocaleToBackend } from '@/lib/sync-locale';
import { cn } from '@/lib/utils';
import { useAuth } from '@rallia/shared-hooks';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Globe,
  LayoutDashboard,
  LogOut,
  Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import { useSidebar } from './sidebar-context';

const locales = [
  { code: 'en-US', name: 'English', short: 'EN' },
  { code: 'fr-CA', name: 'Français', short: 'FR' },
] as const;

export function AdminSidebar() {
  const t = useTranslations('admin.sidebar');
  const tApp = useTranslations('app');
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const { signOut } = useAuth({ client: supabase });
  const { isCollapsed, toggleCollapse } = useSidebar();
  const [isPending, startTransition] = useTransition();

  const handleSignOut = async () => {
    await signOut();
    router.push('/admin/sign-in');
    router.refresh();
  };

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

  const navItems = [
    {
      href: '/admin/dashboard',
      label: t('dashboard'),
      icon: LayoutDashboard,
      exactMatch: true,
    },
    {
      href: '/admin/organizations',
      label: t('organizations'),
      icon: Building2,
      exactMatch: false,
    },
    {
      href: '/admin/users',
      label: t('users'),
      icon: Users,
      exactMatch: false,
    },
  ];

  const currentLocale = locales.find(l => l.code === locale) || locales[0];

  return (
    <aside
      className={cn(
        'border-r border-border bg-card h-screen sticky top-0 flex flex-col overflow-hidden',
        'transition-all duration-200 ease-in-out',
        isCollapsed ? 'w-[68px]' : 'w-60'
      )}
    >
      {/* Logo/Brand */}
      <div
        className={cn(
          'border-b border-border flex items-center justify-center transition-all duration-200',
          isCollapsed ? 'px-3 py-4' : 'px-5 py-4'
        )}
      >
        {isCollapsed ? (
          <Link href="/admin/dashboard" className="flex items-center justify-center">
            <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="text-primary font-bold text-lg">RA</span>
            </div>
          </Link>
        ) : (
          <ThemeLogo href="/admin/dashboard" width={110} height={36} />
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = item.exactMatch
            ? pathname === item.href
            : pathname === item.href || pathname?.startsWith(item.href + '/');

          const linkContent = (
            <Link
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-150',
                'group relative',
                isCollapsed ? 'px-3 py-2.5 justify-center' : 'px-3 py-2.5',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
              )}
              <Icon
                className={cn(
                  'shrink-0 transition-transform duration-150',
                  isCollapsed ? 'size-5' : 'size-[18px]',
                  !isActive && 'group-hover:scale-105'
                )}
              />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );

          if (isCollapsed) {
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return <div key={item.href}>{linkContent}</div>;
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3 space-y-2">
        {/* Theme & Language Row */}
        <div
          className={cn('flex items-center gap-2', isCollapsed ? 'flex-col' : 'justify-between')}
        >
          {!isCollapsed && (
            <span className="text-xs text-muted-foreground font-medium">{tApp('nav.theme')}</span>
          )}
          <div className={cn('flex items-center gap-1', isCollapsed && 'flex-col')}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <ModeToggle />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">{tApp('nav.theme')}</TooltipContent>
              </Tooltip>
            ) : (
              <ModeToggle />
            )}

            {/* Language Toggle */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
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
                </TooltipTrigger>
                {isCollapsed && (
                  <TooltipContent side="right">
                    {currentLocale.name} ({currentLocale.short})
                  </TooltipContent>
                )}
              </Tooltip>
              <DropdownMenuContent align={isCollapsed ? 'center' : 'end'} side="top">
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
          </div>
        </div>

        <Separator className="my-2" />

        {/* Sign Out */}
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-full h-9 text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={handleSignOut}
              >
                <LogOut className="size-4" />
                <span className="sr-only">{tApp('nav.signOut')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{tApp('nav.signOut')}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted h-9"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 size-4" />
            {tApp('nav.signOut')}
          </Button>
        )}

        <Separator className="my-2" />

        {/* Collapse Toggle */}
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-full h-9 text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={toggleCollapse}
              >
                <ChevronRight className="size-4" />
                <span className="sr-only">Expand sidebar</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-between text-muted-foreground hover:text-foreground hover:bg-muted h-9"
            onClick={toggleCollapse}
          >
            <span className="text-xs">Collapse</span>
            <ChevronLeft className="size-4" />
          </Button>
        )}
      </div>
    </aside>
  );
}
