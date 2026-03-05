-- Migration: Preserve certification when returning to previously-certified level
-- Description: Updates certification logic so that:
--   1. Proofs at higher levels automatically certify lower levels
--   2. When changing to a lower level, certification is preserved if proofs exist at that level or higher
--   3. When changing to a higher level, certification is lost unless proofs exist at that new level
-- Business Rule: "Evidence of a level must always guarantee certification for that level and all lower levels"
-- Created: 2026-03-04

-- ============================================================================
-- 1. FUNCTION: Count valid proofs for certification (considers higher-level proofs)
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
    -- Get the target rating value and system
    SELECT rs.value, rs.rating_system_id 
    INTO v_target_value, v_rating_system_id
    FROM rating_score rs
    WHERE rs.id = p_target_rating_score_id;
    
    -- Count proofs that are at the target level OR HIGHER within the same rating system
    -- A proof at level 4.0 should certify levels 3.5, 3.0, etc.
    SELECT COUNT(*) INTO v_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_target_value  -- Proof at higher or equal level
    AND rp.is_active = true
    AND rp.status = 'approved';  -- Only count approved proofs
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION count_valid_proofs_for_level(UUID, UUID) TO authenticated;

-- ============================================================================
-- 2. UPDATED FUNCTION: Check and update certification with level hierarchy
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
    
    -- Count valid proofs (including those at higher levels)
    -- A proof at level 4.0 certifies levels 4.0, 3.5, 3.0, etc.
    SELECT COUNT(*) INTO v_valid_proofs_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = NEW.id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value  -- Proof at current level or higher
    AND rp.is_active = true
    AND rp.status = 'approved';
    
    -- Check certification conditions:
    -- 1. At least 2 valid proofs (at current level or higher)
    -- 2. At least 3 references from certified players
    IF v_valid_proofs_count >= 2 THEN
        v_should_certify := true;
    ELSIF v_referrals_count >= 3 THEN
        v_should_certify := true;
    END IF;
    
    -- Update certification status based on whether criteria are met
    IF v_should_certify THEN
        -- Certify the player
        IF NOT NEW.is_certified THEN
            NEW.certified_at := NOW();
        END IF;
        NEW.is_certified := true;
        NEW.badge_status := 'certified';
        
        -- Determine certification method
        IF v_valid_proofs_count >= 2 THEN
            NEW.certified_via := 'proof';
        ELSE
            NEW.certified_via := 'referral';
        END IF;
    ELSE
        -- No longer meets certification criteria
        NEW.is_certified := false;
        NEW.certified_at := NULL;
        NEW.badge_status := 'self_declared';
        NEW.certified_via := NULL;
    END IF;
    
    -- Check for disputed status (if certified but evaluation average is significantly lower)
    IF NEW.is_certified AND NEW.peer_evaluation_average IS NOT NULL THEN
        -- If evaluation average is 0.5+ lower than claimed rating, mark as disputed
        IF v_rating_value - NEW.peer_evaluation_average >= 0.5 THEN
            NEW.badge_status := 'disputed';
        ELSIF NEW.badge_status = 'disputed' THEN
            -- If no longer disputed, restore to certified
            NEW.badge_status := 'certified';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. ENSURE TRIGGER EXISTS: Runs on player_rating_score updates
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_check_certification ON player_rating_score;
CREATE TRIGGER trigger_check_certification
BEFORE UPDATE ON player_rating_score
FOR EACH ROW
EXECUTE FUNCTION check_and_update_certification();

-- ============================================================================
-- 4. UPDATED FUNCTION: Get proof counts with valid proofs for current level
-- ============================================================================

-- Must DROP first because return type is changing (adding new column)
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
    -- Get the current rating info
    SELECT prs.rating_score_id, rs.value, rs.rating_system_id 
    INTO v_current_rating_score_id, v_current_rating_value, v_rating_system_id
    FROM player_rating_score prs
    JOIN rating_score rs ON prs.rating_score_id = rs.id
    WHERE prs.id = p_player_rating_score_id;
    
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER AS total_proofs_count,
        COUNT(*) FILTER (WHERE rp.rating_score_id = v_current_rating_score_id)::INTEGER AS current_level_proofs_count,
        COUNT(*) FILTER (
            WHERE rs.rating_system_id = v_rating_system_id 
            AND rs.value >= v_current_rating_value
        )::INTEGER AS valid_proofs_for_certification
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rp.is_active = true
    AND rp.status = 'approved';
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_proof_counts(UUID) TO authenticated;

-- ============================================================================
-- 5. COMMENTS for documentation
-- ============================================================================

COMMENT ON FUNCTION count_valid_proofs_for_level(UUID, UUID) IS 
'Counts approved proofs at the target rating level or higher. Used to determine if a player qualifies for certification at a given level based on proofs they have uploaded.';

COMMENT ON FUNCTION check_and_update_certification() IS 
'Trigger function that automatically updates certification status when player_rating_score is modified. Key behavior: proofs at higher levels automatically certify lower levels (e.g., a 4.0 proof certifies 3.5, 3.0, etc.).';
