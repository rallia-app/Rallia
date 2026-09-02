/**
 * Which pairings an organizer can open, mirroring the guard in
 * `tournament_override_score`: every settled shape included, because a decision
 * the deadline ladder made has to stay reversible from the app.
 */

import type { Tables } from '@rallia/shared-types';

type Status = Tables<'tournament_matches'>['status'];

const ORGANIZER_ACTIONABLE = new Set<Status>([
  'pending',
  'in_progress',
  'disputed',
  'completed',
  'walkover',
  'retired',
  'cancelled',
]);

export const isOrganizerActionable = (status: Status): boolean => ORGANIZER_ACTIONABLE.has(status);

const SETTLED = new Set<Status>(['completed', 'retired', 'walkover', 'cancelled']);

/** A result is on the books, so opening it is a correction, not the next action. */
export const isSettled = (status: Status): boolean => SETTLED.has(status);
