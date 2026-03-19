-- Migration: Fix badge_status enum casting in certification functions
-- Description: The CASE expression in reevaluate_certification_for_player_rating()
--              returns text type, but badge_status column is badge_status_enum.
--              PostgreSQL cannot implicitly cast text from CASE to enum.
-- Fix: Add explicit ::badge_status_enum casts to all badge_status assignments.
-- Created: 2026-03-19

-- ============================================================================
-- 1. Fix reevaluate_certification_for_player_rating — add enum casts
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
    v_badge_status badge_status_enum;
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
                THEN 'disputed'::badge_status_enum 
                ELSE 'certified'::badge_status_enum 
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
            badge_status = 'self_declared'::badge_status_enum,
            certified_via = NULL,
            updated_at = NOW()
        WHERE id = p_player_rating_score_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION reevaluate_certification_for_player_rating(UUID) TO authenticated;

-- ============================================================================
-- 2. Fix check_and_update_certification — add enum casts for safety
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
        NEW.badge_status := 'certified'::badge_status_enum;
        
        IF v_valid_proofs_count >= 2 THEN
            NEW.certified_via := 'proof';
        ELSE
            NEW.certified_via := 'referral';
        END IF;
    ELSE
        NEW.is_certified := false;
        NEW.certified_at := NULL;
        NEW.badge_status := 'self_declared'::badge_status_enum;
        NEW.certified_via := NULL;
    END IF;
    
    -- Check for disputed status
    IF NEW.is_certified AND NEW.peer_evaluation_average IS NOT NULL THEN
        IF v_rating_value - NEW.peer_evaluation_average >= 0.5 THEN
            NEW.badge_status := 'disputed'::badge_status_enum;
        ELSIF NEW.badge_status = 'disputed'::badge_status_enum THEN
            NEW.badge_status := 'certified'::badge_status_enum;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
