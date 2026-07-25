'use client';

import { useTranslations } from 'next-intl';
import { Bell, Settings } from 'lucide-react';
import { useUnreadNotificationCount } from '@rallia/shared-hooks';

import { SportSwitcher } from './sport-switcher';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import ThemeLogo from '@/components/theme-logo';
import { PlayerAvatar } from '@/components/app/primitives/player-avatar';

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
  const { data: unreadCount = 0 } = useUnreadNotificationCount(userId);

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

        <Link href="/app/profile" aria-label={t('profile')} className="ml-1 rounded-full">
          <PlayerAvatar name={displayName} profilePictureUrl={profilePictureUrl} size="sm" />
        </Link>
      </div>
    </header>
  );
}
