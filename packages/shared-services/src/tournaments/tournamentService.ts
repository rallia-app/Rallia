/**
 * Tournament Service
 *
 * Wraps the L&T Postgres RPCs. Each function maps 1:1 to a SECURITY DEFINER
 * RPC defined in supabase/migrations/20260510170002_*.sql onward.
 */

import type { Tables, Enums } from '@rallia/shared-types';

import { supabase } from '../supabase';

export type Tournament = Tables<'tournaments'>;

export interface CreateTournamentInput {
  name: string;
  sportId: string;
  maxParticipants: 4 | 8 | 16 | 32 | 64 | 128;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  description?: string;
  visibility?: Enums<'tournament_visibility'>;
  registrationMode?: Enums<'tournament_registration_mode'>;
  bracketType?: Enums<'bracket_type'>;
  matchFormat?: Enums<'match_format'>;
  entryFormat?: Enums<'entry_format'>;
  facilityId?: string;
  venueName?: string;
  networkId?: string;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
}

/**
 * Fetch a single tournament by ID. Returns null if not found or not visible
 * to the caller (RLS hides rows the caller doesn't have permission to see).
 */
export async function getTournament(tournamentId: string): Promise<Tournament | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found / RLS hidden
    throw new Error(error.message);
  }

  return data as Tournament;
}

/**
 * Create a draft tournament.
 *
 * Throws if the caller doesn't play the requested sport, the network
 * isn't a community, or the rate limit is exceeded.
 */
export async function createTournament(input: CreateTournamentInput): Promise<Tournament> {
  const { data, error } = await supabase.rpc('tournament_create', {
    p_name: input.name,
    p_sport_id: input.sportId,
    p_max_participants: input.maxParticipants,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_description: input.description,
    p_visibility: input.visibility,
    p_registration_mode: input.registrationMode,
    p_bracket_type: input.bracketType,
    p_match_format: input.matchFormat,
    p_entry_format: input.entryFormat,
    p_facility_id: input.facilityId,
    p_venue_name: input.venueName,
    p_network_id: input.networkId,
    p_registration_opens_at: input.registrationOpensAt,
    p_registration_closes_at: input.registrationClosesAt,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Tournament;
}
