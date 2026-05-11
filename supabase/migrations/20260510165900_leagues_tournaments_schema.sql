-- ============================================
-- Leagues & Tournaments — Schema (Phase 1 / migration 1 of 3)
-- ============================================
-- Spec: specs/17-leagues-tournaments/data-model.md
--
-- This migration ships only the storage layer:
--   - Enums
--   - Tables, FKs, CHECKs, EXCLUDE constraints
--   - Indexes
--   - updated_at triggers (no business triggers yet)
--
-- RLS policies and helper functions ship in migration 2.
-- SECURITY DEFINER RPCs ship in migration 3.
--
-- Schema is consistent with the actual Rallia DB:
--   - Sport identity: sport_id uuid REFERENCES sport(id) (no sport_kind enum)
--   - User FKs: REFERENCES player(id) (not auth.users)
--   - Court FKs: REFERENCES court(id) (no facility_courts)
--   - Community-network FKs: REFERENCES network(id) (RPCs enforce
--     network_type.code = 'community')
-- ============================================


-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE tournament_status AS ENUM (
    'draft',
    'registration_open',
    'registration_closed',
    'in_progress',
    'completed',
    'cancelled',
    'archived'
);

CREATE TYPE tournament_visibility AS ENUM ('public', 'private', 'community');

CREATE TYPE tournament_registration_mode AS ENUM ('open', 'invite_only', 'approval');

CREATE TYPE bracket_type AS ENUM ('single_elimination', 'double_elimination');

CREATE TYPE match_format AS ENUM (
    'one_set',
    'two_of_three',
    'three_of_five',
    'pickleball_to_11',
    'pickleball_to_15',
    'pickleball_to_21'
);

CREATE TYPE final_set_tiebreak AS ENUM ('none', 'standard_7pt', 'super_tb_10pt');

CREATE TYPE entry_format AS ENUM ('singles', 'doubles', 'mixed_doubles');

CREATE TYPE registration_status AS ENUM (
    'registered',
    'pending',
    'waitlisted',
    'withdrawn',
    'disqualified'
);

CREATE TYPE tournament_match_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'retired',
    'walkover',
    'disputed',
    'cancelled'
);

CREATE TYPE league_status AS ENUM ('active', 'paused', 'closed');

CREATE TYPE league_role AS ENUM ('organizer', 'co_organizer', 'member');

CREATE TYPE league_member_status AS ENUM ('active', 'pending', 'suspended', 'inactive');

CREATE TYPE season_status AS ENUM ('draft', 'open', 'closed');

CREATE TYPE session_status AS ENUM ('draft', 'published', 'in_progress', 'completed', 'cancelled');

CREATE TYPE session_presence_status AS ENUM ('confirmed', 'declined', 'pending', 'waitlisted');

CREATE TYPE pairing_mode AS ENUM ('random', 'by_rank', 'avoid_repeat', 'swiss', 'balanced_doubles');

CREATE TYPE session_match_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'retired',
    'walkover',
    'disputed',
    'cancelled'
);

CREATE TYPE score_validation_status AS ENUM ('pending_validation', 'validated', 'rejected');

CREATE TYPE pairing_team AS ENUM ('a', 'b');

CREATE TYPE odd_cardinality_mode AS ENUM ('bye', 'three_player', 'drill');

CREATE TYPE audit_scope AS ENUM (
    'tournament',
    'league',
    'season',
    'session',
    'tournament_match',
    'session_match',
    'registration',
    'membership'
);


-- ============================================
-- TOURNAMENT TABLES
-- ============================================

