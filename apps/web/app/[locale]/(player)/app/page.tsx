import { getTranslations } from 'next-intl/server';

import { HomePlayGrid } from './home-play-grid';
import { HomeUpNext } from './home-up-next';

/**
 * Home, built to the target IA in specs/navigation-ia: agenda first ("what's next for
 * me"), then dispatch.
 *
 * v0 of that hierarchy. The single priority banner slot, Just for you, Happening near
 * you and the favourites availability rail land as their data sources arrive; the
 * order here is already the target one, so those slot in rather than reshuffle it.
 */
export default async function HomePage() {
  const t = await getTranslations('navigation');

  return (
    <div className="space-y-8">
      {/* The shell header already brands the page; a visible H1 would just repeat it. */}
      <h1 className="sr-only">{t('home')}</h1>

      <HomeUpNext />
      <HomePlayGrid />
    </div>
  );
}
