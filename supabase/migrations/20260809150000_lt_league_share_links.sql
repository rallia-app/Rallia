-- ============================================================================
-- Leagues — shareable invite links (organizer + player kinds)
-- ============================================================================
-- league_invite_links has existed since the base schema but nothing ever wrote
-- to it: no mint RPC, no redeem RPC, so leagues could not be shared out of app
-- at all. This wires the table up, mirroring the tournament split
-- (20260729140000_lt_player_invite_links.sql):
--
--   kind = 'organizer'  one live link per league, organizer/co-organizer/admin
--                       only to mint. Skeleton key: redeeming lands you
--                       'active' even on an approval or invite-only league and
--                       skips the rating and reputation gates. Capacity is NOT
--                       bypassed — only a personal invite row carries the
--                       "organizer already chose them" exemption; a forwarded
--                       link does not.
--   kind = 'player'     one live link per (league, sharer), any member or
--                       visitor can mint where sharing is safe. Redeems
--                       through league_join itself — the player-link path
--                       DELEGATES to public.league_join() rather than copying
--                       its body, so join_mode mapping, rating band,
--                       reputation gate, capacity and waitlist can never
--                       drift from the real join rules.
--
-- Player links only exist where sharing is meaningful and safe:
--   * visibility = 'public'           a shared link must not leak a hidden league
--   * join_mode <> 'invite_only'      the organizer picks the field there
--   * status = 'active'               paused/closed leagues lead nowhere
-- Enforced at mint AND re-checked at redeem, since a league can change under a
-- link that is already in the wild.
--
-- Deviation from the tournament mirror, on purpose: league_invite_reset only
-- revokes ORGANIZER links. tournament_invite_reset predates player links and
-- silently kills every player's share link too; player links redeem through
-- the normal rules, so revoking them adds no safety and punishes sharers.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Schema
-- --------------------------------------------------------------------------

ALTER TABLE public.league_invite_links
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'organizer';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'league_invite_links_kind_check'
    ) THEN
        ALTER TABLE public.league_invite_links
          ADD CONSTRAINT league_invite_links_kind_check
          CHECK (kind IN ('organizer', 'player'));
    END IF;
END $$;

COMMENT ON COLUMN public.league_invite_links.kind IS
    'organizer = one per league, bypasses join_mode and the rating/reputation gates. player = one per sharer, redeems through the normal league_join rules.';

-- One live player link per sharer.
CREATE UNIQUE INDEX IF NOT EXISTS league_invite_links_one_player_link_idx
    ON public.league_invite_links (league_id, created_by)
    WHERE kind = 'player' AND revoked_at IS NULL;


-- --------------------------------------------------------------------------
-- 2. RLS — amend the live SELECT policy, never add a second one alongside
-- --------------------------------------------------------------------------
-- Permissive policies OR together, so a second policy would silently widen
-- organizer links too. A sharer may read their own player link and nothing else.

DROP POLICY IF EXISTS linvite_select ON public.league_invite_links;
CREATE POLICY linvite_select ON public.league_invite_links
    FOR SELECT
    USING (
        (SELECT public.is_admin())
        OR public.is_league_organizer(league_id)
        OR (kind = 'player' AND created_by = (SELECT auth.uid()))
    );


-- --------------------------------------------------------------------------
-- 3. Minting
-- --------------------------------------------------------------------------
-- Same entry point for both audiences: the caller's rights decide which kind
-- they get, so the client keeps calling one RPC.

CREATE OR REPLACE FUNCTION public.league_invite_get_or_create(
    p_league_id uuid
)
RETURNS league_invite_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_league     leagues;
    v_privileged boolean;
    v_kind       text;
    v_row        league_invite_links;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id FOR UPDATE;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;
    IF v_league.status = 'closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    v_privileged := public.is_league_organizer(p_league_id) OR public.is_admin();
    v_kind := CASE WHEN v_privileged THEN 'organizer' ELSE 'player' END;

    -- A player may only share where sharing is safe and leads somewhere.
    IF NOT v_privileged THEN
        IF v_league.visibility <> 'public'
           OR v_league.join_mode = 'invite_only'
           OR v_league.status <> 'active' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHARING_NOT_AVAILABLE';
        END IF;
    END IF;

    -- Organizer links are per league; player links are per sharer.
    SELECT * INTO v_row
      FROM league_invite_links
     WHERE league_id = p_league_id
       AND revoked_at IS NULL
       AND kind = v_kind
       AND (v_kind = 'organizer' OR created_by = v_caller_id)
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_row.id IS NOT NULL THEN
        RETURN v_row;
    END IF;

    INSERT INTO league_invite_links (league_id, token, created_by, kind)
    VALUES (p_league_id, replace(gen_random_uuid()::text, '-', ''), v_caller_id, v_kind)
    RETURNING * INTO v_row;

    -- Token deliberately excluded from the audit payload.
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'league', p_league_id, 'invite_link_created', v_caller_id,
        jsonb_build_object('link_id', v_row.id, 'kind', v_kind)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_invite_get_or_create(uuid) TO authenticated;

