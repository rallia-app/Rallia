/**
 * serie2Relevance — picks the ONE winner and the ONE Série 2 draw the
 * announcement shows a given player, instead of dumping the whole series.
 *
 * Relevant winner: the champion of the Série 1 draw the viewer entered
 * ('champion' when that is the viewer themselves, 'played' otherwise,
 * 'generic' when they sat the series out).
 *
 * Relevant draw, first match wins:
 *   1. same zone + category as the viewer's Série 1 draw, then same category
 *      (Montréal first — the regional grid only runs Intermédiaire);
 *   2. rating-band fit (the band is a hard gate at registration), nearest by
 *      player↔draw distance when both sides have coordinates, Montréal first
 *      otherwise;
 *   3. Montréal, then anything — pitching a maybe-wrong draw beats silence,
 *      and the detail screen states its own band.
 * Full draws are only considered when everything relevant is full.
 *
 * Pure module: no React, no I/O — the auto-opener feeds it fetched data.
 */
import type { Serie2AnnouncementDraw, Serie2AnnouncementParams } from './serie2AnnouncementTypes';

/** The shape of a champions-RPC row this module actually reads. */
export interface SeriesChampionInput {
  tournamentId: string;
  tournamentName: string;
  championName: string;
  championUserId: string;
  championPartnerUserId: string | null;
}

// Seeded names read 'Série 1 Montréal · Débutant' / 'Série 2 Rive-Sud ·
// Tennis · Intermédiaire' (data, not copy): drop the series prefix and the
// sport segment, keep 'Zone · Catégorie'.
export function drawLabel(name: string): string {
  return name
    .replace(/^Série \d+\s*/, '')
    .split(' · ')
    .filter(segment => segment !== 'Tennis')
    .join(' · ');
}

const CATEGORY_ORDER = ['Débutant', 'Intermédiaire', 'Avancé'];

function categoryRank(name: string): number {
  const i = CATEGORY_ORDER.findIndex(c => name.includes(c));
  return i === -1 ? CATEGORY_ORDER.length : i;
}

function byCategoryThenName(a: string, b: string): number {
  return categoryRank(a) - categoryRank(b) || a.localeCompare(b);
}

function zoneOf(name: string): string | null {
  const first = name
    .replace(/^Série \d+\s*/, '')
    .split(' · ')[0]
    ?.trim();
  return first || null;
}

function categoryOf(name: string): string | null {
  return CATEGORY_ORDER.find(c => name.includes(c)) ?? null;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export interface SelectSerie2Input {
  champions: SeriesChampionInput[];
  draws: Serie2AnnouncementDraw[];
  /** Série 1 tournament ids the viewer holds an entry in. */
  myTournamentIds: string[];
  myUserId: string | null;
  /** The viewer's tennis rating value (null = unrated). */
  rating: number | null;
  latitude: number | null;
  longitude: number | null;
}

export function selectSerie2Announcement(
  input: SelectSerie2Input
): Serie2AnnouncementParams | null {
  const sorted = [...input.draws].sort((a, b) => byCategoryThenName(a.name, b.name));
  if (sorted.length === 0) return null;

  const open = sorted.filter(d => d.spotsLeft == null || d.spotsLeft > 0);
  const pool = open.length > 0 ? open : sorted;

  // A player can enter several categories; a draw they WON beats one they
  // merely played for both the headline and the featured-draw seed.
  const myRows = input.champions.filter(c => input.myTournamentIds.includes(c.tournamentId));
  const wonRow =
    (input.myUserId &&
      myRows.find(
        c => c.championUserId === input.myUserId || c.championPartnerUserId === input.myUserId
      )) ||
    null;
  const mine = wonRow ?? myRows[0] ?? null;
  const isChampion = !!wonRow;

  let featured: Serie2AnnouncementDraw | undefined;

  if (mine) {
    const zone = zoneOf(mine.tournamentName);
    const category = categoryOf(mine.tournamentName);
    if (category) {
      featured =
        (zone && pool.find(d => zoneOf(d.name) === zone && categoryOf(d.name) === category)) ||
        pool.find(d => categoryOf(d.name) === category && zoneOf(d.name) === 'Montréal') ||
        pool.find(d => categoryOf(d.name) === category);
    }
  }

  if (!featured && input.rating != null) {
    const rating = input.rating;
    const fits = pool.filter(
      d =>
        (d.minRating == null || rating >= d.minRating) &&
        (d.maxRating == null || rating <= d.maxRating)
    );
    if (fits.length > 0) {
      if (input.latitude != null && input.longitude != null) {
        const lat = input.latitude;
        const lng = input.longitude;
        const withCoords = fits.filter(d => d.latitude != null && d.longitude != null);
        if (withCoords.length > 0) {
          featured = withCoords.reduce((best, d) =>
            haversineKm(lat, lng, d.latitude as number, d.longitude as number) <
            haversineKm(lat, lng, best.latitude as number, best.longitude as number)
              ? d
              : best
          );
        }
      }
      featured ??= fits.find(d => zoneOf(d.name) === 'Montréal') ?? fits[0];
    }
  }

  featured ??= pool.find(d => zoneOf(d.name) === 'Montréal') ?? pool[0];

  return {
    variant: isChampion ? 'champion' : mine ? 'played' : 'generic',
    myDrawLabel: mine ? drawLabel(mine.tournamentName) : null,
    championName: mine?.championName ?? null,
    featured,
  };
}
