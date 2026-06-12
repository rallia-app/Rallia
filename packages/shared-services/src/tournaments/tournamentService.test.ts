/**
 * Tournament Service tests.
 *
 * The service is a thin wrapper over Supabase: most functions just pass
 * args through to an RPC and bubble errors. We test:
 *  - param marshalling (snake_case keys, optional fields preserved as undefined)
 *  - error propagation (RPC error → thrown Error with same message)
 *  - return shape (RPC payload returned untouched)
 *  - the one place with non-trivial logic: listLinkableMatchesForSlot, which
 *    has to handle PostgREST's object-vs-array embed shape, two-sided
 *    participant filtering, verification gate, and already-linked exclusion.
 */

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import {
  archiveTournament,
  attachMatchToTournamentSlot,
  cancelTournament,
  closeTournamentRegistration,
  createTournament,
  generateTournamentBracket,
  getMyRegistration,
  getProfilesByIds,
  getTournament,
  listActiveRegistrations,
  listLinkableMatchesForSlot,
  listMyActiveRegistrations,
  listMyTournaments,
  listPublicTournaments,
  listTournamentMatches,
  openTournamentRegistration,
  overrideTournamentMatchScore,
  registerForTournament,
  removeTournamentRegistration,
  withdrawFromTournament,
} from './tournamentService';
import { supabase } from '../supabase';

const mockFrom = supabase.from as jest.Mock;
const mockRpc = (supabase as unknown as { rpc: jest.Mock }).rpc;

