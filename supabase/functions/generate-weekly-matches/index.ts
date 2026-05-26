/**
 * generate-weekly-matches Edge Function
 *
 * Creates the open, auto-generated matches that back the weekly check-in's
 * "auto-create" preference. Two entry points:
 *
 *   • Per-player (common path): the AFTER INSERT trigger on
 *     player_weekly_checkin POSTs `{ player_id }` right after a player's first
 *     check-in of the week → generate_weekly_matches_for_player.
 *   • All-players (manual/admin/backfill): an empty body sweeps everyone who
 *     checked in this week with auto_create on →
 *     generate_weekly_matches_for_all_players.
 *
 * All match-creation rules (opt-in gate, one-per-available-day, idempotency,
 * nearest-facility selection) live in the SQL RPCs. This function is a thin,
 * authenticated dispatcher.
 *
 * Auth: server-to-server only. Callers (DB trigger / pg_cron) must send the
 * secret key in the `apikey` header — validated by requireSecretApikey, which
 * fails closed (500 if unprovisioned, 401 on mismatch). No user-JWT path.
 *
 * ## Response Format
 * Success (200): { success, players_processed, total_matches_created, duration_ms }
 * Error (400):   { success: false, error: "Invalid player_id" }
 * Error (405):   { success: false, error: "Method not allowed" }
 * Error (500):   { success: false, error: "Internal server error", duration_ms }
 *   — internal error detail is logged server-side, never returned to the caller.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { requireSecretApikey } from '../_shared/auth.ts';

// =============================================================================
// SUPABASE
// =============================================================================

const supabase: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// RFC 4122 UUID shape — validates the trigger-supplied player_id before it
// reaches the RPC (whose `uuid` param would otherwise emit a Postgres parse
// error we don't want to surface).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Row shape returned by generate_weekly_matches_for_all_players. */
interface PlayerGenerationResult {
  player_id: string;
  player_name: string;
  matches_created: number;
}

// =============================================================================
// MAIN
// =============================================================================

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, apikey',
      },
    });
  }

  // Server-to-server auth: fails closed before any work happens.
  const authError = requireSecretApikey(req);
  if (authError) return authError;

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const startTime = Date.now();

  // Optional body: { player_id?: string }. Absent/non-JSON body → all-players
  // sweep. A present-but-malformed player_id is rejected up front.
  let specificPlayerId: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.player_id === 'string') {
      specificPlayerId = body.player_id;
    }
  } catch {
    // No body / not JSON → treat as the all-players sweep.
  }

  if (specificPlayerId !== null && !UUID_RE.test(specificPlayerId)) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid player_id' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    let playersProcessed = 0;
    let totalMatchesCreated = 0;

    if (specificPlayerId) {
      console.log(`[generate-weekly-matches] player ${specificPlayerId}`);

      const { data: matches, error } = await supabase.rpc('generate_weekly_matches_for_player', {
        p_player_id: specificPlayerId,
      });
      if (error) throw error;

      playersProcessed = 1;
      totalMatchesCreated = matches?.length ?? 0;
    } else {
      console.log('[generate-weekly-matches] all checked-in players');

      const { data, error } = await supabase.rpc('generate_weekly_matches_for_all_players');
      if (error) throw error;

      const rows = (data ?? []) as PlayerGenerationResult[];
      playersProcessed = rows.length;
      totalMatchesCreated = rows.reduce((sum, r) => sum + (r.matches_created ?? 0), 0);
    }

    console.log(
      `[generate-weekly-matches] done: players=${playersProcessed} ` +
        `matches=${totalMatchesCreated} in ${Date.now() - startTime}ms`
    );

    return new Response(
      JSON.stringify({
        success: true,
        players_processed: playersProcessed,
        total_matches_created: totalMatchesCreated,
        duration_ms: Date.now() - startTime,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (err) {
    // Log detail server-side; never leak internal/DB error text to the caller.
    console.error('[generate-weekly-matches] failed:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request (server-to-server: send the secret key in `apikey`):

  All checked-in players (auto_create only):
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-weekly-matches' \
    --header 'apikey: <SUPABASE_SECRET_KEYS.default>' \
    --header 'Content-Type: application/json' \
    --data '{}'

  A specific player (what the player_weekly_checkin INSERT trigger sends):
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-weekly-matches' \
    --header 'apikey: <SUPABASE_SECRET_KEYS.default>' \
    --header 'Content-Type: application/json' \
    --data '{"player_id": "your-player-uuid"}'

*/
