/**
 * The format-neutral view of an event.
 *
 * Tournaments and leagues live in separate tables with different lifecycles.
 * Discovery does not care: it sorts, sections and filters one list. This maps
 * both onto the handful of fields that answer "can I join, when, and who is
 * in", and carries the original row along so a format's own card can render
 * the facts only that format has.
 *
 * Spec: specs/17-leagues-tournaments/formats/README.md
 */

import type { LeagueListItem } from '../leagues/leagueService';
import type { TournamentListItem } from '../tournaments/tournamentService';

/** Which creation flow and data model runs the format. */
export type EventEngine = 'tournament' | 'league';

/**
 * Lifecycle bucket shared by every format, ordered by how actionable it is.
 * Sections and the discovery cut both read this instead of the per-format
 * status enums.
 */
export type EventPhase = 'joinable' | 'startingSoon' | 'running' | 'closed';

interface EventCommon {
  id: string;
  name: string;
  sportId: string;
  organizerId: string;
  phase: EventPhase;
  /** Members or registrants currently counted in. */
  participantCount: number;
  /** Seats, where the format caps them. Leagues may run uncapped. */
  participantCap: number | null;
  minRating: number | null;
  maxRating: number | null;
  /** Free-text venue or city, for the search index. */
  locationLabel: string | null;
  /**
   * When the event next demands attention: a tournament's registration
   * deadline, else its start. Null for formats with no fixed date (leagues
   * schedule per season). Sorts the joinable section.
   */
  nextDeadline: string | null;
}

export type EventSummary = EventCommon &
  (
    | { engine: 'tournament'; tournament: TournamentListItem }
    | { engine: 'league'; league: LeagueListItem }
  );

/** Tournament statuses that never belong in discovery. */
const TOURNAMENT_HIDDEN = new Set(['draft', 'completed', 'cancelled', 'archived']);

function tournamentPhase(status: TournamentListItem['status']): EventPhase {
  if (status === 'registration_open') return 'joinable';
  if (status === 'registration_closed') return 'startingSoon';
  if (status === 'in_progress') return 'running';
  return 'closed';
}

/** Leagues have no registration window: an active league is joinable, and the
 *  join mode (open / approval / invite) decides how, which the card shows. */
function leaguePhase(status: LeagueListItem['status']): EventPhase {
  if (status === 'active') return 'joinable';
  if (status === 'paused') return 'startingSoon';
  return 'closed';
}

export function tournamentToEventSummary(tournament: TournamentListItem): EventSummary {
  return {
    engine: 'tournament',
    tournament,
    id: tournament.id,
    name: tournament.name,
    sportId: tournament.sport_id,
    organizerId: tournament.organizer_id,
    phase: tournamentPhase(tournament.status),
    participantCount: tournament.registration_count,
    participantCap: tournament.max_participants,
    minRating: tournament.min_rating,
    maxRating: tournament.max_rating,
    locationLabel: tournament.venue_name || tournament.city,
    nextDeadline: tournament.registration_closes_at ?? tournament.start_date,
  };
}

export function leagueToEventSummary(league: LeagueListItem): EventSummary {
  return {
    engine: 'league',
    league,
    id: league.id,
    name: league.name,
    sportId: league.sport_id,
    organizerId: league.organizer_id,
    phase: leaguePhase(league.status),
    participantCount: league.member_count,
    participantCap: league.member_capacity,
    minRating: league.min_rating,
    maxRating: league.max_rating,
    locationLabel: league.venue_name,
    nextDeadline: null,
  };
}

/** True when the event still has room, for the "open spots" filter. */
export function hasOpenSpots(event: EventSummary): boolean {
  if (event.phase !== 'joinable') return false;
  if (event.participantCap == null) return true;
  return event.participantCount < event.participantCap;
}

/** True when a rating sits inside the event's entry band. */
export function matchesRatingBand(event: EventSummary, rating: number | null): boolean {
  if (rating == null) return true;
  if (event.minRating != null && rating < Number(event.minRating)) return false;
  if (event.maxRating != null && rating > Number(event.maxRating)) return false;
  return true;
}

/** Discovery hides terminal events; My Events still lists them. */
export function isDiscoverable(event: EventSummary): boolean {
  if (event.engine === 'tournament' && TOURNAMENT_HIDDEN.has(event.tournament.status)) return false;
  return event.phase !== 'closed';
}
