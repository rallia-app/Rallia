-- Migration: Lower proof certification threshold from 2 to 1
-- Description: Players can now get certified with a single non-rejected rating proof
--              instead of requiring 2. References threshold remains at 3.
--              Also restores the rp.status != 'rejected' filter that was lost in
--              20260406100000_fix_certification_triggers_security_definer.sql.
-- Created: 2026-04-07

-- ============================================================================
-- 1. Update reevaluate_certification_for_player_rating
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
        prs.referrals_count,
        prs.is_certified,
        prs.certified_via,
        prs.badge_status,
        prs.peer_evaluation_average
    INTO
        v_current_rating_score_id,
        v_referrals_count,
        v_is_certified,
        v_certified_via,
        v_badge_status,
        v_peer_evaluation_average
    FROM player_rating_score prs
    WHERE prs.id = p_player_rating_score_id;

    -- If not found, exit
    IF v_current_rating_score_id IS NULL THEN
        RETURN;
    END IF;

    -- Get rating info
    SELECT rs.value, rs.rating_system_id
    INTO v_rating_value, v_rating_system_id
    FROM rating_score rs
    WHERE rs.id = v_current_rating_score_id;

    -- Count valid proofs at current level or higher (pending + approved, not rejected)
    SELECT COUNT(*) INTO v_valid_proofs_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value
    AND rp.is_active = true
    AND rp.status != 'rejected';

    -- Count valid references at current level or higher (level-aware)
    SELECT COUNT(*) INTO v_referrals_count
    FROM rating_reference_request rrr
    JOIN rating_score rs ON rs.id = rrr.rating_score_id
    WHERE rrr.player_rating_score_id = p_player_rating_score_id
    AND rrr.status = 'completed'
    AND rrr.rating_supported = true
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value;

    -- Check certification conditions (1 proof OR 3 references)
    IF v_valid_proofs_count >= 1 THEN
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
                WHEN v_valid_proofs_count >= 1 THEN 'proof'::rating_certification_method_enum
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
-- 2. Update check_and_update_certification (BEFORE UPDATE trigger on player_rating_score)
--    This was still using >= 2 and missing the rejected filter, causing it to
--    override the certification set by reevaluate_certification_for_player_rating.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_and_update_certification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_referrals_count INTEGER;
    v_valid_proofs_count INTEGER;
    v_should_certify BOOLEAN := false;
    v_rating_value NUMERIC;
    v_sport_name TEXT;
    v_min_for_referral NUMERIC;
    v_rating_system_id UUID;
BEGIN
    -- Get rating info
    SELECT rs.value, rs.rating_system_id, s.name, rsys.min_for_referral
    INTO v_rating_value, v_rating_system_id, v_sport_name, v_min_for_referral
    FROM rating_score rs
    JOIN rating_system rsys ON rs.rating_system_id = rsys.id
    JOIN sport s ON rsys.sport_id = s.id
    WHERE rs.id = NEW.rating_score_id;

    -- Count valid references at current level or higher (level-aware)
    SELECT COUNT(*) INTO v_referrals_count
    FROM rating_reference_request rrr
    JOIN rating_score rs ON rs.id = rrr.rating_score_id
    WHERE rrr.player_rating_score_id = NEW.id
    AND rrr.status = 'completed'
    AND rrr.rating_supported = true
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value;

    -- Update referrals_count to match the filtered count
    NEW.referrals_count := v_referrals_count;

    -- Count valid proofs (pending + approved, not rejected)
    SELECT COUNT(*) INTO v_valid_proofs_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = NEW.id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value
    AND rp.is_active = true
    AND rp.status != 'rejected';

    -- Check certification conditions (1 proof OR 3 references)
    IF v_valid_proofs_count >= 1 THEN
        v_should_certify := true;
    ELSIF v_referrals_count >= 3 THEN
        v_should_certify := true;
    END IF;

    -- Update certification status based on whether criteria are met
    IF v_should_certify THEN
        IF NOT NEW.is_certified THEN
            NEW.certified_at := NOW();
        END IF;
        NEW.is_certified := true;
        NEW.badge_status := 'certified';

        IF v_valid_proofs_count >= 1 THEN
            NEW.certified_via := 'proof';
        ELSE
            NEW.certified_via := 'referrals';
        END IF;
    ELSE
        NEW.is_certified := false;
        NEW.certified_at := NULL;
        NEW.badge_status := 'self_declared';
        NEW.certified_via := NULL;
    END IF;

    -- Check for disputed status
    IF NEW.is_certified AND NEW.peer_evaluation_average IS NOT NULL THEN
        IF v_rating_value - NEW.peer_evaluation_average >= 0.5 THEN
            NEW.badge_status := 'disputed';
        ELSIF NEW.badge_status = 'disputed' THEN
            NEW.badge_status := 'certified';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
