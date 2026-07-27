'use client';

import {
  CalendarPlus,
  Trophy,
  UserRoundPlus,
  UsersRound,
  Medal,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { ResponsiveModal } from '@/components/ui/responsive-modal';
import { useRouter } from '@/i18n/navigation';

/**
 * The "+" action list — mobile's main-actions sheet as a plain controlled component.
 *
 * Deliberately not a global overlay manager: the web app's 41 existing dialogs all
 * take { open, onOpenChange } with parent state, and every destination here is a
 * route, so navigation (back button, refresh, deep links) does the heavy lifting.
 * Same items, order and copy as mobile's ActionsBottomSheet, via the `actions.*` keys.
 */
interface ActionItem {
  titleKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  href: string;
}

const ACTIONS: ActionItem[] = [
  {
    titleKey: 'invitePlayers',
    descriptionKey: 'invitePlayersDescription',
    icon: UserRoundPlus,
    href: '/app/invite',
  },
  {
    titleKey: 'createMatch',
    descriptionKey: 'createMatchDescription',
    icon: CalendarPlus,
    href: '/app/games/new',
  },
  {
    titleKey: 'createTournament',
    descriptionKey: 'createTournamentDescription',
    icon: Trophy,
    href: '/app/compete/tournaments',
  },
  {
    titleKey: 'createLeague',
    descriptionKey: 'createLeagueDescription',
    icon: Medal,
    href: '/app/compete/leagues',
  },
  {
    titleKey: 'createNetwork',
    descriptionKey: 'createNetworkDescription',
    icon: UsersRound,
    href: '/app/community',
  },
];

interface PlayerActionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlayerActionsModal({ open, onOpenChange }: PlayerActionsModalProps) {
  const t = useTranslations('actions');
  const tNav = useTranslations('navigation');
  const router = useRouter();

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} size="sm" title={tNav('create')}>
      <ul className="space-y-1">
        {ACTIONS.map(({ titleKey, descriptionKey, icon: Icon, href }) => (
          <li key={titleKey}>
            <button
              type="button"
              onClick={() => go(href)}
              className="flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-100)] dark:bg-[var(--primary-100)]/60">
                <Icon
                  className="size-5 text-[var(--primary-600)] dark:text-[var(--primary-500)]"
                  aria-hidden="true"
                />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{t(titleKey)}</span>
                <span className="block text-sm leading-snug text-muted-foreground">
                  {t(descriptionKey)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ResponsiveModal>
  );
}