CREATE TABLE tournaments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    description text,
    logo_url text,
    sport_id uuid NOT NULL REFERENCES sport(id) ON DELETE RESTRICT,

    visibility tournament_visibility NOT NULL DEFAULT 'private',
    registration_mode tournament_registration_mode NOT NULL DEFAULT 'open',

    surface text,
    level text,
    categories text[] NOT NULL DEFAULT '{}',

    max_participants smallint NOT NULL CHECK (max_participants IN (4, 8, 16, 32, 64, 128)),
    bracket_type bracket_type NOT NULL DEFAULT 'single_elimination',
    match_format match_format NOT NULL DEFAULT 'two_of_three',
    games_per_set smallint NOT NULL DEFAULT 6 CHECK (games_per_set IN (4, 6, 8)),
    final_set_tiebreak final_set_tiebreak NOT NULL DEFAULT 'super_tb_10pt',
    entry_format entry_format NOT NULL DEFAULT 'singles',
    seeding_enabled boolean NOT NULL DEFAULT true,
    max_seeds smallint NOT NULL DEFAULT 4 CHECK (max_seeds IN (0, 2, 4, 8)),

    min_rating numeric(3,1),
    max_rating numeric(3,1),
    min_reputation smallint,
    CONSTRAINT tournaments_rating_range CHECK (
        min_rating IS NULL OR max_rating IS NULL OR min_rating <= max_rating
    ),

    registration_opens_at timestamptz,
    registration_closes_at timestamptz,
    start_date timestamptz NOT NULL,
    end_date timestamptz NOT NULL,
    CONSTRAINT tournaments_date_order CHECK (end_date >= start_date),
    CONSTRAINT tournaments_reg_order CHECK (
        registration_opens_at IS NULL OR registration_closes_at IS NULL
        OR registration_opens_at <= registration_closes_at
    ),

    facility_id uuid REFERENCES facility(id) ON DELETE SET NULL,
    venue_name text,
    venue_address text,

    status tournament_status NOT NULL DEFAULT 'draft',
    cancelled_at timestamptz,
    cancelled_reason text,
    archived_at timestamptz,
    bracket_locked_at timestamptz,

    organizer_id uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    -- Optional community-network scope. The create RPC enforces that the
    -- referenced network row has network_type.code = 'community'.
    network_id uuid REFERENCES network(id) ON DELETE SET NULL,

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tournaments_sport_status_idx
    ON tournaments(sport_id, status)
    WHERE status NOT IN ('archived', 'cancelled');
CREATE INDEX tournaments_organizer_idx ON tournaments(organizer_id);
CREATE INDEX tournaments_network_idx ON tournaments(network_id) WHERE network_id IS NOT NULL;
CREATE INDEX tournaments_facility_idx ON tournaments(facility_id) WHERE facility_id IS NOT NULL;
CREATE INDEX tournaments_dates_idx
    ON tournaments(start_date, end_date)
    WHERE status NOT IN ('archived', 'cancelled');


CREATE TABLE tournament_invite_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE,
    label text,
    max_uses integer,
    uses integer NOT NULL DEFAULT 0,
    expires_at timestamptz,
    created_by uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE INDEX tournament_invite_links_tournament_idx ON tournament_invite_links(tournament_id);


CREATE TABLE tournament_co_organizers (
    tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
    added_by uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tournament_id, user_id)
);


CREATE TABLE tournament_registrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,

    partnership_id uuid,
    partner_user_id uuid REFERENCES player(id) ON DELETE RESTRICT,

    status registration_status NOT NULL DEFAULT 'registered',
    seed_rank smallint,
    self_declared_rank smallint,
    bracket_position smallint,
    notes text,

    registered_at timestamptz NOT NULL DEFAULT now(),
    withdrawn_at timestamptz,
    approved_at timestamptz,
    approved_by uuid REFERENCES player(id),

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (tournament_id, user_id),
    CONSTRAINT treg_seed_unique_per_tournament EXCLUDE USING btree (
        tournament_id WITH =, seed_rank WITH =
    ) WHERE (seed_rank IS NOT NULL),
    CONSTRAINT treg_bracket_position_unique EXCLUDE USING btree (
        tournament_id WITH =, bracket_position WITH =
    ) WHERE (bracket_position IS NOT NULL)
);

CREATE INDEX tournament_registrations_status_idx ON tournament_registrations(tournament_id, status);
CREATE INDEX tournament_registrations_user_idx ON tournament_registrations(user_id);


