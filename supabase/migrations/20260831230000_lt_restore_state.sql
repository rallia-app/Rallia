-- ============================================================================
-- Letting the app ask whether a decision can still be undone.
-- ============================================================================
-- lt_restore_tournament_match (20260831150000) has been callable since it
-- landed, but nothing could tell the organizer a restore was available, so the
-- only way back from a misfire was a SQL prompt. This is the read side: one
-- call per pairing, answering the three things the button needs to know.
--
-- Deliberately not a plain SELECT from the audit: the client would have to
-- know which actions count as an automated decision, and that list belongs
-- with the ladder.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_match_restore_state(p_tournament_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm        tournament_matches;
    v_rule      text;
    v_decided   timestamptz;
    v_is_org    boolean;
    v_window    boolean;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_tm.id IS NULL THEN
        RETURN jsonb_build_object('decided', false, 'restorable', false);
    END IF;

    -- The most recent automated decision, and only if nothing has undone it
    -- since: a restore writes its own audit row and must not leave the button
    -- offering to restore an already-restored pairing.
    SELECT a.payload_after ->> 'rule', a.occurred_at INTO v_rule, v_decided
      FROM leagues_tournaments_audit a
     WHERE a.scope = 'tournament_match' AND a.entity_id = p_tournament_match_id
       AND a.action IN ('auto_walkover', 'auto_double_forfeit',
                        'auto_double_walkover', 'auto_cancel')
     ORDER BY a.occurred_at DESC LIMIT 1;

    IF v_rule IS NULL OR EXISTS (
        SELECT 1 FROM leagues_tournaments_audit a
         WHERE a.scope = 'tournament_match' AND a.entity_id = p_tournament_match_id
           AND a.action = 'restore' AND a.occurred_at >= v_decided
    ) THEN
        RETURN jsonb_build_object('decided', false, 'restorable', false);
    END IF;

    v_is_org := public.is_tournament_organizer(v_tm.tournament_id) OR public.is_admin();
    v_window := public.lt_restore_window_open(p_tournament_match_id);

    RETURN jsonb_build_object(
        'decided',     true,
        'rule',        v_rule,
        'window_open', v_window,
        'is_organizer', v_is_org,
        'restorable',  v_is_org AND v_window
    );
END;
$$;

COMMENT ON FUNCTION public.lt_match_restore_state(uuid) IS
'What the restore control needs: whether this pairing carries an automated
decision that has not already been undone, which rung produced it, whether the
window is still open, and whether THIS caller may act. Spec:
unplayed-match-resolution.md § 9.';

REVOKE ALL ON FUNCTION public.lt_match_restore_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_match_restore_state(uuid) TO authenticated;
