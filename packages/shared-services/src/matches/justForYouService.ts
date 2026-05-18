/**
 * Just-for-you service
 *
 * Single-round-trip wrapper around the `get_just_for_you` RPC. Replaces the
 * legacy `composeJustForYou` orchestration (matches via `getNearbyMatches`,
 * suggestions via `getTopSuggestions`, JS scoring + dedup) with one call.
 *
 * Anon callers (no `playerId`) fall through to `composeJustForYou` because the
 * RPC requires `p_caller_id` to compute the caller-scoped scoring CTEs
 * (effective rating, history, blocked, busy slots).
 */
import { supabase } from '../supabase';
import { composeJustForYou } from './justForYouComposer';
import type {
  ComposeJustForYouInput,
  ComposeJustForYouResult,
  JustForYouItem,
} from './justForYouComposer';
import type { Scorable } from './matchScoring';
import type { SlotSuggestion, SuggestionSlot } from './suggestionService';

/**
 * Row shape returned by the `get_just_for_you` RPC. The RPC returns each row
 * with either `match_payload` populated (kind='match') or `suggestion_payload`
 * populated (kind='suggestion'), never both.
 */
interface JustForYouRpcRow {
  kind: 'match' | 'suggestion';
  score: number;
  match_payload: Record<string, unknown> | null;
  suggestion_payload: Record<string, unknown> | null;
  player_compatibility: number | null;
  facility_affinity: number | null;
  score_history: number | null;
}

/**
 * SlotSuggestion's `slot.datetime` and `slot.endDatetime` are typed as `Date`,
 * but the RPC returns them as ISO timestamptz strings. Coerce on the way in so
 * downstream consumers (SuggestionCard, useSuggestionInviteHandler) see the
 * same shape the legacy composer produced.
 */
function hydrateSuggestion(payload: Record<string, unknown>): SlotSuggestion {
  const slot = payload.slot as { datetime: string; endDatetime: string; bookingUrl: string | null };
  const hydratedSlot: SuggestionSlot = {
    datetime: new Date(slot.datetime),
    endDatetime: new Date(slot.endDatetime),
    bookingUrl: slot.bookingUrl,
  };
  return { ...(payload as unknown as SlotSuggestion), slot: hydratedSlot };
}

export async function getJustForYou(
  input: ComposeJustForYouInput
): Promise<ComposeJustForYouResult> {
  // Anon fallback: the RPC needs a caller ID for the scoring CTEs. The legacy
  // composer handles both auth and anon paths; reuse it as the anon backstop.
  if (!input.playerId) {
    return composeJustForYou(input);
  }

  const { data, error } = await supabase.rpc('get_just_for_you', {
    p_caller_id: input.playerId,
    p_sport_id: input.sportId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_max_distance_km: input.maxDistanceKm,
    p_user_gender: input.userGender ?? null,
    p_limit: input.matchLimit ?? 5,
  });

  if (input.signal?.aborted) {
    return { items: [], matches: [], suggestions: [] };
  }
  if (error) {
    throw error;
  }

  const rows = (data ?? []) as JustForYouRpcRow[];

  const items: JustForYouItem[] = [];
  const matches: Scorable[] = [];
  const suggestions: SlotSuggestion[] = [];

  rows.forEach((row, index) => {
    if (row.kind === 'match' && row.match_payload) {
      const match = row.match_payload as unknown as Scorable;
      items.push({ kind: 'match', score: Number(row.score), data: match });
      matches.push(match);
    } else if (row.kind === 'suggestion' && row.suggestion_payload) {
      const suggestion = hydrateSuggestion(row.suggestion_payload);
      // Rank is 1-indexed and reflects position in the merged top-N
      // (mirrors pickTopGlobal's behavior in suggestionService.ts).
      suggestion.rank = index + 1;
      items.push({ kind: 'suggestion', score: Number(row.score), data: suggestion });
      suggestions.push(suggestion);
    }
  });

  return { items, matches, suggestions };
}