CREATE TABLE tournament_waitlist (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
    partner_user_id uuid REFERENCES player(id) ON DELETE CASCADE,
    position integer NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    promoted_at timestamptz,
    UNIQUE (tournament_id, user_id),
    CONSTRAINT twait_position_unique EXCLUDE USING btree (
        tournament_id WITH =, position WITH =
    ) WHERE (promoted_at IS NULL)
);


CREATE TABLE tournament_matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,

    bracket_side text NOT NULL DEFAULT 'main' CHECK (bracket_side IN ('main', 'losers', 'grand_final')),
    round_number smallint NOT NULL,
    match_position smallint NOT NULL,

    player1_registration_id uuid REFERENCES tournament_registrations(id) ON DELETE SET NULL,
    player2_registration_id uuid REFERENCES tournament_registrations(id) ON DELETE SET NULL,
    player1_is_bye boolean NOT NULL DEFAULT false,
    player2_is_bye boolean NOT NULL DEFAULT false,

    winner_registration_id uuid REFERENCES tournament_registrations(id),
    score text,
    status tournament_match_status NOT NULL DEFAULT 'pending',

    scheduled_at timestamptz,
    court_id uuid REFERENCES court(id),
    played_at timestamptz,

    next_match_id uuid REFERENCES tournament_matches(id) ON DELETE SET NULL,
    next_match_slot smallint CHECK (next_match_slot IN (1, 2)),
    loser_next_match_id uuid REFERENCES tournament_matches(id) ON DELETE SET NULL,

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (tournament_id, bracket_side, round_number, match_position)
);

CREATE INDEX tournament_matches_tournament_idx ON tournament_matches(tournament_id);
CREATE INDEX tournament_matches_status_idx
    ON tournament_matches(tournament_id, status)
    WHERE status IN ('pending', 'in_progress', 'disputed');
CREATE INDEX tournament_matches_player1_idx
    ON tournament_matches(player1_registration_id)
    WHERE player1_registration_id IS NOT NULL;
CREATE INDEX tournament_matches_player2_idx
    ON tournament_matches(player2_registration_id)
    WHERE player2_registration_id IS NOT NULL;


-- ============================================
-- LEAGUE TABLES
-- ============================================

CREATE TABLE leagues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    description text,
    logo_url text,
    sport_id uuid NOT NULL REFERENCES sport(id) ON DELETE RESTRICT,

    visibility tournament_visibility NOT NULL DEFAULT 'private',
    join_mode tournament_registration_mode NOT NULL DEFAULT 'approval',

    facility_id uuid REFERENCES facility(id) ON DELETE SET NULL,
    venue_name text,
    surfaces text[] NOT NULL DEFAULT '{}',
    categories text[] NOT NULL DEFAULT '{}',
    level text,

    default_rules jsonb NOT NULL DEFAULT '{}'::jsonb,

    member_capacity integer,
    waitlist_enabled boolean NOT NULL DEFAULT false,

    status league_status NOT NULL DEFAULT 'active',

    organizer_id uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    -- Optional community-network scope. The create RPC enforces that the
    -- referenced network row has network_type.code = 'community'.
    network_id uuid REFERENCES network(id) ON DELETE SET NULL,

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leagues_sport_status_idx ON leagues(sport_id, status);
CREATE INDEX leagues_organizer_idx ON leagues(organizer_id);
CREATE INDEX leagues_network_idx ON leagues(network_id) WHERE network_id IS NOT NULL;


CREATE TABLE league_invite_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE,
    label text,
    max_uses integer,
    uses integer NOT NULL DEFAULT 0,
    expires_at timestamptz,
    created_by uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE INDEX league_invite_links_league_idx ON league_invite_links(league_id);


CREATE TABLE league_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    role league_role NOT NULL DEFAULT 'member',
    status league_member_status NOT NULL DEFAULT 'active',

    joined_at timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz,
    approved_by uuid REFERENCES player(id),
    suspended_at timestamptz,
    suspended_until timestamptz,
    suspended_reason text,
    left_at timestamptz,

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (league_id, user_id)
);

