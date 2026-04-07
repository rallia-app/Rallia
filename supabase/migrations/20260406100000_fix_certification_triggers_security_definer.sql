-- Migration: Fix certification triggers missing SECURITY DEFINER
-- Description: When a referee responds to a reference request, the trigger
--              update_referrals_count_on_reference() tries to UPDATE player_rating_score
--              for the requester, but RLS blocks it because auth.uid() is the referee,
--              not the player who owns the row. Adding SECURITY DEFINER allows these
--              trigger functions to bypass RLS and update the correct rows.
-- Created: 2026-04-06

-- ============================================================================
-- 1. Fix update_referrals_count_on_reference() — add SECURITY DEFINER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_referrals_count_on_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_count INTEGER;
    v_rating_value NUMERIC;
    v_rating_system_id UUID;
BEGIN
    -- Only act when status or rating_supported changes
    IF OLD IS NOT NULL
       AND OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.rating_supported IS NOT DISTINCT FROM NEW.rating_supported THEN
        RETURN NEW;
    END IF;

    -- Get the current rating level info for the player
    SELECT rs.value, rs.rating_system_id
    INTO v_rating_value, v_rating_system_id
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.id = NEW.player_rating_score_id;

    -- Recount valid references: completed, rating_supported, at current level or higher
    SELECT COUNT(*) INTO v_new_count
    FROM rating_reference_request rrr
    JOIN rating_score rs ON rs.id = rrr.rating_score_id
    WHERE rrr.player_rating_score_id = NEW.player_rating_score_id
    AND rrr.status = 'completed'
    AND rrr.rating_supported = true
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value;

    UPDATE player_rating_score
    SET referrals_count = v_new_count
    WHERE id = NEW.player_rating_score_id;

    RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Fix reevaluate_certification_for_player_rating() — add SECURITY DEFINER
-- ============================================================================

CREATE OR REPLACE FUNCTION reevaluate_certification_for_player_rating(
    p_player_rating_score_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_referrals_count INTEGER;
    v_valid_proofs_count INTEGER;
    v_should_certify BOOLEAN := false;
    v_current_rating_score_id UUID;
    v_rating_value NUMERIC;
    v_rating_system_id UUID;
    v_is_certified BOOLEAN;
    v_certified_via TEXT;
    v_badge_status TEXT;
    v_peer_evaluation_average NUMERIC;
BEGIN
    -- Get current player rating score info
    SELECT
        prs.rating_score_id,
        prs.is_certified,
        prs.certified_via::TEXT,
        prs.badge_status::TEXT,
        prs.peer_evaluation_average
    INTO
        v_current_rating_score_id,
        v_is_certified,
        v_certified_via,
        v_badge_status,
        v_peer_evaluation_average
    FROM player_rating_score prs
    WHERE prs.id = p_player_rating_score_id;

    IF v_current_rating_score_id IS NULL THEN
        RETURN;
    END IF;

    -- Get rating info
    SELECT rs.value, rs.rating_system_id
    INTO v_rating_value, v_rating_system_id
    FROM rating_score rs
    WHERE rs.id = v_current_rating_score_id;

    -- Count valid proofs at current level or higher
    SELECT COUNT(*) INTO v_valid_proofs_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value
    AND rp.is_active = true;

    -- Count valid references at current level or higher (level-aware)
    SELECT COUNT(*) INTO v_referrals_count
    FROM rating_reference_request rrr
    JOIN rating_score rs ON rs.id = rrr.rating_score_id
    WHERE rrr.player_rating_score_id = p_player_rating_score_id
    AND rrr.status = 'completed'
    AND rrr.rating_supported = true
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value;

    -- Check certification conditions
    IF v_valid_proofs_count >= 2 THEN
        v_should_certify := true;
    ELSIF v_referrals_count >= 3 THEN
        v_should_certify := true;
    END IF;

    -- Update certification status
    IF v_should_certify THEN
        UPDATE player_rating_score
        SET
            is_certified = true,
            certified_at = CASE WHEN is_certified THEN certified_at ELSE NOW() END,
            referrals_count = v_referrals_count,
            badge_status = CASE
                WHEN peer_evaluation_average IS NOT NULL
                     AND v_rating_value - peer_evaluation_average >= 0.5
                THEN 'disputed'::badge_status_enum
                ELSE 'certified'::badge_status_enum
            END,
            certified_via = CASE
                WHEN v_valid_proofs_count >= 2 THEN 'proof'::rating_certification_method_enum
                ELSE 'referrals'::rating_certification_method_enum
            END,
            updated_at = NOW()
        WHERE id = p_player_rating_score_id;
    ELSE
        UPDATE player_rating_score
        SET
            is_certified = false,
            certified_at = NULL,
            referrals_count = v_referrals_count,
            badge_status = 'self_declared'::badge_status_enum,
            certified_via = NULL,
            updated_at = NOW()
        WHERE id = p_player_rating_score_id;
    END IF;
END;
$$;

-- ============================================================================
-- 3. Fix trigger_referrals_count_on_reference_delete() — add SECURITY DEFINER
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_referrals_count_on_reference_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_count INTEGER;
    v_rating_value NUMERIC;
    v_rating_system_id UUID;
BEGIN
    -- Only recount if the deleted reference was completed and supporting
    IF OLD.status = 'completed' AND OLD.rating_supported = true THEN
        -- Get the current rating level info
        SELECT rs.value, rs.rating_system_id
        INTO v_rating_value, v_rating_system_id
        FROM player_rating_score prs
        JOIN rating_score rs ON rs.id = prs.rating_score_id
        WHERE prs.id = OLD.player_rating_score_id;

        -- Recount valid references at current level or higher
        SELECT COUNT(*) INTO v_new_count
        FROM rating_reference_request rrr
        JOIN rating_score rs ON rs.id = rrr.rating_score_id
        WHERE rrr.player_rating_score_id = OLD.player_rating_score_id
        AND rrr.status = 'completed'
        AND rrr.rating_supported = true
        AND rs.rating_system_id = v_rating_system_id
        AND rs.value >= v_rating_value;

        UPDATE player_rating_score
        SET referrals_count = v_new_count
        WHERE id = OLD.player_rating_score_id;

        PERFORM reevaluate_certification_for_player_rating(OLD.player_rating_score_id);
    END IF;

    RETURN OLD;
END;
$$;

-- ============================================================================
-- 4. Fix trigger_certification_on_proof_change() — add SECURITY DEFINER
--    (for consistency, though proof uploads are usually by the player themselves)
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_certification_on_proof_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_player_rating_score_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_player_rating_score_id := OLD.player_rating_score_id;
    ELSE
        v_player_rating_score_id := NEW.player_rating_score_id;
    END IF;

    PERFORM reevaluate_certification_for_player_rating(v_player_rating_score_id);

    IF TG_OP = 'UPDATE' AND OLD.player_rating_score_id IS DISTINCT FROM NEW.player_rating_score_id THEN
        PERFORM reevaluate_certification_for_player_rating(OLD.player_rating_score_id);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;
