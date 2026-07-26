import { CalendarSearch, MapPin, Medal, Trophy, type LucideIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

/**
 * The Play dispatch grid from specs/navigation-ia.
 *
 * Fixed 2×2, never a horizontal scroll — the IA calls that out explicitly because the
 * scrolling row it replaced pushed tiles 3 and 4 off screen on first render, so half
 * the app's entry points were invisible.
 *
 * `enabled: false` renders a tile as a disabled placeholder rather than hiding it, so
 * the grid keeps its shape as later phases land their destinations.
 */
interface PlayTile {
  labelKey: string;
  icon: LucideIcon;
  href: string;
  enabled: boolean;
}

const TILES: PlayTile[] = [
  { labelKey: 'findGame', icon: CalendarSearch, href: '/app/games/find', enabled: true },
  { labelKey: 'bookCourt', icon: MapPin, href: '/app/courts', enabled: true },
  { labelKey: 'tournaments', icon: Trophy, href: '/app/compete/tournaments', enabled: true },
  { labelKey: 'leagues', icon: Medal, href: '/app/compete/leagues', enabled: true },
];

export async function HomePlayGrid() {
  const t = await getTranslations('home.playGrid');

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-lg font-semibold text-foreground">{t('title')}</h2>

      <div className="grid grid-cols-2 gap-3">
        {TILES.map(({ labelKey, icon: Icon, href, enabled }) => {
          const body = (
            <>
              <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--primary-100)] dark:bg-[var(--primary-100)]/60">
                <Icon
                  className="size-5 text-[var(--primary-600)] dark:text-[var(--primary-500)]"
                  aria-hidden="true"
                />
              </span>
              <span className="text-sm font-medium">{t(labelKey)}</span>
            </>
          );

          return enabled ? (
            <Link
              key={labelKey}
              href={href}
              className="flex flex-col gap-3 rounded-lg border border-border p-4 text-foreground transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              {body}
            </Link>
          ) : (
            <div
              key={labelKey}
              aria-disabled="true"
              className="flex cursor-not-allowed flex-col gap-3 rounded-lg border border-dashed border-border p-4 text-muted-foreground opacity-60"
            >
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
