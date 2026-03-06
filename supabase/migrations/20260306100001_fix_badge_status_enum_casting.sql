-- Migration: Fix badge_status enum type casting
-- Description: The reevaluate_certification_for_player_rating function was assigning text to 
--              badge_status_enum column. This fixes by casting to the proper enum type.
-- Created: 2026-03-06

-- ============================================================================
-- 1. FIXED FUNCTION: Re-evaluate certification with proper enum casting
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
        prs.badge_status::TEXT,
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
    
    -- Count valid proofs (including those at higher levels within same rating system)
    -- A proof at level 4.0 certifies levels 4.0, 3.5, 3.0, etc.
    SELECT COUNT(*) INTO v_valid_proofs_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value  -- Proof at current level or higher
    AND rp.is_active = true;
    
    -- Check certification conditions:
    -- 1. At least 2 valid proofs (at current level or higher)
    -- 2. At least 3 references from certified players
    IF v_valid_proofs_count >= 2 THEN
        v_should_certify := true;
    ELSIF v_referrals_count >= 3 THEN
        v_should_certify := true;
    END IF;
    
    -- Update certification status
    IF v_should_certify THEN
        -- Certify the player
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
