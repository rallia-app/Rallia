-- Migration: Fix certification re-evaluation to exclude rejected proofs
-- Description: The reevaluate_certification_for_player_rating() function was only
--              checking rp.is_active = true but did not exclude rejected proofs.
--              Business rule: pending AND approved proofs count toward certification,
--              but rejected proofs do NOT.
--              Also aligns check_and_update_certification() (level change trigger)
--              to the same rule — it previously only counted 'approved'.
-- Fix: Add AND rp.status != 'rejected' to proof count queries in both functions.
-- Created: 2026-03-19

-- ============================================================================
-- 1. Fix reevaluate_certification_for_player_rating (proof/reference triggers)
-- ============================================================================

CREATE OR REPLACE FUNCTION reevaluate_certification_for_player_rating(
    p_player_rating_score_id UUID
)
RETURNS VOID AS $$
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
    
    -- Count valid proofs at current level or higher within same rating system
    -- Business rule: pending + approved count, rejected does NOT
    SELECT COUNT(*) INTO v_valid_proofs_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value
    AND rp.is_active = true
    AND rp.status != 'rejected';
    
    -- Check certification conditions:
    -- 1. At least 2 valid proofs (pending or approved, at current level or higher)
    -- 2. At least 3 references from certified players
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
            badge_status = CASE 
                WHEN peer_evaluation_average IS NOT NULL 
                     AND v_rating_value - peer_evaluation_average >= 0.5 
                THEN 'disputed' 
                ELSE 'certified' 
            END,
            certified_via = CASE WHEN v_valid_proofs_count >= 2 THEN 'proof' ELSE 'referral' END,
            updated_at = NOW()
        WHERE id = p_player_rating_score_id;
    ELSE
        -- No longer meets certification criteria - remove certification
        UPDATE player_rating_score
        SET 
            is_certified = false,
            certified_at = NULL,
            badge_status = 'self_declared',
            certified_via = NULL,
            updated_at = NOW()
        WHERE id = p_player_rating_score_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION reevaluate_certification_for_player_rating(UUID) TO authenticated;

COMMENT ON FUNCTION reevaluate_certification_for_player_rating(UUID) IS 
'Re-evaluates certification status for a player rating score. Counts pending + approved proofs (excludes rejected). Called by proof and reference triggers.';

-- ============================================================================
-- 2. Align check_and_update_certification (level change trigger) to same rule
--    Previously only counted approved — now counts pending + approved
-- ============================================================================

CREATE OR REPLACE FUNCTION check_and_update_certification()
RETURNS TRIGGER AS $$
DECLARE
    v_referrals_count INTEGER;
    v_valid_proofs_count INTEGER;
    v_should_certify BOOLEAN := false;
    v_rating_value NUMERIC;
    v_sport_name TEXT;
    v_min_for_referral NUMERIC;
    v_rating_system_id UUID;
BEGIN
    -- Get current referrals count
    v_referrals_count := NEW.referrals_count;
    
    -- Get rating info
    SELECT rs.value, rs.rating_system_id, s.name, rsys.min_for_referral
    INTO v_rating_value, v_rating_system_id, v_sport_name, v_min_for_referral
    FROM rating_score rs
    JOIN rating_system rsys ON rs.rating_system_id = rsys.id
    JOIN sport s ON rsys.sport_id = s.id
    WHERE rs.id = NEW.rating_score_id;
    
    -- Count valid proofs at current level or higher
    -- Business rule: pending + approved count, rejected does NOT
    SELECT COUNT(*) INTO v_valid_proofs_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = NEW.id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value
    AND rp.is_active = true
    AND rp.status != 'rejected';
    
    -- Check certification conditions
    IF v_valid_proofs_count >= 2 THEN
        v_should_certify := true;
    ELSIF v_referrals_count >= 3 THEN
        v_should_certify := true;
    END IF;
    
    -- Update certification status
    IF v_should_certify THEN
        IF NOT NEW.is_certified THEN
            NEW.certified_at := NOW();
        END IF;
        NEW.is_certified := true;
        NEW.badge_status := 'certified';
        
        IF v_valid_proofs_count >= 2 THEN
            NEW.certified_via := 'proof';
        ELSE
            NEW.certified_via := 'referral';
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. Align count_valid_proofs_for_level utility to same rule
-- ============================================================================

CREATE OR REPLACE FUNCTION count_valid_proofs_for_level(
    p_player_rating_score_id UUID,
    p_target_rating_score_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
    v_target_value NUMERIC;
    v_rating_system_id UUID;
BEGIN
    SELECT rs.value, rs.rating_system_id 
    INTO v_target_value, v_rating_system_id
    FROM rating_score rs
    WHERE rs.id = p_target_rating_score_id;
    
    -- Count proofs at target level or higher — pending + approved, not rejected
    SELECT COUNT(*) INTO v_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_target_value
    AND rp.is_active = true
    AND rp.status != 'rejected';
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION count_valid_proofs_for_level(UUID, UUID) TO authenticated;

-- ============================================================================
-- 4. Align get_proof_counts utility to same rule
-- ============================================================================

DROP FUNCTION IF EXISTS get_proof_counts(UUID);

CREATE OR REPLACE FUNCTION get_proof_counts(p_player_rating_score_id UUID)
RETURNS TABLE (
    total_proofs_count INTEGER,
    current_level_proofs_count INTEGER,
    valid_proofs_for_certification INTEGER
) AS $$
DECLARE
    v_current_rating_score_id UUID;
    v_current_rating_value NUMERIC;
    v_rating_system_id UUID;
BEGIN
    SELECT prs.rating_score_id, rs.value, rs.rating_system_id 
    INTO v_current_rating_score_id, v_current_rating_value, v_rating_system_id
    FROM player_rating_score prs
    JOIN rating_score rs ON prs.rating_score_id = rs.id
    WHERE prs.id = p_player_rating_score_id;
    
    RETURN QUERY
    SELECT 
        COUNT(*) FILTER (WHERE rp.status != 'rejected')::INTEGER AS total_proofs_count,
        COUNT(*) FILTER (WHERE rp.rating_score_id = v_current_rating_score_id AND rp.status != 'rejected')::INTEGER AS current_level_proofs_count,
        COUNT(*) FILTER (
            WHERE rs.rating_system_id = v_rating_system_id 
            AND rs.value >= v_current_rating_value
            AND rp.status != 'rejected'
        )::INTEGER AS valid_proofs_for_certification
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rp.is_active = true;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_proof_counts(UUID) TO authenticated;
