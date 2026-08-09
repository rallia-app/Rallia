-- ============================================================================
-- Leagues — a forfeit can never pay more than the played result it shadows
-- ============================================================================
-- 20260807280000 let the organizer set pointWin/pointLoss but the sport
-- defaults seed the walkover and retirement variants as literal values
-- (pointWalkoverWinner: 10, pointRetirementWinner: 10). An organizer lowering
-- a win to 3 therefore got a league where a walkover WIN pays 10: better to
-- receive a forfeit than to play. That is exactly the incentive the formats
-- spec forbids ("personne ne doit pouvoir bâtir sa montée sur des forfaits").
--
-- lt_assert_league_rules now refuses any rules object where a walkover or
-- retirement outcome pays more than the corresponding played outcome. The
-- wizard cascades the variants when win/loss change, so a normal edit never
-- hits this; the invariant is for every other writer, present and future.
--
-- Same body as 20260807280000 otherwise.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_assert_league_rules(p_rules jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_key text;
BEGIN
    IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES';
    END IF;

    -- Point values feed a sum, so a string or a null would break the recalc at
    -- score time rather than here. Negative is legal: pointNoShow defaults to -5.
    FOREACH v_key IN ARRAY ARRAY[
        'pointWin', 'pointLoss', 'pointDraw', 'pointBye', 'pointNoShow',
        'pointRetirementWinner', 'pointRetirementLoser',
        'pointWalkoverWinner', 'pointWalkoverLoser', 'pointPerGameWon'
    ] LOOP
        IF p_rules ? v_key THEN
            IF jsonb_typeof(p_rules -> v_key) <> 'number' THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
            END IF;
            IF (p_rules ->> v_key)::numeric NOT BETWEEN -100 AND 100 THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
            END IF;
        END IF;
    END LOOP;

    -- The forfeit invariant. Checked pairwise so a partial object (rules are
    -- merged before validation, so in practice every key is present) can still
    -- be validated for what it carries.
    FOREACH v_key IN ARRAY ARRAY['pointWalkoverWinner', 'pointRetirementWinner'] LOOP
        IF p_rules ? v_key AND p_rules ? 'pointWin'
           AND (p_rules ->> v_key)::numeric > (p_rules ->> 'pointWin')::numeric THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
        END IF;
    END LOOP;
    FOREACH v_key IN ARRAY ARRAY['pointWalkoverLoser', 'pointRetirementLoser'] LOOP
        IF p_rules ? v_key AND p_rules ? 'pointLoss'
           AND (p_rules ->> v_key)::numeric > (p_rules ->> 'pointLoss')::numeric THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:' || v_key;
        END IF;
    END LOOP;

    IF p_rules ? 'matchFormat'
       AND NOT EXISTS (
           SELECT 1
             FROM unnest(enum_range(NULL::match_format)) AS e(v)
            WHERE e.v::text = p_rules ->> 'matchFormat'
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:matchFormat';
    END IF;

    IF p_rules ? 'gamesPerSet'
       AND (jsonb_typeof(p_rules -> 'gamesPerSet') <> 'number'
            OR (p_rules ->> 'gamesPerSet')::integer NOT IN (4, 6, 8)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:gamesPerSet';
    END IF;

    IF p_rules ? 'pointsPerGame'
       AND (jsonb_typeof(p_rules -> 'pointsPerGame') <> 'number'
            OR (p_rules ->> 'pointsPerGame')::integer NOT IN (11, 15, 21)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:pointsPerGame';
    END IF;

    -- Games each player plays per session. sessions.rounds is CHECKed 1..6, so a
    -- season default outside that range could never be applied.
    IF p_rules ? 'gamesPerPlayer'
       AND (jsonb_typeof(p_rules -> 'gamesPerPlayer') <> 'number'
            OR (p_rules ->> 'gamesPerPlayer')::integer NOT BETWEEN 1 AND 6) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RULES:gamesPerPlayer';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.lt_assert_league_rules(jsonb) IS
'Validates a league/season rules jsonb: point values numeric and within ±100,
no walkover/retirement outcome paying more than its played counterpart,
matchFormat a real enum label, gamesPerSet 4/6/8, pointsPerGame 11/15/21,
gamesPerPlayer 1..6. Raises INVALID_RULES[:key].';
