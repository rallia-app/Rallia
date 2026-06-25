/**
 * Sport id helpers
 *
 * Onboarding screens render a hardcoded sport list the instant they mount and,
 * when the live sport-catalog fetch fails, keep synthetic placeholder ids of the
 * form `${slug}-fallback` (e.g. `tennis-fallback`). Those ids are display-only —
 * they must never reach a `sport_id` uuid column or Postgres rejects the whole
 * statement with `invalid input syntax for type uuid` (22P02). These helpers are
 * the single source of truth for minting and detecting those ids.
 */

/** Shape of a Postgres uuid; the only thing a `sport_id` column accepts. */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Suffix appended to a sport slug when a screen falls back to its local list. */
export const FALLBACK_SPORT_ID_SUFFIX = '-fallback';

/** True when `id` is a real DB uuid (vs a synthetic onboarding placeholder). */
export const isRealSportId = (id?: string | null): id is string => !!id && UUID_REGEX.test(id);

/** Build the synthetic placeholder id for a sport slug. */
export const makeFallbackSportId = (slug: string): string => `${slug}${FALLBACK_SPORT_ID_SUFFIX}`;

/** True when `id` is a synthetic placeholder minted by the fallback path. */
export const isFallbackSportId = (id?: string | null): boolean =>
  !!id && id.endsWith(FALLBACK_SPORT_ID_SUFFIX);

/** Recover the sport slug from a synthetic placeholder id, else null. */
export const fallbackSportSlug = (id?: string | null): string | null =>
  isFallbackSportId(id) ? id!.slice(0, -FALLBACK_SPORT_ID_SUFFIX.length) : null;
