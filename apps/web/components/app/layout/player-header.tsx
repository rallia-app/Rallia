'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bell, LogOut, Settings, UserRound } from 'lucide-react';
import { useAuth, useUnreadNotificationCount } from '@rallia/shared-hooks';

import { SportSwitcher } from './sport-switcher';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ThemeLogo from '@/components/theme-logo';
import { PlayerAvatar } from '@/components/app/primitives/player-avatar';
import { createClient } from '@/lib/supabase/client';

interface PlayerHeaderProps {
  userId: string;
  displayName: string | null;
  profilePictureUrl: string | null;
}

/**
 * Sticky top bar: avatar, sport switcher, notification bell, settings.
 * Same four affordances as mobile's header, in the same order.
 *
 * The logo only appears under lg, where the sidebar that normally carries it is gone.
 */
export function PlayerHeader({ userId, displayName, profilePictureUrl }: PlayerHeaderProps) {
  const t = useTranslations('navigation');
  const tAuth = useTranslations('auth');
  const locale = useLocale();
  const { data: unreadCount = 0 } = useUnreadNotificationCount(userId);

  const supabase = useMemo(() => createClient(), []);
  const { signOut } = useAuth({ client: supabase });
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      // Full navigation, not router.push: signing out is an auth transition, and a
      // client-side revalidate can serve a cached authenticated payload.
      window.location.assign(`/${locale}/app/sign-in`);
    } catch {
      setIsSigningOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur">
      <div className="lg:hidden">
        <ThemeLogo width={88} height={26} href="/app" />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <SportSwitcher />

        <Link
          href="/app/notifications"
          aria-label={t('notifications')}
          className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell className="size-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-0.5 -top-0.5 size-5 justify-center rounded-full p-0 text-[10px] tabular-nums"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Link>

        <Link
          href="/app/settings"
          aria-label={t('settings')}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-5" aria-hidden="true" />
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('profile')}
            className="ml-1 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <PlayerAvatar name={displayName} profilePictureUrl={profilePictureUrl} size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {displayName && (
              <DropdownMenuLabel className="truncate">{displayName}</DropdownMenuLabel>
            )}
            <DropdownMenuItem asChild>
              <Link href="/app/profile">
                <UserRound className="size-4" aria-hidden="true" />
                {t('profile')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/settings">
                <Settings className="size-4" aria-hidden="true" />
                {t('settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isSigningOut}
              onSelect={() => void handleSignOut()}
            >
              <LogOut className="size-4" aria-hidden="true" />
              {tAuth('signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