beforeEach(() => {
  // mockReset wipes both call history AND the queued *-Once returns,
  // so each test starts from a known-empty mock state.
  mockFrom.mockReset();
  mockRpc.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a chainable query mock whose terminal call resolves to {data, error}. */
function chain(result: { data: unknown; error: unknown }) {
  const proxy: Record<string, jest.Mock> = {};
  // Every method returns the same proxy so chains of arbitrary length work.
  // Terminal awaits resolve on the proxy itself via `then`.
  const handler: ProxyHandler<typeof proxy> = {
    get(_target, prop: string) {
      if (prop === 'then') {
        return (onFulfilled: (v: unknown) => unknown) => onFulfilled(result);
      }
      if (!proxy[prop]) {
        proxy[prop] = jest.fn(() => p);
      }
      return proxy[prop];
    },
  };
  const p = new Proxy(proxy, handler);
  return { p, calls: proxy };
}

// ---------------------------------------------------------------------------
// listPublicTournaments
// ---------------------------------------------------------------------------

describe('listPublicTournaments', () => {
  it('returns rows filtered to public visibility and discovery statuses', async () => {
    const rows = [
      { id: 't1', tournament_registrations: [{ count: 3 }] },
      { id: 't2', tournament_registrations: [] },
    ];
    const { p, calls } = chain({ data: rows, error: null });
    mockFrom.mockReturnValue(p);

    const out = await listPublicTournaments();
    expect(out).toEqual([
      { id: 't1', registration_count: 3 },
      { id: 't2', registration_count: 0 },
    ]);
    expect(mockFrom).toHaveBeenCalledWith('tournaments');
    expect(calls.eq).toHaveBeenCalledWith('visibility', 'public');
    expect(calls.eq).toHaveBeenCalledWith('tournament_registrations.status', 'registered');
    expect(calls.in).toHaveBeenCalledWith('status', [
      'registration_open',
      'registration_closed',
      'in_progress',
    ]);
  });

  it('returns [] when supabase returns null data', async () => {
    const { p } = chain({ data: null, error: null });
    mockFrom.mockReturnValue(p);
    expect(await listPublicTournaments()).toEqual([]);
  });

  it('throws when supabase returns an error', async () => {
    const { p } = chain({ data: null, error: { message: 'boom' } });
    mockFrom.mockReturnValue(p);
    await expect(listPublicTournaments()).rejects.toThrow('boom');
  });

  it('applies optional sport filter', async () => {
    const { p, calls } = chain({ data: [], error: null });
    mockFrom.mockReturnValue(p);

    await listPublicTournaments({ sportId: 's1' });

    expect(calls.eq).toHaveBeenCalledWith('sport_id', 's1');
  });
});

// ---------------------------------------------------------------------------
// listMyTournaments
// ---------------------------------------------------------------------------

describe('listMyTournaments', () => {
  it('combines organized and registered tournaments via or()', async () => {
    const regChain = chain({
      data: [{ tournament_id: 'r1' }, { tournament_id: 'r2' }],
      error: null,
    });
    const tnChain = chain({
      data: [{ id: 't1', tournament_registrations: [{ count: 2 }] }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(regChain.p).mockReturnValueOnce(tnChain.p);

    const out = await listMyTournaments('u1');
    expect(out).toEqual([{ id: 't1', registration_count: 2 }]);
    expect(mockFrom).toHaveBeenNthCalledWith(1, 'tournament_registrations');
    expect(mockFrom).toHaveBeenNthCalledWith(2, 'tournaments');
    expect(tnChain.calls.or).toHaveBeenCalledWith('organizer_id.eq.u1,id.in.(r1,r2)');
    expect(tnChain.calls.neq).toHaveBeenCalledWith('status', 'archived');
  });

  it('falls back to an organizer-only filter when there are no registrations', async () => {
    const regChain = chain({ data: [], error: null });
    const tnChain = chain({ data: [], error: null });
    mockFrom.mockReturnValueOnce(regChain.p).mockReturnValueOnce(tnChain.p);

    await listMyTournaments('u1');

    expect(tnChain.calls.eq).toHaveBeenCalledWith('organizer_id', 'u1');
    expect(tnChain.calls.or).toBeUndefined();
  });

  it('applies optional sport filter', async () => {
    const regChain = chain({ data: [], error: null });
    const tnChain = chain({ data: [], error: null });
    mockFrom.mockReturnValueOnce(regChain.p).mockReturnValueOnce(tnChain.p);

    await listMyTournaments('u1', { sportId: 's1' });

    expect(tnChain.calls.eq).toHaveBeenCalledWith('sport_id', 's1');
  });

  it('throws when the registrations query errors', async () => {
    const regChain = chain({ data: null, error: { message: 'boom' } });
    mockFrom.mockReturnValueOnce(regChain.p);
    await expect(listMyTournaments('u1')).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// getTournament
// ---------------------------------------------------------------------------

describe('getTournament', () => {
  it('returns the tournament row on success', async () => {
    const row = { id: 't1', name: 'X' };
    const { p } = chain({ data: row, error: null });
    mockFrom.mockReturnValue(p);
    expect(await getTournament('t1')).toEqual(row);
  });

  it('returns null when PostgREST reports no row (PGRST116)', async () => {
    const { p } = chain({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    mockFrom.mockReturnValue(p);
    expect(await getTournament('missing')).toBeNull();
  });

  it('throws on other Supabase errors', async () => {
    const { p } = chain({ data: null, error: { code: 'XX000', message: 'crash' } });
    mockFrom.mockReturnValue(p);
    await expect(getTournament('t1')).rejects.toThrow('crash');
  });
});

// ---------------------------------------------------------------------------
// createTournament
// ---------------------------------------------------------------------------

describe('createTournament', () => {
  it('marshals camelCase input → snake_case RPC params and returns row', async () => {
    const row = { id: 't1' };
    mockRpc.mockResolvedValue({ data: row, error: null });

    const out = await createTournament({
      name: 'Spring Cup',
      sportId: 's1',
      maxParticipants: 8,
      startDate: '2026-06-01',
      endDate: '2026-06-08',
      description: 'desc',
      visibility: 'public',
      registrationMode: 'open',
      bracketType: 'single_elimination',
      matchFormat: 'two_of_three',
      entryFormat: 'singles',
      facilityId: 'f1',
      venueName: 'Court 1',
      networkId: 'n1',
      registrationOpensAt: '2026-05-15T00:00:00Z',
      registrationClosesAt: '2026-05-30T23:59:59Z',
    });

    expect(out).toEqual(row);
    expect(mockRpc).toHaveBeenCalledWith('tournament_create', {
      p_name: 'Spring Cup',
      p_sport_id: 's1',
      p_max_participants: 8,
      p_start_date: '2026-06-01',
      p_end_date: '2026-06-08',
      p_description: 'desc',
      p_visibility: 'public',
      p_registration_mode: 'open',
      p_bracket_type: 'single_elimination',
      p_match_format: 'two_of_three',
      p_entry_format: 'singles',
      p_facility_id: 'f1',
      p_venue_name: 'Court 1',
      p_network_id: 'n1',
      p_registration_opens_at: '2026-05-15T00:00:00Z',
      p_registration_closes_at: '2026-05-30T23:59:59Z',
    });
  });

  it('passes undefined for omitted optional fields (not empty string)', async () => {
    mockRpc.mockResolvedValue({ data: { id: 't1' }, error: null });
    await createTournament({
      name: 'Min',
      sportId: 's1',
      maxParticipants: 4,
      startDate: '2026-06-01',
      endDate: '2026-06-08',
    });
    const args = mockRpc.mock.calls[0][1];
    expect(args.p_description).toBeUndefined();
    expect(args.p_visibility).toBeUndefined();
    expect(args.p_facility_id).toBeUndefined();
    expect(args.p_network_id).toBeUndefined();
  });

  it('throws the RPC error message verbatim', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'RATE_LIMITED' } });
    await expect(
      createTournament({
        name: 'X',
        sportId: 's1',
        maxParticipants: 4,
        startDate: '2026-06-01',
        endDate: '2026-06-08',
      })
    ).rejects.toThrow('RATE_LIMITED');
  });
});

// ---------------------------------------------------------------------------
// getProfilesByIds
// ---------------------------------------------------------------------------

describe('getProfilesByIds', () => {
  it('short-circuits on empty input — does not query Supabase', async () => {
    const out = await getProfilesByIds([]);
    expect(Object.keys(out)).toHaveLength(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns a record keyed by id', async () => {
    const rows = [
      { id: 'u1', first_name: 'Ada', last_name: 'L', profile_picture_url: null },
      { id: 'u2', first_name: 'Bo', last_name: null, profile_picture_url: 'a.jpg' },
    ];
    const { p } = chain({ data: rows, error: null });
    mockFrom.mockReturnValue(p);

    const out = await getProfilesByIds(['u1', 'u2']);
    expect(Object.keys(out)).toHaveLength(2);
    expect(out['u1']?.first_name).toBe('Ada');
    expect(out['u2']?.profile_picture_url).toBe('a.jpg');
  });

  it('returns empty record when supabase returns null data', async () => {
    const { p } = chain({ data: null, error: null });
    mockFrom.mockReturnValue(p);
    const out = await getProfilesByIds(['u1']);
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('throws on supabase error', async () => {
    const { p } = chain({ data: null, error: { message: 'denied' } });
    mockFrom.mockReturnValue(p);
    await expect(getProfilesByIds(['u1'])).rejects.toThrow('denied');
  });
});

// ---------------------------------------------------------------------------
// listActiveRegistrations / listMyActiveRegistrations / getMyRegistration
// ---------------------------------------------------------------------------

describe('registration listing helpers', () => {
  it('listActiveRegistrations returns rows', async () => {
    const rows = [{ id: 'r1' }];
    const { p } = chain({ data: rows, error: null });
    mockFrom.mockReturnValue(p);
    expect(await listActiveRegistrations('t1')).toEqual(rows);
  });

  it('listActiveRegistrations returns [] on null data', async () => {
    const { p } = chain({ data: null, error: null });
    mockFrom.mockReturnValue(p);
    expect(await listActiveRegistrations('t1')).toEqual([]);
  });

  it('listMyActiveRegistrations propagates errors', async () => {
    const { p } = chain({ data: null, error: { message: 'rls' } });
    mockFrom.mockReturnValue(p);
    await expect(listMyActiveRegistrations('u1')).rejects.toThrow('rls');
  });

  it('getMyRegistration returns null when no row exists', async () => {
    const { p } = chain({ data: null, error: null });
    mockFrom.mockReturnValue(p);
    expect(await getMyRegistration('t1', 'u1')).toBeNull();
  });

  it('getMyRegistration returns the row when one exists', async () => {
    const row = { id: 'r1', user_id: 'u1' };
    const { p } = chain({ data: row, error: null });
    mockFrom.mockReturnValue(p);
    expect(await getMyRegistration('t1', 'u1')).toEqual(row);
  });
});

// ---------------------------------------------------------------------------
// RPC wrappers — registration lifecycle, bracket, attach, cancel/archive
// ---------------------------------------------------------------------------

describe('RPC wrappers', () => {
  type Case = {
    name: string;
    fn: () => Promise<unknown>;
    rpc: string;
    args: Record<string, unknown>;
  };

  const cases: Case[] = [
    {
      name: 'openTournamentRegistration',
      fn: () => openTournamentRegistration('t1', 3),
      rpc: 'tournament_open_registration',
      args: { p_tournament_id: 't1', p_version_was: 3 },
    },
    {
      name: 'closeTournamentRegistration',
      fn: () => closeTournamentRegistration('t1', 4),
      rpc: 'tournament_close_registration',
      args: { p_tournament_id: 't1', p_version_was: 4 },
    },
    {
      name: 'registerForTournament',
      fn: () => registerForTournament('t1'),
      rpc: 'tournament_register',
      args: { p_tournament_id: 't1' },
    },
    {
      name: 'withdrawFromTournament',
      fn: () => withdrawFromTournament('r1', 2),
      rpc: 'tournament_withdraw',
      args: { p_registration_id: 'r1', p_version_was: 2 },
    },
    {
      name: 'removeTournamentRegistration',
      fn: () => removeTournamentRegistration('r1', 2),
      rpc: 'tournament_remove_registration',
      args: { p_registration_id: 'r1', p_version_was: 2 },
    },
    {
      name: 'generateTournamentBracket',
      fn: () => generateTournamentBracket('t1', 5),
      rpc: 'tournament_generate_bracket',
      args: { p_tournament_id: 't1', p_version_was: 5 },
    },
    {
      name: 'attachMatchToTournamentSlot',
      fn: () => attachMatchToTournamentSlot('tm1', 'm1'),
      rpc: 'tournament_attach_match',
      args: { p_tournament_match_id: 'tm1', p_match_id: 'm1' },
    },
    {
      name: 'overrideTournamentMatchScore',
      fn: () => overrideTournamentMatchScore('tm1', 'reg1', '6-4 6-2'),
      rpc: 'tournament_override_score',
      args: { p_tournament_match_id: 'tm1', p_winner_registration_id: 'reg1', p_score: '6-4 6-2' },
    },
    {
      name: 'cancelTournament',
      fn: () => cancelTournament('t1', 'venue lost', 7),
      rpc: 'tournament_cancel',
      args: { p_tournament_id: 't1', p_reason: 'venue lost', p_version_was: 7 },
    },
    {
      name: 'archiveTournament',
      fn: () => archiveTournament('t1', 8),
      rpc: 'tournament_archive',
      args: { p_tournament_id: 't1', p_version_was: 8 },
    },
  ];

  it.each(cases)(
    '$name calls $rpc with the right args and returns data',
    async ({ fn, rpc, args }) => {
      mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
      const out = await fn();
      expect(out).toEqual({ ok: true });
      expect(mockRpc).toHaveBeenCalledWith(rpc, args);
    }
  );

  it.each(cases)('$name throws the RPC error message', async ({ fn }) => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'NOT_ORGANIZER' } });
    await expect(fn()).rejects.toThrow('NOT_ORGANIZER');
  });

  it('generateTournamentBracket returns [] when RPC yields null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await generateTournamentBracket('t1', 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listTournamentMatches
// ---------------------------------------------------------------------------

describe('listTournamentMatches', () => {
  it('returns rows ordered by round + position', async () => {
    const rows = [{ id: 'm1' }, { id: 'm2' }];
    const { p } = chain({ data: rows, error: null });
    mockFrom.mockReturnValue(p);
    expect(await listTournamentMatches('t1')).toEqual(rows);
  });

  it('returns [] on null data', async () => {
    const { p } = chain({ data: null, error: null });
    mockFrom.mockReturnValue(p);
    expect(await listTournamentMatches('t1')).toEqual([]);
  });

  it('throws on supabase error', async () => {
    const { p } = chain({ data: null, error: { message: 'fail' } });
    mockFrom.mockReturnValue(p);
    await expect(listTournamentMatches('t1')).rejects.toThrow('fail');
  });
});

// ---------------------------------------------------------------------------
// listLinkableMatchesForSlot — the one with non-trivial filtering
// ---------------------------------------------------------------------------

describe('listLinkableMatchesForSlot', () => {
  type MatchResultEmbed = {
    id: string;
    is_verified: boolean;
    verified_at: string | null;
    winning_team: number | null;
    team1_score: number | null;
    team2_score: number | null;
    match_set: Array<{ set_number: number; team1_score: number; team2_score: number }>;
  };
  type MatchRow = {
    id: string;
    match_date: string;
    start_time: string;
    end_time: string;
    match_result: MatchResultEmbed | MatchResultEmbed[] | null;
    match_participant: Array<{ player_id: string; status: string; team_number: number | null }>;
  };

  function row(opts: {
    id: string;
    embedAsArray?: boolean;
    verified?: boolean;
    participants?: Array<{ player_id: string; status?: string; team_number?: number | null }>;
    nullResult?: boolean;
    winning_team?: number | null;
    sets?: Array<{ set_number: number; team1_score: number; team2_score: number }>;
  }): MatchRow {
    const mr: MatchResultEmbed | null = opts.nullResult
      ? null
      : {
          id: `mr-${opts.id}`,
          is_verified: opts.verified ?? true,
          verified_at: '2026-05-01T12:00:00Z',
          winning_team: 'winning_team' in opts ? (opts.winning_team ?? null) : 1,
          team1_score: 6,
          team2_score: 3,
          match_set: opts.sets ?? [{ set_number: 1, team1_score: 6, team2_score: 3 }],
        };
    return {
      id: opts.id,
      match_date: '2026-05-01',
      start_time: '12:00',
      end_time: '13:00',
      match_result: opts.embedAsArray && mr ? [mr] : mr,
      match_participant: (opts.participants ?? []).map((p, i) => ({
        player_id: p.player_id,
        status: p.status ?? 'joined',
        team_number: p.team_number ?? i + 1,
      })),
    };
  }

  /**
   * Drives two sequential `from()` calls — first the match query, then the
   * already-linked check on tournament_matches. Returns the per-call mocks
   * so tests can assert filter args.
   */
  function arrange(matchRows: MatchRow[], linkedRows: Array<{ match_id: string | null }> = []) {
    const matchChain = chain({ data: matchRows, error: null });
    const linkedChain = chain({ data: linkedRows, error: null });
    mockFrom
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('match');
        return matchChain.p;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('tournament_matches');
        return linkedChain.p;
      });
    return { matchChain, linkedChain };
  }

  const params = {
    tournamentMatchId: 'tm-1',
    player1UserId: 'u1',
    player2UserId: 'u2',
    sportId: 's1',
  };

  it('returns the eligible match when both players joined and result verified (object embed)', async () => {
    arrange([
      row({
        id: 'm-1',
        verified: true,
        participants: [{ player_id: 'u1' }, { player_id: 'u2' }],
      }),
    ]);
    const out = await listLinkableMatchesForSlot(params);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'm-1',
      match_result_id: 'mr-m-1',
      winning_team: 1,
      team1_score: 6,
      team2_score: 3,
      team1_user_id: 'u1',
      team2_user_id: 'u2',
    });
  });

  it('returns per-set scores ordered by set number', async () => {
    arrange([
      row({
        id: 'm-sets',
        participants: [{ player_id: 'u1' }, { player_id: 'u2' }],
        sets: [
          { set_number: 2, team1_score: 4, team2_score: 6 },
          { set_number: 1, team1_score: 6, team2_score: 3 },
          { set_number: 3, team1_score: 6, team2_score: 2 },
        ],
      }),
    ]);
    const out = await listLinkableMatchesForSlot(params);
    expect(out[0].sets).toEqual([
      { team1: 6, team2: 3 },
      { team1: 4, team2: 6 },
      { team1: 6, team2: 2 },
    ]);
  });

  it('maps each score to its player by team_number, regardless of row order', async () => {
    arrange([
      row({
        id: 'm-teams',
        // u2 is on team 1, u1 is on team 2 — independent of array order
        participants: [
          { player_id: 'u1', team_number: 2 },
          { player_id: 'u2', team_number: 1 },
        ],
      }),
    ]);
    const out = await listLinkableMatchesForSlot(params);
    expect(out[0]).toMatchObject({ team1_user_id: 'u2', team2_user_id: 'u1' });
  });

  it('handles match_result returned as a single-element array (PostgREST shape variation)', async () => {
    arrange([
      row({
        id: 'm-arr',
        embedAsArray: true,
        participants: [{ player_id: 'u1' }, { player_id: 'u2' }],
      }),
    ]);
    const out = await listLinkableMatchesForSlot(params);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('m-arr');
  });

  it('drops matches with no result, an unverified result, or null embed', async () => {
    arrange([
      row({
        id: 'm-null',
        nullResult: true,
        participants: [{ player_id: 'u1' }, { player_id: 'u2' }],
      }),
      row({
        id: 'm-unv',
        verified: false,
        participants: [{ player_id: 'u1' }, { player_id: 'u2' }],
      }),
      row({ id: 'm-ok', participants: [{ player_id: 'u1' }, { player_id: 'u2' }] }),
    ]);
    const out = await listLinkableMatchesForSlot(params);
    expect(out.map(m => m.id)).toEqual(['m-ok']);
  });

  it('drops matches whose joined participants are not exactly the two bracket players', async () => {
    arrange([
      // Right players but a third joined participant → not eligible
      row({
        id: 'm-3p',
        participants: [{ player_id: 'u1' }, { player_id: 'u2' }, { player_id: 'u3' }],
      }),
      // Two joined but wrong second player
      row({
        id: 'm-wrong',
        participants: [{ player_id: 'u1' }, { player_id: 'u9' }],
      }),
      // Only one joined participant
      row({ id: 'm-solo', participants: [{ player_id: 'u1' }] }),
      // Right players but one is invited (not joined) → only 1 joined counted
      row({
        id: 'm-invited',
        participants: [{ player_id: 'u1' }, { player_id: 'u2', status: 'invited' }],
      }),
    ]);
    const out = await listLinkableMatchesForSlot(params);
    expect(out).toEqual([]);
  });

  it('treats player order as irrelevant (u2,u1 == u1,u2)', async () => {
    arrange([
      row({
        id: 'm-rev',
        participants: [{ player_id: 'u2' }, { player_id: 'u1' }],
      }),
    ]);
    const out = await listLinkableMatchesForSlot(params);
    expect(out.map(m => m.id)).toEqual(['m-rev']);
  });

  it('excludes matches already linked to a different tournament_match slot', async () => {
    arrange(
      [
        row({ id: 'm-taken', participants: [{ player_id: 'u1' }, { player_id: 'u2' }] }),
        row({ id: 'm-free', participants: [{ player_id: 'u1' }, { player_id: 'u2' }] }),
      ],
      [{ match_id: 'm-taken' }]
    );
    const out = await listLinkableMatchesForSlot(params);
    expect(out.map(m => m.id)).toEqual(['m-free']);
  });

  it('ignores null match_id rows in the linked-set lookup', async () => {
    arrange(
      [row({ id: 'm-1', participants: [{ player_id: 'u1' }, { player_id: 'u2' }] })],
      [{ match_id: null }]
    );
    const out = await listLinkableMatchesForSlot(params);
    expect(out.map(m => m.id)).toEqual(['m-1']);
  });

  it('skips the linked-check fetch entirely when no candidates are eligible', async () => {
    // No second from() call should happen.
    const matchChain = chain({
      data: [
        row({ id: 'x', verified: false, participants: [{ player_id: 'u1' }, { player_id: 'u2' }] }),
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(matchChain.p);
    const out = await listLinkableMatchesForSlot(params);
    expect(out).toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('throws when the match query errors', async () => {
    const matchChain = chain({ data: null, error: { message: 'denied' } });
    mockFrom.mockReturnValueOnce(matchChain.p);
    await expect(listLinkableMatchesForSlot(params)).rejects.toThrow('denied');
  });

  it('throws when the linked-check query errors', async () => {
    const matchChain = chain({
      data: [row({ id: 'm-1', participants: [{ player_id: 'u1' }, { player_id: 'u2' }] })],
      error: null,
    });
    const linkedChain = chain({ data: null, error: { message: 'rls' } });
    mockFrom.mockReturnValueOnce(matchChain.p).mockReturnValueOnce(linkedChain.p);
    await expect(listLinkableMatchesForSlot(params)).rejects.toThrow('rls');
  });

  it('coerces missing winning_team to null', async () => {
    arrange([
      row({
        id: 'm-tie',
        winning_team: null,
        participants: [{ player_id: 'u1' }, { player_id: 'u2' }],
      }),
    ]);
    const out = await listLinkableMatchesForSlot(params);
    expect(out[0].winning_team).toBeNull();
  });
});
