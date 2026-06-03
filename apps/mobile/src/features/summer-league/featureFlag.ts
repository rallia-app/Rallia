/**
 * Feature flag for the Rallia Summer League announcement popup.
 *
 * Flip to `false` to stop showing the announcement (e.g. once we've collected
 * enough interest, or when the league launches and the messaging changes).
 * Mirrors the WEEKLY_CHECKIN_ENABLED pattern so the modal can be killed from a
 * single switch without touching the mount site.
 */
export const SUMMER_LEAGUE_ANNOUNCEMENT_ENABLED = true;
