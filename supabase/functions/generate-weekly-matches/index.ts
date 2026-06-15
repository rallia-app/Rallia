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
 * Match-creation rules (opt-in gate, one-per-available-day, idempotency,
 * court-optimized facility) live in the SQL RPCs. For the per-player path, this
 * function then layers AUTO-INVITE (best-effort): if the host opted into
 * auto_invite_players, it invites ALL eligible opponents
 * (get_auto_invite_candidates) to each created match, then sends each candidate
 * ONE localized digest notification per run (cooldown + weekly push cap;
 * capped candidates keep their invites, silently). Invite failures never fail
 * generation.
 *
 * Auth: server-to-server only. Callers (DB trigger / pg_cron) must send the
 * secret key in the `apikey` header — validated by requireSecretApikey, which
 * fails closed (500 if unprovisioned, 401 on mismatch). No user-JWT path.
 *
 * ## Response Format
 * Success (200): { success, players_processed, total_matches_created, auto_invites_sent, duration_ms }
 * Error (400):   { success: false, error: "Invalid player_id" }
 * Error (405):   { success: false, error: "Method not allowed" }
 * Error (500):   { success: false, error: "Internal server error", duration_ms }
 *   — internal error detail is logged server-side, never returned to the caller.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { requireSecretApikey } from '../_shared/auth.ts';
import { captureEvent } from '../_shared/posthog.ts';

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

/** Row shape returned by generate_weekly_matches_for_player. */
interface GeneratedMatch {
  match_id: string;
  sport_name: string;
  match_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM:SS
  end_time: string;
  facility_name: string | null;
}

// =============================================================================
// AUTO-INVITE (invite-all + digest)
// Layered onto auto-created matches: invite EVERY eligible opponent (ranked by
// get_auto_invite_candidates) to every created match and let candidates
// self-select. Anti-spam lives at the PUSH layer, not the row layer: each
// candidate gets at most ONE digest notification per generation run ("X just
// checked in — N matches could interest you"), under a cooldown + weekly cap.
// Invite rows past the cap are still created and surface silently in the
// app's My Matches. Best-effort — failures here never fail match generation.
// =============================================================================

const MAX_INVITES_PER_MATCH = 50; // safety bound passed to the RPC, not a targeting knob
const DIGEST_COOLDOWN_HOURS = 12; // min gap between digest pushes to one player
const DIGEST_WEEKLY_CAP = 4; // max digest pushes per player per rolling 7 days

async function getUserLocale(userId: string): Promise<string> {
  const { data } = await supabase
    .from('profile')
    .select('preferred_locale')
    .eq('id', userId)
    .maybeSingle();
  return data?.preferred_locale || 'en-US';
}

function formatMatchSlot(locale: string, m: GeneratedMatch): string {
  const fr = locale.startsWith('fr');
  const dateStr = new Date(`${m.match_date}T${m.start_time}`).toLocaleDateString(
    fr ? 'fr-CA' : 'en-US',
    { weekday: 'short', month: 'short', day: 'numeric' }
  );
  return `${dateStr} ${fr ? 'à' : 'at'} ${m.start_time.slice(0, 5)}`;
}

/** Single-match copy mirrors notifications.messages.match_invitation; 2+ matches get digest copy. */
function buildInviteText(
  locale: string,
  hostName: string,
  matches: GeneratedMatch[]
): { title: string; body: string } {
  const fr = locale.startsWith('fr');
  if (matches.length === 1) {
    const m = matches[0];
    const locStr = m.facility_name ? ` · ${m.facility_name}` : '';
    return fr
      ? {
          title: `${hostName} t'invite à une partie de ${m.sport_name}`,
          body: `${hostName} veut jouer le ${formatMatchSlot(locale, m)}${locStr}. Touche pour accepter.`,
        }
      : {
          title: `${hostName} invited you to a ${m.sport_name} game`,
          body: `${hostName} wants to play on ${formatMatchSlot(locale, m)}${locStr}. Tap to accept.`,
        };
  }
  const slots = matches
    .slice(0, 3)
    .map(m => `${m.sport_name} ${formatMatchSlot(locale, m)}`)
    .join(' · ');
  const more = matches.length > 3 ? '…' : '';
  return fr
    ? {
        title: `${hostName} a confirmé ses disponibilités`,
        body: `${matches.length} parties pourraient t'intéresser : ${slots}${more}. Touche pour voir la première.`,
      }
    : {
        title: `${hostName} just checked in`,
        body: `${matches.length} matches could interest you: ${slots}${more}. Tap to see the first one.`,
      };
}

