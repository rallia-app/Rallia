/**
 * generate-weekly-matches Edge Function
 *
 * Creates the open, auto-generated matches that back the weekly check-in's
 * "auto-create" preference. Three entry points:
 *
 *   • Planned (new common path): record_weekly_checkin already created the
 *     matches the player CONFIRMED on the wizard's plan step and POSTs
 *     `{ player_id, matches: [...] }` — this function runs INVITE-ONLY,
 *     honoring each match's excluded_player_ids (people the player removed
 *     from the invite preview).
 *   • Legacy per-player: `{ player_id }` from clients that don't send a plan →
 *     generate_weekly_matches_for_player creates from saved availability.
 *   • All-players (manual/admin/backfill): an empty body sweeps everyone who
 *     checked in this week with auto_create on →
 *     generate_weekly_matches_for_all_players.
 *
 * Match-creation rules (opt-in gate, one-per-available-day, idempotency,
 * court-optimized facility) live in the SQL RPCs. For both per-player paths,
 * this function then layers AUTO-INVITE (best-effort): if the host opted into
 * auto_invite_players, it invites ALL eligible opponents
 * (get_auto_invite_candidates, minus any per-match exclusions) to each created
 * match, then sends each candidate ONE localized invite push for their EARLIEST
 * invited match (suppressed if they already got an auto check-in invite within
 * the cooldown; suppressed candidates keep their invites, silently). Invite
 * failures never fail generation.
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

/**
 * Match entry in a planned-checkin dispatch ({ player_id, matches }): the match
 * already exists (created by record_weekly_checkin) and carries the invitees
 * the player removed on the plan preview.
 */
interface PlannedMatchDispatch extends GeneratedMatch {
  excluded_player_ids?: string[];
}

// =============================================================================
// AUTO-INVITE (invite-all + single earliest-match push)
// Layered onto auto-created matches: invite EVERY eligible opponent (ranked by
// get_auto_invite_candidates) to every created match and let candidates
// self-select. Anti-spam lives at the PUSH layer, not the row layer: each
// candidate gets at most ONE invite push per generation run — for their
// EARLIEST invited match — and only if they haven't already received an auto
// check-in invite within the cooldown. Suppressed candidates still get their
// invite rows, which surface silently in the app's My Matches. Best-effort —
// failures here never fail match generation.
// =============================================================================

const MAX_INVITES_PER_MATCH = 50; // safety bound passed to the RPC, not a targeting knob
const CHECKIN_INVITE_COOLDOWN_HOURS = 6; // min gap between auto check-in invite pushes to one player

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

/** Single-match invite copy, mirroring notifications.messages.match_invitation. */
function buildInviteText(
  locale: string,
  hostName: string,
  m: GeneratedMatch
): { title: string; body: string } {
  const fr = locale.startsWith('fr');
  const slot = formatMatchSlot(locale, m);
  if (fr) {
    const where = m.facility_name ? ` à ${m.facility_name}` : '';
    return {
      title: `${hostName} t'invite à une partie de ${m.sport_name}`,
      body: `le ${slot}${where}. Touche pour accepter.`,
    };
  }
  const where = m.facility_name ? ` at ${m.facility_name}` : '';
  return {
    title: `${hostName} invited you to a ${m.sport_name} game`,
    body: `on ${slot}${where}. Tap to accept.`,
  };
}

/**
 * Push-layer anti-spam: at most one auto check-in invite push per cooldown
 * window, counted ONLY from prior auto check-in invites
 * (payload.source = 'weekly_checkin'). Manual invitations neither count here nor
 * are suppressed. Suppressed candidates keep their invite rows — no push.
 */