CREATE INDEX league_members_status_idx ON league_members(league_id, status);
CREATE INDEX league_members_user_idx ON league_members(user_id, status);


CREATE TABLE league_member_waitlist (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
    position integer NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    promoted_at timestamptz,
    UNIQUE (league_id, user_id),
    CONSTRAINT lmw_position_unique EXCLUDE USING btree (
        league_id WITH =, position WITH =
    ) WHERE (promoted_at IS NULL)
);

CREATE INDEX league_member_waitlist_league_idx
    ON league_member_waitlist(league_id)
    WHERE promoted_at IS NULL;


CREATE TABLE seasons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL CHECK (end_date >= start_date),

    status season_status NOT NULL DEFAULT 'draft',
    rules jsonb NOT NULL DEFAULT '{}'::jsonb,
    rules_locked_at timestamptz,

    closed_at timestamptz,
    final_standings jsonb,

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (league_id, name)
);

CREATE INDEX seasons_league_status_idx ON seasons(league_id, status);


CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    name text NOT NULL,

    scheduled_at timestamptz NOT NULL,
    duration_minutes smallint NOT NULL DEFAULT 90,
    timezone text NOT NULL,

    facility_id uuid REFERENCES facility(id) ON DELETE SET NULL,
    venue_name text,
    capacity smallint,
    rounds smallint NOT NULL DEFAULT 1 CHECK (rounds BETWEEN 1 AND 6),
    formats_allowed entry_format[] NOT NULL DEFAULT ARRAY['singles']::entry_format[],
    match_format match_format,
    pairing_mode pairing_mode NOT NULL DEFAULT 'by_rank',

    allow_guests boolean NOT NULL DEFAULT false,
    odd_cardinality_mode odd_cardinality_mode NOT NULL DEFAULT 'bye',

    status session_status NOT NULL DEFAULT 'draft',
    confirmation_deadline_at timestamptz,
    published_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    cancelled_reason text,

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_season_status_idx ON sessions(season_id, status);
CREATE INDEX sessions_scheduled_idx
    ON sessions(scheduled_at)
    WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX sessions_facility_idx ON sessions(facility_id) WHERE facility_id IS NOT NULL;


CREATE TABLE session_courts (
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    court_id uuid NOT NULL REFERENCES court(id) ON DELETE RESTRICT,
    PRIMARY KEY (session_id, court_id)
);


CREATE TABLE session_presence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    status session_presence_status NOT NULL DEFAULT 'pending',

    preferred_partner_id uuid REFERENCES player(id) ON DELETE SET NULL,

    is_guest boolean NOT NULL DEFAULT false,
    guest_invited_by uuid REFERENCES player(id),

    responded_at timestamptz,
    waitlist_position integer,

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (session_id, user_id)
);

CREATE INDEX session_presence_session_status_idx ON session_presence(session_id, status);
CREATE INDEX session_presence_user_idx ON session_presence(user_id);


CREATE TABLE session_matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    round_number smallint NOT NULL DEFAULT 1,
    court_id uuid REFERENCES court(id),
    court_label text,

    format entry_format NOT NULL DEFAULT 'singles',
    is_drill boolean NOT NULL DEFAULT false,
    is_three_player boolean NOT NULL DEFAULT false,
    team_a_user_ids uuid[] NOT NULL,
    team_b_user_ids uuid[] NOT NULL,
    CHECK (cardinality(team_a_user_ids) IN (1, 2)),
    CHECK (cardinality(team_b_user_ids) IN (1, 2)),
    CHECK (
        cardinality(team_a_user_ids) = cardinality(team_b_user_ids)
        OR is_three_player = true
    ),

    score text,
    winner_team pairing_team,
    status session_match_status NOT NULL DEFAULT 'pending',

    locked boolean NOT NULL DEFAULT false,

    scheduled_at timestamptz,
    played_at timestamptz,

    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_matches_session_idx ON session_matches(session_id);
CREATE INDEX session_matches_session_round_idx ON session_matches(session_id, round_number);
CREATE INDEX session_matches_status_idx ON session_matches(status);