/**
 * Push-layer anti-spam: at most one digest per cooldown window and per-week
 * cap, counted from prior auto-invite notifications (payload.digest = true).
 * Suppressed candidates keep their invite rows — they just get no push.
 */
async function shouldSendDigest(playerId: string): Promise<boolean> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('notification')
    .select('created_at')
    .eq('user_id', playerId)
    .eq('type', 'match_invitation')
    .contains('payload', { digest: true })
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn(`[auto-invite] digest-cap lookup failed for ${playerId}: ${error.message}`);
    return true; // fail open: a duplicate push beats a silent system
  }
  const recent = data ?? [];
  if (recent.length >= DIGEST_WEEKLY_CAP) return false;
  const newest = recent[0]?.created_at;
  if (newest && Date.now() - new Date(newest).getTime() < DIGEST_COOLDOWN_HOURS * 3600 * 1000) {
    return false;
  }
  return true;
}

/** Returns the number of invite rows created. Gated on the host's auto_invite_players. */
async function autoInviteForMatches(hostId: string, matches: GeneratedMatch[]): Promise<number> {
  if (matches.length === 0) return 0;

  const { data: pref } = await supabase
    .from('player_check_in_preferences')
    .select('auto_invite_players')
    .eq('player_id', hostId)
    .maybeSingle();
  if (!pref?.auto_invite_players) return 0;

  const { data: hostProfile } = await supabase
    .from('profile')
    .select('display_name, first_name, last_name')
    .eq('id', hostId)
    .maybeSingle();
  const hostName =
    (hostProfile?.first_name && hostProfile?.last_name
      ? `${hostProfile.first_name} ${hostProfile.last_name}`
      : hostProfile?.first_name) ||
    hostProfile?.display_name ||
    'A player';

  // Phase 1 — create invite rows: every eligible candidate on every match.
  const invitesByCandidate = new Map<string, GeneratedMatch[]>();
  let invited = 0;
  for (const m of matches) {
    const { data: candidates, error: candErr } = await supabase.rpc('get_auto_invite_candidates', {
      p_match_id: m.match_id,
      p_max: MAX_INVITES_PER_MATCH,
    });
    if (candErr) {
      console.warn(`[auto-invite] candidates failed for ${m.match_id}: ${candErr.message}`);
      continue;
    }
    const ids: string[] = (candidates ?? []).map((c: { player_id: string }) => c.player_id);
    if (ids.length === 0) continue;
    if (ids.length >= MAX_INVITES_PER_MATCH) {
      console.warn(
        `[auto-invite] candidate pool truncated at ${MAX_INVITES_PER_MATCH} for ${m.match_id}`
      );
    }

    const { error: insErr } = await supabase.from('match_participant').upsert(
      ids.map(pid => ({
        match_id: m.match_id,
        player_id: pid,
        team_number: 2,
        is_host: false,
        status: 'pending',
      })),
      { onConflict: 'match_id,player_id', ignoreDuplicates: true }
    );
    if (insErr) {
      console.warn(`[auto-invite] invite insert failed for ${m.match_id}: ${insErr.message}`);
      continue;
    }

    for (const pid of ids) {
      const list = invitesByCandidate.get(pid) ?? [];
      list.push(m);
      invitesByCandidate.set(pid, list);
      // Analytics — keyed to the invitee so the invitation→join funnel is
      // per-recipient; host_id connects it back to the creator.
      void captureEvent({
        distinctId: pid,
        event: 'weekly_match_invite_sent',
        properties: {
          match_id: m.match_id,
          host_id: hostId,
          sport: m.sport_name,
          invite_mode: 'broadcast',
        },
      });
      invited += 1;
    }
  }

  // Phase 2 — one digest notification per candidate, soonest match as target
  // so the existing match_invitation tap-routing opens something actionable.
  for (const [pid, candidateMatches] of invitesByCandidate) {
    try {
      candidateMatches.sort((a, b) =>
        `${a.match_date}T${a.start_time}`.localeCompare(`${b.match_date}T${b.start_time}`)
      );
      const sendPush = await shouldSendDigest(pid);
      if (sendPush) {
        const locale = await getUserLocale(pid);
        const { title, body } = buildInviteText(locale, hostName, candidateMatches);
        const target = candidateMatches[0];
        const { error: notifErr } = await supabase.rpc('insert_notification', {
          p_user_id: pid,
          p_type: 'match_invitation',
          p_target_id: target.match_id,
          p_title: title,
          p_body: body,
          p_payload: {
            digest: true,
            matchId: target.match_id,
            matchIds: candidateMatches.map(m => m.match_id),
            playerName: hostName,
            sportName: target.sport_name,
            matchDate: target.match_date,
          },
          p_priority: 'normal',
          p_scheduled_at: null,
          p_expires_at: null,
          p_organization_id: null,
        });
        if (notifErr) {
          console.warn(`[auto-invite] notify failed for ${pid}: ${notifErr.message}`);
        }
      }
      void captureEvent({
        distinctId: pid,
        event: 'checkin_digest_sent',
        properties: {
          host_id: hostId,
          match_count: candidateMatches.length,
          match_ids: candidateMatches.map(m => m.match_id),
          suppressed: !sendPush,
        },
      });
    } catch (digestErr) {
      console.warn(`[auto-invite] digest failed for ${pid}:`, digestErr);
    }
  }

  return invited;
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
    let autoInvitesSent = 0;

    if (specificPlayerId) {
      console.log(`[generate-weekly-matches] player ${specificPlayerId}`);

      const { data: matches, error } = await supabase.rpc('generate_weekly_matches_for_player', {
        p_player_id: specificPlayerId,
      });
      if (error) throw error;

      playersProcessed = 1;
      totalMatchesCreated = matches?.length ?? 0;

      // Best-effort auto-invite — never fail generation if inviting hiccups.
      try {
        autoInvitesSent = await autoInviteForMatches(
          specificPlayerId,
          (matches ?? []) as GeneratedMatch[]
        );
      } catch (inviteErr) {
        console.warn('[auto-invite] skipped due to error:', inviteErr);
      }

      // Analytics (host): per-match creation detail + a run summary that pairs
      // with the client's weekly_checkin_submitted to complete the host funnel.
      const generated = (matches ?? []) as GeneratedMatch[];
      for (const m of generated) {
        void captureEvent({
          distinctId: specificPlayerId,
          event: 'weekly_match_created',
          properties: {
            match_id: m.match_id,
            sport: m.sport_name,
            match_date: m.match_date,
            start_time: m.start_time,
            location_type: m.facility_name ? 'facility' : 'tbd',
            facility_name: m.facility_name,
            has_facility: !!m.facility_name,
          },
        });
      }
      void captureEvent({
        distinctId: specificPlayerId,
        event: 'weekly_matches_generated',
        properties: {
          matches_created: totalMatchesCreated,
          auto_invites_sent: autoInvitesSent,
          sports: [...new Set(generated.map(m => m.sport_name))],
        },
      });
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
        `matches=${totalMatchesCreated} invites=${autoInvitesSent} in ${Date.now() - startTime}ms`
    );

    return new Response(
      JSON.stringify({
        success: true,
        players_processed: playersProcessed,
        total_matches_created: totalMatchesCreated,
        auto_invites_sent: autoInvitesSent,
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
