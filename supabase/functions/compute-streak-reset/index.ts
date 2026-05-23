/**
 * compute-streak-reset Edge Function
 *
 * Runs Monday at 02:00 UTC via pg_cron. Enforces the Option-C mercy mechanic:
 * for every player whose last_checkin_week_start < (last Monday), either:
 *
 *   1. Consume 1 freeze and PRESERVE the streak. Records a synthetic
 *      player_weekly_checkin row for the missed week with
 *      `freeze_consumed = true, frequency_goal = NULL`.
 *
 *   2. If no freezes available, RESET current_streak to 0.
 *
 * This is the ONLY writer that decrements freeze_inventory.
 *
 * Idempotency: skips rows whose `updated_at >= (last Monday)`, so re-running
 * the cron on the same data is a no-op.
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
// CONFIG
// =============================================================================

const PAGE_SIZE = 500;

// =============================================================================
// SUPABASE
// =============================================================================

const supabase: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
);

// =============================================================================
// HELPERS
// =============================================================================

/** ISO date string (YYYY-MM-DD) for a given UTC Date. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the current ISO week (UTC). */
function thisMondayUtc(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
}

/** Monday of last ISO week (UTC). */
function lastMondayUtc(): Date {
  const m = thisMondayUtc();
  return new Date(m.getTime() - 7 * 24 * 60 * 60 * 1000);
}

// =============================================================================
// CORE LOGIC
// =============================================================================

interface StreakRow {
  player_id: string;
  current_streak: number;
  freeze_inventory: number;
  last_checkin_week_start: string | null;
}

async function processStreakResets(): Promise<{
  processed: number;
  rescued: number;
  reset: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const thisMon = isoDate(thisMondayUtc());
  const lastMon = isoDate(lastMondayUtc());

  let processed = 0;
  let rescued = 0;
  let reset = 0;
  let lastSeenId = '';

  // Page through player_streak rows where the player missed last week.
  // Idempotent re-runs: filter `updated_at < thisMon` so rows we already
  // touched today are skipped.
  while (true) {
    const { data, error } = await supabase
      .from('player_streak')
      .select('player_id, current_streak, freeze_inventory, last_checkin_week_start, updated_at')
      .lt('last_checkin_week_start', lastMon)
      .lt('updated_at', `${thisMon}T00:00:00Z`)
      .gt('current_streak', 0)
      .gt('player_id', lastSeenId)
      .order('player_id', { ascending: true })
      .limit(PAGE_SIZE);

    if (error) {
      console.error('compute-streak-reset page query failed', error);
      errors.push(`page query: ${error.message}`);
      break;
    }

    const rows = (data ?? []) as Array<StreakRow & { updated_at: string }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        if (row.freeze_inventory > 0) {
          // Rescue path — consume 1 freeze, preserve the streak, record the
          // synthetic missed-week row. last_checkin_week_start advances to
          // lastMon so next week's check-in stays on the increment branch.
          const { error: streakErr } = await supabase
            .from('player_streak')
            .update({
              freeze_inventory: row.freeze_inventory - 1,
              last_checkin_week_start: lastMon,
              updated_at: new Date().toISOString(),
            })
            .eq('player_id', row.player_id);
          if (streakErr) throw streakErr;

          const { error: checkinErr } = await supabase.from('player_weekly_checkin').upsert(
            {
              player_id: row.player_id,
              week_start_date: lastMon,
              frequency_goal: null,
              sessions_played: null,
              freeze_consumed: true,
            },
            { onConflict: 'player_id,week_start_date' }
          );
          if (checkinErr) throw checkinErr;

          rescued += 1;
        } else {
          // No freeze — streak breaks.
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

    lastSeenId = rows[rows.length - 1].player_id;
    if (rows.length < PAGE_SIZE) break;
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
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
