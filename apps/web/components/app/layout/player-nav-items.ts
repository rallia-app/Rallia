import { Home, MapPin, MessageCircle, Plus, Users, type LucideIcon } from 'lucide-react';

/**
 * The player app's navigation slots, in mobile's tab order:
 * Home / Courts / + / Community / Chat.
 *
 * One source for both the desktop sidebar and the mobile bottom bar, so the two can
 * never offer different destinations. Resisting the urge to add desktop-only entries
 * here is the point — mobile reaches Games, Compete, Bookings and Settings from Home
 * tiles and the header, and web does the same.
 *
 * Labels come from the existing `navigation` namespace in @rallia/shared-translations,
 * which mobile already uses, so the two apps read identically in both locales.
 */
export interface PlayerNavItem {
  /** `navigation.*` translation key. */
  labelKey: string;
  icon: LucideIcon;
  /** Absent for the action slot, which opens an overlay instead of navigating. */
  href?: string;
  /** The centre "+" slot, rendered as a button on mobile and a primary CTA on desktop. */
  isAction?: boolean;
}

export const PLAYER_NAV_ITEMS: PlayerNavItem[] = [
  { labelKey: 'home', icon: Home, href: '/app' },
  { labelKey: 'courts', icon: MapPin, href: '/app/courts' },
  { labelKey: 'create', icon: Plus, isAction: true },
  { labelKey: 'community', icon: Users, href: '/app/community' },
  { labelKey: 'chat', icon: MessageCircle, href: '/app/chat' },
];

/**
 * Whether a nav item should render as active for the current path.
 *
 * `/app` matches only itself; every other item matches its subtree, so
 * `/app/courts/123` still highlights Courts. Locale prefixes are already stripped by
 * next-intl's `usePathname`.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(`${href}/`);
}