COMMENT ON FUNCTION public.league_invite_get_or_create(uuid)
    IS 'Returns the caller''s active invite link for the league, minting one if absent. Organizers get the league''s shared organizer link; any other player gets their own player link, allowed only on a public, non-invite-only, active league (SHARING_NOT_AVAILABLE otherwise).';


-- --------------------------------------------------------------------------
-- 4. Reset (organizer links only — see header)
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_invite_reset(
    p_league_id uuid
)
RETURNS league_invite_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_league    leagues;
    v_row       league_invite_links;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_league_organizer(p_league_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id FOR UPDATE;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;
    IF v_league.status = 'closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    UPDATE league_invite_links
       SET revoked_at = now()
     WHERE league_id = p_league_id
       AND kind = 'organizer'
       AND revoked_at IS NULL;

    INSERT INTO league_invite_links (league_id, token, created_by, kind)
    VALUES (p_league_id, replace(gen_random_uuid()::text, '-', ''), v_caller_id, 'organizer')
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'league', p_league_id, 'invite_link_reset', v_caller_id,
        jsonb_build_object('new_link_id', v_row.id)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_invite_reset(uuid) TO authenticated;

COMMENT ON FUNCTION public.league_invite_reset(uuid)
    IS 'Revokes the league''s active organizer link(s) and mints a fresh one. Organizer/admin only. Player links are left alone — they redeem through the normal rules, so revoking them adds no safety.';


-- --------------------------------------------------------------------------
-- 5. Preview
-- --------------------------------------------------------------------------
-- A valid token reveals the league row even when RLS would hide it (private
-- league, caller not yet a member), plus the active member count. One opaque
-- INVITE_INVALID for every failure mode — don't leak whether a token exists,
-- was revoked, or expired.

CREATE OR REPLACE FUNCTION public.league_get_by_invite_token(
    p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_link      league_invite_links;
    v_league    leagues;
    v_count     integer;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_link FROM league_invite_links WHERE token = p_token;
    IF v_link.id IS NULL
       OR v_link.revoked_at IS NOT NULL
       OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
       OR (v_link.max_uses IS NOT NULL AND v_link.uses >= v_link.max_uses) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_link.league_id;
    IF v_league.id IS NULL OR v_league.status = 'closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    SELECT count(*) INTO v_count
      FROM league_members
     WHERE league_id = v_league.id
       AND status = 'active';

    RETURN jsonb_build_object(
        'league', to_jsonb(v_league),
        'active_count', v_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_get_by_invite_token(text) TO authenticated;

COMMENT ON FUNCTION public.league_get_by_invite_token(text)
    IS 'Invite-token preview: returns {league, active_count} for a valid token, bypassing RLS so invitees can see private leagues before joining.';


-- --------------------------------------------------------------------------
-- 6. Redeeming
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_join_via_invite(
    p_token text
)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id      uuid := auth.uid();
    v_league_id      uuid;
    v_league         leagues;
    v_link           league_invite_links;
    v_is_player_link boolean;
    v_existing       league_members;
    v_row            league_members;
    v_active_count   integer;
    v_position       integer;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT league_id INTO v_league_id
      FROM league_invite_links WHERE token = p_token;
    IF v_league_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    -- League before link, matching every other league RPC's lock order.
    SELECT * INTO v_league FROM leagues WHERE id = v_league_id FOR UPDATE;
    IF v_league.id IS NULL OR v_league.status = 'closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    SELECT * INTO v_link FROM league_invite_links WHERE token = p_token FOR UPDATE;
    IF v_link.id IS NULL
       OR v_link.revoked_at IS NOT NULL
       OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
       OR (v_link.max_uses IS NOT NULL AND v_link.uses >= v_link.max_uses) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    IF v_league.organizer_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MEMBER';
    END IF;

    v_is_player_link := (v_link.kind = 'player');

    -- A player link is re-validated at redeem: the league may have gone
    -- private or switched to invite_only after the link was shared.
    IF v_is_player_link
       AND (v_league.visibility <> 'public'
            OR v_league.join_mode = 'invite_only') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHARING_NOT_AVAILABLE';
    END IF;

    SELECT * INTO v_existing
      FROM league_members
     WHERE league_id = v_league_id AND user_id = v_caller_id
     FOR UPDATE;

    -- Idempotent re-tap: already in (or seat held) → hand back the existing row.
    IF v_existing.id IS NOT NULL AND v_existing.status IN ('active', 'suspended') THEN
        RETURN v_existing;
    END IF;

    IF v_existing.id IS NOT NULL AND v_existing.status = 'pending' THEN
        IF v_is_player_link AND v_existing.invited_by IS NULL THEN
            -- Their self-request already stands; a player link adds nothing.
            RETURN v_existing;
        END IF;
        -- An organizer link admits a pending request/invite on the spot, and a
        -- player link resolves a personal invite exactly like tapping Join —
        -- league_join's accept-invite branch handles the latter below.
        IF NOT v_is_player_link THEN
            PERFORM public.assert_caller_plays_sport(v_league.sport_id);

            -- A pending hold can mean "queued because the league is full"; the
            -- cap binds this admission like it binds league_approve_member.
            SELECT count(*) INTO v_active_count
              FROM league_members
             WHERE league_id = v_league_id AND status IN ('active', 'suspended');
            IF v_league.member_capacity IS NOT NULL
               AND v_active_count >= v_league.member_capacity THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_FULL';
            END IF;

            UPDATE league_members
               SET status      = 'active',
                   approved_at = now(),
                   left_at     = NULL,
                   version     = version + 1,
                   updated_at  = now()
             WHERE id = v_existing.id
            RETURNING * INTO v_row;

            UPDATE league_member_waitlist
               SET promoted_at = now()
             WHERE league_id = v_league_id AND user_id = v_caller_id AND promoted_at IS NULL;
        ELSE
            v_row := public.league_join(v_league_id);
        END IF;

    ELSIF v_is_player_link THEN
        -- The whole point of the delegation: join_mode mapping, rating band,
        -- reputation gate, capacity and waitlist all come from the one live
        -- league_join, so this path can never silently drift from it.
        v_row := public.league_join(v_league_id);

    ELSE
        -- Organizer link, fresh joiner: skeleton key past join_mode and the
        -- rating/reputation gates, but never past a full roster.
        PERFORM public.assert_caller_plays_sport(v_league.sport_id);

        SELECT count(*) INTO v_active_count
          FROM league_members
         WHERE league_id = v_league_id AND status IN ('active', 'suspended');

        IF v_league.member_capacity IS NOT NULL
           AND v_active_count >= v_league.member_capacity THEN

            IF NOT COALESCE(v_league.waitlist_enabled, false) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_FULL';
            END IF;

            -- Queue them, same shape as league_join's waitlist block.
            IF NOT EXISTS (
                SELECT 1 FROM league_member_waitlist
                 WHERE league_id = v_league_id AND user_id = v_caller_id AND promoted_at IS NULL
            ) THEN
                SELECT COALESCE(max(position), 0) + 1 INTO v_position
                  FROM league_member_waitlist
                 WHERE league_id = v_league_id AND promoted_at IS NULL;

                INSERT INTO league_member_waitlist (league_id, user_id, position)
                VALUES (v_league_id, v_caller_id, v_position)
                ON CONFLICT (league_id, user_id) DO UPDATE
                   SET position = EXCLUDED.position, joined_at = now(), promoted_at = NULL;
            END IF;

            IF v_existing.id IS NOT NULL THEN
                UPDATE league_members
                   SET status      = 'pending',
                       approved_at = NULL,
                       left_at     = NULL,
                       version     = version + 1,
                       updated_at  = now()
                 WHERE id = v_existing.id
                RETURNING * INTO v_row;
            ELSE
                INSERT INTO league_members (league_id, user_id, role, status)
                VALUES (v_league_id, v_caller_id, 'member', 'pending')
                RETURNING * INTO v_row;
            END IF;
        ELSE
            IF v_existing.id IS NOT NULL THEN
                UPDATE league_members
                   SET status      = 'active',
                       approved_at = now(),
                       left_at     = NULL,
                       version     = version + 1,
                       updated_at  = now()
                 WHERE id = v_existing.id
                RETURNING * INTO v_row;
            ELSE
                INSERT INTO league_members (league_id, user_id, role, status, approved_at)
                VALUES (v_league_id, v_caller_id, 'member', 'active', now())
                RETURNING * INTO v_row;
            END IF;

            UPDATE league_member_waitlist
               SET promoted_at = now()
             WHERE league_id = v_league_id AND user_id = v_caller_id AND promoted_at IS NULL;
        END IF;
    END IF;

    UPDATE league_invite_links SET uses = uses + 1 WHERE id = v_link.id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'membership', v_row.id,
        CASE WHEN v_is_player_link THEN 'join_via_player_invite' ELSE 'join_via_invite' END,
        v_caller_id,
        jsonb_build_object(
            'league_id', v_league_id,
            'link_id', v_link.id,
            'link_kind', v_link.kind,
            'shared_by', v_link.created_by,
            'previous_status', v_existing.status,
            'status', v_row.status
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_join_via_invite(text) TO authenticated;

COMMENT ON FUNCTION public.league_join_via_invite(text) IS
    'Joins the caller to a league via an invite token. An organizer link bypasses join_mode and the rating/reputation gates (never capacity); a player link delegates to league_join, so the normal rules apply — approval leagues land the recipient pending. Idempotent for already-active members.';
