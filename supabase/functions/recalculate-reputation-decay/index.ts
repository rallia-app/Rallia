/**
 * recalculate-reputation-decay Edge Function
 *
 * Weekly batch job that applies time-based decay to reputation scores.
 * Older reputation events gradually lose their impact so players aren't
 * permanently penalized for a bad streak months ago.
 *
 * The SQL function `recalculate_player_reputation(target_player_id, apply_decay)`
 * already handles the decay math — this function simply identifies stale players
 * and invokes it with `apply_decay = true`.
 *
 * Triggered weekly by pg_cron (Sunday 3:00 AM UTC)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// CONFIGURATION
// =============================================================================

const BATCH_SIZE = 100;
const STALENESS_DAYS = 7;

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async req => {
  // Handle CORS preflight
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

  // Bearer auth with anon key (staging/prod). When no key is configured (e.g. local --no-verify-jwt), skip validation.
  const expectedAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (expectedAnonKey) {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== expectedAnonKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  console.log('Starting reputation decay recalculation job...');
  const startTime = Date.now();

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALENESS_DAYS);
    const cutoffISO = cutoff.toISOString();

    let totalProcessed = 0;
    let totalUpdated = 0;
    const errors: string[] = [];
    // Track players that failed so we can exclude them from subsequent queries
    // and avoid an infinite loop if the RPC consistently errors for a player.
    const failedPlayerIds = new Set<string>();

    // Loop in batches until no more stale players
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let query = supabase
        .from('player_reputation')
        .select('player_id')
        .or(`last_decay_calculation.is.null,last_decay_calculation.lt.${cutoffISO}`)
        .limit(BATCH_SIZE);

      // Exclude players that already failed in this run
      if (failedPlayerIds.size > 0) {
        const excludeIds = Array.from(failedPlayerIds);
        query = query.not('player_id', 'in', `(${excludeIds.join(',')})`);
      }

      const { data: players, error: fetchError } = await query;

      if (fetchError) {
        throw new Error(`Failed to fetch players: ${fetchError.message}`);
      }

      if (!players || players.length === 0) {
        break;
      }

      for (const player of players) {
        try {
          const { error: rpcError } = await supabase.rpc('recalculate_player_reputation', {
            target_player_id: player.player_id,
            apply_decay: true,
          });
          if (rpcError) {
            const msg = `Failed to recalculate for ${player.player_id}: ${rpcError.message}`;
            console.error(msg);
            errors.push(msg);
            failedPlayerIds.add(player.player_id);
          } else {
            totalUpdated++;
          }
        } catch (err) {
          const msg = `Failed to recalculate for ${player.player_id}: ${err instanceof Error ? err.message : err}`;
          console.error(msg);
          errors.push(msg);
          failedPlayerIds.add(player.player_id);
        }
        totalProcessed++;
      }

      console.log(`Processed batch of ${players.length} players (total: ${totalProcessed})`);

      // If we got fewer than BATCH_SIZE, there are no more
      if (players.length < BATCH_SIZE) {
        break;
      }
    }

    const summary = {
      success: true,
      playersProcessed: totalProcessed,
      playersUpdated: totalUpdated,
      errors: errors.length,
      duration_ms: Date.now() - startTime,
    };

    console.log(
      `Decay recalculation complete: ${totalUpdated}/${totalProcessed} updated, ${errors.length} errors`
    );

    return new Response(JSON.stringify(summary), {
      status: errors.length === totalProcessed && totalProcessed > 0 ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Reputation decay recalculation failed:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