async function shouldSendCheckinInvite(playerId: string): Promise<boolean> {
  const since = new Date(Date.now() - CHECKIN_INVITE_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('notification')
    .select('id')
    .eq('user_id', playerId)
    .eq('type', 'match_invitation')
    .contains('payload', { source: 'weekly_checkin' })
    .gte('created_at', since)
    .limit(1);
  if (error) {
    console.warn(`[auto-invite] cooldown lookup failed for ${playerId}: ${error.message}`);
    return true; // fail open: a duplicate push beats a silent system
  }
  return (data ?? []).length === 0;
}

/** Returns the number of invite rows created. Gated on the host's auto_invite_players. */
async function autoInviteForMatches(
  hostId: string,
  matches: GeneratedMatch[],
  exclusionsByMatch?: Map<string, Set<string>>
): Promise<number> {
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
    const excluded = exclusionsByMatch?.get(m.match_id);
    const ids: string[] = (candidates ?? [])
      .map((c: { player_id: string }) => c.player_id)
      .filter((id: string) => !excluded?.has(id));
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
          invite_mode: exclusionsByMatch ? 'planned' : 'broadcast',
        },
      });
      invited += 1;
    }
  }

  // Phase 2 — one invite push per candidate, for their EARLIEST invited match,
  // reusing the standard match_invitation tap-routing.
  for (const [pid, candidateMatches] of invitesByCandidate) {
    try {
      candidateMatches.sort((a, b) =>
        `${a.match_date}T${a.start_time}`.localeCompare(`${b.match_date}T${b.start_time}`)
      );
      const target = candidateMatches[0];
      const sendPush = await shouldSendCheckinInvite(pid);
      if (sendPush) {
        const locale = await getUserLocale(pid);
        const { title, body } = buildInviteText(locale, hostName, target);
        const { error: notifErr } = await supabase.rpc('insert_notification', {
          p_user_id: pid,
          p_type: 'match_invitation',
          p_target_id: target.match_id,
          p_title: title,
          p_body: body,
          p_payload: {
            source: 'weekly_checkin',
            matchId: target.match_id,
            playerName: hostName,
            sportName: target.sport_name,
            matchDate: target.match_date,
            startTime: target.start_time,
            locationName: target.facility_name,
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
          target_match_id: target.match_id,
          suppressed: !sendPush,
        },
      });
    } catch (inviteErr) {
      console.warn(`[auto-invite] invite push failed for ${pid}:`, inviteErr);
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

  // Optional body: { player_id?, matches? }. Absent/non-JSON body → all-players
  // sweep. player_id alone → legacy generation. player_id + matches (the
  // planned-checkin dispatch from record_weekly_checkin) → invite-only mode:
  // the matches already exist. Malformed ids are rejected up front.
  let specificPlayerId: string | null = null;
  let plannedMatches: PlannedMatchDispatch[] | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.player_id === 'string') {
      specificPlayerId = body.player_id;
    }
    if (body && Array.isArray(body.matches)) {
      plannedMatches = body.matches as PlannedMatchDispatch[];
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
  if (plannedMatches !== null) {
    if (specificPlayerId === null || plannedMatches.some(m => !UUID_RE.test(m?.match_id ?? ''))) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid matches payload' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
  }

  try {
    let playersProcessed = 0;
    let totalMatchesCreated = 0;
    let autoInvitesSent = 0;

    if (specificPlayerId) {
      const mode = plannedMatches ? 'planned' : 'generated';
      console.log(`[generate-weekly-matches] player ${specificPlayerId} (${mode})`);

      let generated: GeneratedMatch[];
      let exclusionsByMatch: Map<string, Set<string>> | undefined;

      if (plannedMatches) {
        // Invite-only: record_weekly_checkin already created these matches.
        generated = plannedMatches;
        exclusionsByMatch = new Map(
          plannedMatches.map(m => [
            m.match_id,
            new Set((m.excluded_player_ids ?? []).filter(id => UUID_RE.test(id))),
          ])
        );
      } else {
        const { data: matches, error } = await supabase.rpc('generate_weekly_matches_for_player', {
          p_player_id: specificPlayerId,
        });
        if (error) throw error;
        generated = (matches ?? []) as GeneratedMatch[];
      }

      playersProcessed = 1;
      totalMatchesCreated = generated.length;

      // Best-effort auto-invite — never fail generation if inviting hiccups.
      try {
        autoInvitesSent = await autoInviteForMatches(
          specificPlayerId,
          generated,
          exclusionsByMatch
        );
      } catch (inviteErr) {
        console.warn('[auto-invite] skipped due to error:', inviteErr);
      }

      // Analytics (host): per-match creation detail + a run summary that pairs
      // with the client's weekly_checkin_submitted to complete the host funnel.
      // Planned matches were created in the RPC, but this stays the single
      // emission point so the funnel sees every auto match either way.
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
            mode,
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
          mode,
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

  A specific player, legacy autonomous path (clients that send no plan):
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-weekly-matches' \
    --header 'apikey: <SUPABASE_SECRET_KEYS.default>' \
    --header 'Content-Type: application/json' \
    --data '{"player_id": "your-player-uuid"}'

  Planned check-in, invite-only (what record_weekly_checkin dispatches for a
  confirmed plan — the matches already exist):
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-weekly-matches' \
    --header 'apikey: <SUPABASE_SECRET_KEYS.default>' \
    --header 'Content-Type: application/json' \
    --data '{"player_id": "your-player-uuid", "matches": [{"match_id": "existing-match-uuid",
      "sport_name": "tennis", "match_date": "2026-07-09", "start_time": "18:00:00",
      "end_time": "19:00:00", "facility_name": "Parc Jarry",
      "excluded_player_ids": ["excluded-player-uuid"]}]}'

*/
