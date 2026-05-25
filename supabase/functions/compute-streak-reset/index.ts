/**
 * compute-streak-reset Edge Function
 *
 * Runs HOURLY via pg_cron. Enforces the Option-C mercy mechanic for every
 * player whose last_checkin_week_start is older than LAST MONDAY IN THEIR
 * LOCAL TIMEZONE. For each such player:
 *
 *   1. If freezes available → consume 1 freeze and PRESERVE the streak.
 *      Records a synthetic player_weekly_checkin row for the missed week
 *      with `freeze_consumed = true, frequency_goal = NULL`.
 *
 *   2. If no freezes available → RESET current_streak to 0.
 *
 * This is the ONLY writer that decrements freeze_inventory.
 *
 * Timezone awareness: the per-player "last Monday" is computed via the
 * `players_needing_streak_reset()` RPC, which uses `player.timezone`. This
 * matters because a Monday 2am UTC tick is still Sunday evening on the US
 * west coast — UTC-only logic would reset western players' streaks before
 * their Monday locally started.
 *
 * Cron cadence: hourly. Each player's local Monday rolls past 02:00 in their
 * timezone within a single 24-hour cycle, so an hourly tick covers every
 * timezone exactly once per week. Idempotency: the RPC's WHERE clause only
 * returns rows that genuinely haven't been advanced for this player's local
 * "last week", so re-running within the same tick is a no-op.
 *
 * ## Response Format
 * Success (200):
 *   { "success": true, "processed": N, "rescued": R, "reset": X, "duration_ms": ... }
 * Error (500):
 *   { "success": false, "error": "...", "duration_ms": ... }
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { requireSecretApikey } from '../_shared/auth.ts';
import { reportHeartbeat } from '../_shared/heartbeat.ts';

// =============================================================================
// SUPABASE
// =============================================================================

const supabase: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
);

// =============================================================================
// CORE LOGIC
// =============================================================================

interface PlayerNeedingReset {
  player_id: string;
  current_streak: number;
  freeze_inventory: number;
  last_checkin_week_start: string | null;
  /** ISO date of last Monday in the player's local timezone. */
  player_last_week: string;
}

async function processStreakResets(): Promise<{
  processed: number;
  rescued: number;
  reset: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processed = 0;
  let rescued = 0;
  let reset = 0;

  // The RPC does the heavy lifting: returns only players whose
  // last_checkin_week_start is strictly older than their personal last
  // Monday. So this set IS the work queue — no further filtering needed.
  const { data, error } = await supabase.rpc('players_needing_streak_reset');
  if (error) {
    console.error('players_needing_streak_reset RPC failed', error);
    return { processed: 0, rescued: 0, reset: 0, errors: [`rpc: ${error.message}`] };
  }

  const rows = (data ?? []) as PlayerNeedingReset[];

  for (const row of rows) {
    try {
      // Defensive guard — if the player_last_week is missing (shouldn't
      // happen) skip the row rather than silently overwriting with an
      // unexpected value.
      if (!row.player_last_week) {
        errors.push(`player ${row.player_id}: missing player_last_week`);
        continue;
      }

      if (row.freeze_inventory > 0) {
        // Rescue path — consume 1 freeze, preserve the streak, record the
        // synthetic missed-week row. last_checkin_week_start advances to the
        // player's local last Monday so next week's check-in stays on the
        // increment branch.
        const { error: streakErr } = await supabase
          .from('player_streak')
          .update({
            freeze_inventory: row.freeze_inventory - 1,
            last_checkin_week_start: row.player_last_week,
            updated_at: new Date().toISOString(),
          })
          .eq('player_id', row.player_id);
        if (streakErr) throw streakErr;

        const { error: checkinErr } = await supabase.from('player_weekly_checkin').upsert(
          {
            player_id: row.player_id,
            week_start_date: row.player_last_week,
            frequency_goal: null,
            sessions_played: null,
            freeze_consumed: true,
          },
          { onConflict: 'player_id,week_start_date' }
        );
        if (checkinErr) throw checkinErr;

        rescued += 1;
      } else {
        // No freeze — streak breaks. We leave last_checkin_week_start
        // untouched so the player's NEXT check-in starts a fresh streak
        // (`prev_last_week != prev_week` → resets to 1 in the RPC).
        const { error: resetErr } = await supabase
          .from('player_streak')
          .update({
            current_streak: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('player_id', row.player_id);
        if (resetErr) throw resetErr;

        reset += 1;
      }

      processed += 1;
    } catch (err) {
      errors.push(`player ${row.player_id}: ${err}`);
    }
  }

  return { processed, rescued, reset, errors };
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const authError = requireSecretApikey(req);
  if (authError) return authError;

  const startTime = Date.now();
  console.log('compute-streak-reset: starting');

  try {
    const result = await processStreakResets();

    const summary = {
      success: true,
      processed: result.processed,
      rescued: result.rescued,
      reset: result.reset,
      errors: result.errors,
      duration_ms: Date.now() - startTime,
    };

    console.log(
      `compute-streak-reset: processed=${result.processed} rescued=${result.rescued} reset=${result.reset}`
    );

    const status = result.errors.length > 0 && result.processed === 0 ? 500 : 200;
    if (status === 200) {
      await reportHeartbeat(Deno.env.get('BETTERSTACK_HEARTBEAT_COMPUTE_STREAK_RESET'));
    }

    return new Response(JSON.stringify(summary), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('compute-streak-reset failed', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