CREATE TABLE session_match_scores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_match_id uuid NOT NULL REFERENCES session_matches(id) ON DELETE CASCADE,
    submitted_by uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    score text NOT NULL,
    outcome_team pairing_team,
    retired_team pairing_team,
    walkover_team pairing_team,
    status score_validation_status NOT NULL DEFAULT 'pending_validation',
    validated_by uuid REFERENCES player(id),
    validated_at timestamptz,
    rejection_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_match_scores_match_idx
    ON session_match_scores(session_match_id, created_at DESC);


CREATE TABLE tournament_match_scores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_match_id uuid NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
    submitted_by uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    score text NOT NULL,
    outcome_team pairing_team,
    retired_team pairing_team,
    walkover_team pairing_team,
    status score_validation_status NOT NULL DEFAULT 'pending_validation',
    validated_by uuid REFERENCES player(id),
    validated_at timestamptz,
    rejection_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tournament_match_scores_match_idx
    ON tournament_match_scores(tournament_match_id, created_at DESC);


CREATE TABLE season_rankings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,

    points integer NOT NULL DEFAULT 0,
    wins integer NOT NULL DEFAULT 0,
    losses integer NOT NULL DEFAULT 0,
    draws integer NOT NULL DEFAULT 0,
    no_shows integer NOT NULL DEFAULT 0,

    sets_won integer NOT NULL DEFAULT 0,
    sets_lost integer NOT NULL DEFAULT 0,
    games_won integer NOT NULL DEFAULT 0,
    games_lost integer NOT NULL DEFAULT 0,

    matches_played integer NOT NULL DEFAULT 0,
    sessions_attended integer NOT NULL DEFAULT 0,
    sessions_eligible integer NOT NULL DEFAULT 0,

    rank integer,
    tiebreak_seed bigint,

    last_recalculated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (season_id, user_id)
);

CREATE INDEX season_rankings_season_rank_idx ON season_rankings(season_id, rank);
CREATE INDEX season_rankings_user_idx ON season_rankings(user_id);


-- ============================================
-- AUDIT LOG
-- ============================================

CREATE TABLE leagues_tournaments_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope audit_scope NOT NULL,
    entity_id uuid NOT NULL,
    action text NOT NULL,
    actor_id uuid NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
    payload_before jsonb,
    payload_after jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_scope_entity_idx
    ON leagues_tournaments_audit(scope, entity_id, occurred_at DESC);
CREATE INDEX audit_actor_idx ON leagues_tournaments_audit(actor_id);


-- ============================================
-- updated_at TRIGGERS
-- ============================================
-- Reuses public.update_updated_at_column() defined in 20241124000000_initial_schema.sql.

CREATE TRIGGER update_tournaments_updated_at BEFORE UPDATE ON tournaments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tournament_registrations_updated_at BEFORE UPDATE ON tournament_registrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tournament_matches_updated_at BEFORE UPDATE ON tournament_matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leagues_updated_at BEFORE UPDATE ON leagues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_league_members_updated_at BEFORE UPDATE ON league_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_seasons_updated_at BEFORE UPDATE ON seasons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_session_presence_updated_at BEFORE UPDATE ON session_presence
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_session_matches_updated_at BEFORE UPDATE ON session_matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_season_rankings_updated_at BEFORE UPDATE ON season_rankings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE tournaments IS 'Single-event competition with fixed bracket. See specs/17-leagues-tournaments/tournaments.md.';
COMMENT ON TABLE leagues IS 'Recurring competitive structure with seasons and sessions. See specs/17-leagues-tournaments/leagues.md.';
COMMENT ON COLUMN tournaments.network_id IS 'Optional community-network scope. Create RPC validates network_type.code = ''community''.';
COMMENT ON COLUMN leagues.network_id IS 'Optional community-network scope. Create RPC validates network_type.code = ''community''.';
COMMENT ON TABLE leagues_tournaments_audit IS 'Append-only audit log for organizer-initiated mutations across L&T entities.';
