/**
 * Param shapes for the Série 2 announcement screen.
 *
 * A leaf module: navigation/types.ts imports these for the route's params, so
 * nothing here may import from navigation (or anything that does).
 */

/** How personal the announcement gets, from most to least. */
export type Serie2AnnouncementVariant = 'champion' | 'played' | 'generic';

/** One open Série 2 draw, with what the relevance ladder and the card need. */
export interface Serie2AnnouncementDraw {
  id: string;
  name: string;
  entryFeeCents: number;
  currency: string | null;
  registrationClosesAt: string | null;
  prizeMoneyCents: number | null;
  prizeIsProrated: boolean | null;
  prizeTopShareBps: number | null;
  minRating: number | null;
  maxRating: number | null;
  latitude: number | null;
  longitude: number | null;
  spotsLeft: number | null;
}

/** The precomputed content of the announcement: one winner, one draw. */
export interface Serie2AnnouncementParams {
  variant: Serie2AnnouncementVariant;
  /** 'Montréal · Intermédiaire' — the viewer's Série 1 draw (null = did not play). */
  myDrawLabel: string | null;
  /** Winner of the viewer's Série 1 draw (null = did not play). */
  championName: string | null;
  /** The one Série 2 draw the announcement features. */
  featured: Serie2AnnouncementDraw;
}
