import { formatIntuitiveDateInTimezone, formatTimeInTimezone } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';

import type { TranslationOptions } from '#/hooks/useTranslation';

type Translate = (key: TranslationKey, options?: TranslationOptions) => string;

// Self-contained copy for the in-app nearby_match_available card, kept in lockstep
// with the lock-screen push renderer (supabase/functions/_shared/email-translations.ts).
// The notification row stores a single English fallback, so we re-render the card
// from its structured payload in the viewer's locale — the same reason the push is
// re-rendered server-side. Dates/times reuse the shared formatters so the card
// matches match cards exactly.
const STRINGS = {
  'en-US': {
    titleHost: '{hostName} wants to play near you',
    titleGeneric: 'New game near you',
    timeAt: ' at {time}',
    locationAt: ' at {location}',
    spots: '{count} spots left, tap to join!',
    spotsOne: '{count} spot left, tap to join!',
    cta: 'Tap to join!',
  },
  'fr-CA': {
    titleHost: '{hostName} veut jouer pas loin de toi',
    titleGeneric: 'Nouvelle partie pas loin de toi',
    timeAt: ' à {time}',
    locationAt: ', {location}',
    spots: '{count} places libres, clique pour embarquer!',
    spotsOne: '{count} place libre, clique pour embarquer!',
    cta: 'Clique pour embarquer!',
  },
} as const;

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

/**
 * Build the localized {title, body} for a nearby_match_available notification card
 * from its payload. Mirrors renderNearbyMatchPush: host-forward title, a short
 * when/where line, and a join CTA — with the sport as a capitalized leading word
 * only for multi-sport recipients (payload.showSport).
 */
export function renderNearbyMatchCard(
  payload: Record<string, unknown> | null | undefined,
  locale: string,
  t: Translate
): { title: string; body: string } {
  const isFr = locale.startsWith('fr');
  const s = isFr ? STRINGS['fr-CA'] : STRINGS['en-US'];

  const sportRaw = ((payload?.sportName as string | undefined) ?? '').trim();
  const showSport = payload?.showSport === true && sportRaw !== '';
  const hostName = (payload?.hostName as string | undefined)?.trim();
  const timezone = (payload?.timezone as string | undefined) || 'America/Toronto';

  const title = hostName ? fill(s.titleHost, { hostName }) : s.titleGeneric;

  const matchDate = (payload?.matchDate as string | undefined) ?? '';
  const startTime = (payload?.startTime as string | undefined) ?? '';

  let dateText = '';
  let dateRelative = false;
  if (matchDate) {
    const d = formatIntuitiveDateInTimezone(matchDate, timezone, locale);
    if (d.translationKey) {
      dateText = t(d.translationKey);
      dateRelative = true;
    } else {
      dateText = d.label;
    }
  }

  const timeFormatted =
    matchDate && startTime
      ? formatTimeInTimezone(matchDate, startTime, timezone, locale).formattedTime
      : '';
  const timeLabel = timeFormatted ? fill(s.timeAt, { time: timeFormatted }) : '';

  const location = (payload?.locationName as string | undefined)?.trim();
  const locationLabel = location ? fill(s.locationAt, { location }) : '';

  let whenWhere = `${dateText}${timeLabel}${locationLabel}`.replace(/^[\s,]+/, '').trim();

  // Lead with the sport for multi-sport recipients. FR date words are lowercase
  // mid-sentence, as are EN today/tomorrow; EN weekdays/dates keep their capital.
  if (showSport) {
    const lead = sportRaw.charAt(0).toUpperCase() + sportRaw.slice(1);
    if (whenWhere) {
      const lowerFirst = isFr || dateRelative;
      const tail = lowerFirst ? whenWhere.charAt(0).toLowerCase() + whenWhere.slice(1) : whenWhere;
      whenWhere = `${lead} ${tail}`;
    } else {
      whenWhere = lead;
    }
  }

  const spotsRaw = payload?.spotsLeft;
  const spots = typeof spotsRaw === 'number' ? spotsRaw : Number(spotsRaw);
  const cta =
    Number.isFinite(spots) && spots > 0
      ? fill(spots === 1 ? s.spotsOne : s.spots, { count: String(spots) })
      : s.cta;

  return { title, body: whenWhere ? `${whenWhere}. ${cta}` : cta };
}
