-- Migration: Trigger certification re-evaluation on proof and reference changes
-- Description: When proofs are added/deleted or references change, re-evaluate certification.
--              This ensures certification status stays accurate when the underlying proofs/references change.
-- Created: 2026-03-06

-- ============================================================================
-- 1. FUNCTION: Re-evaluate certification for a given player_rating_score_id
--    This is a standalone function that can be called from various triggers
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
    
    -- Count valid proofs (including those at higher levels within same rating system)
    -- A proof at level 4.0 certifies levels 4.0, 3.5, 3.0, etc.
    SELECT COUNT(*) INTO v_valid_proofs_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = p_player_rating_score_id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value  -- Proof at current level or higher
    AND rp.is_active = true;
    
    -- Also check if there are proofs/references at a HIGHER level that would still certify
    -- This handles the case: proof at 4.0, move to 3.5 -> still certified
    
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

-- ============================================================================
-- 2. TRIGGER FUNCTION: Re-evaluate certification when rating_proof changes
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_certification_on_proof_change()
RETURNS TRIGGER AS $$
DECLARE
    v_player_rating_score_id UUID;
BEGIN
    -- Get the player_rating_score_id from the affected proof
    IF TG_OP = 'DELETE' THEN
        v_player_rating_score_id := OLD.player_rating_score_id;
    ELSE
        v_player_rating_score_id := NEW.player_rating_score_id;
    END IF;
    
    -- Re-evaluate certification for this player's rating
    PERFORM reevaluate_certification_for_player_rating(v_player_rating_score_id);
    
    -- If the proof was moved to a different player_rating_score (rare but possible on UPDATE)
    IF TG_OP = 'UPDATE' AND OLD.player_rating_score_id IS DISTINCT FROM NEW.player_rating_score_id THEN
        PERFORM reevaluate_certification_for_player_rating(OLD.player_rating_score_id);
    END IF;
    
    -- Return appropriate value based on operation
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. TRIGGER: Attach to rating_proof table
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_certification_proof_change ON rating_proof;
CREATE TRIGGER trigger_certification_proof_change
AFTER INSERT OR UPDATE OR DELETE ON rating_proof
FOR EACH ROW EXECUTE FUNCTION trigger_certification_on_proof_change();

-- ============================================================================
-- 4. TRIGGER FUNCTION: Handle rating_reference_request DELETE
--    When a reference request is deleted, we need to decrement referrals_count
--    if it was an accepted, rating-supporting reference
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_referrals_count_on_reference_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- If the deleted reference was accepted and supporting the rating,
    -- we need to decrement the referrals_count
    IF OLD.status = 'accepted' AND OLD.rating_supported = true THEN
        UPDATE player_rating_score
        SET referrals_count = GREATEST(0, referrals_count - 1)
        WHERE id = OLD.player_rating_score_id;
        
        -- The update above should trigger check_and_update_certification via the existing trigger
        -- But let's also explicitly re-evaluate to be safe
        PERFORM reevaluate_certification_for_player_rating(OLD.player_rating_score_id);
    END IF;
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. TRIGGER: Attach DELETE trigger to rating_reference_request table
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_referrals_count_on_reference_delete ON rating_reference_request;
CREATE TRIGGER trigger_referrals_count_on_reference_delete
AFTER DELETE ON rating_reference_request
FOR EACH ROW EXECUTE FUNCTION trigger_referrals_count_on_reference_delete();

-- ============================================================================
-- 6. UPDATED: Update existing reference status change trigger to also call re-evaluation
--    This ensures certification is checked when references are accepted/rejected
-- ============================================================================

CREATE OR REPLACE FUNCTION update_referrals_count_on_reference()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle status change to 'accepted' with rating_supported = true
    IF NEW.status = 'accepted' AND NEW.rating_supported = true THEN
        -- Only increment if this is a new acceptance
        IF OLD IS NULL OR OLD.status != 'accepted' OR OLD.rating_supported != true THEN
            UPDATE player_rating_score
            SET referrals_count = referrals_count + 1
            WHERE id = NEW.player_rating_score_id;
        END IF;
    END IF;
    
    -- Handle losing accepted/rating_supported status (rejection, cancellation, etc.)
    IF OLD IS NOT NULL 
       AND OLD.status = 'accepted' 
       AND OLD.rating_supported = true 
       AND (NEW.status != 'accepted' OR NEW.rating_supported = false) THEN
        UPDATE player_rating_score
        SET referrals_count = GREATEST(0, referrals_count - 1)
        WHERE id = OLD.player_rating_score_id;
    END IF;
    
    -- Always re-evaluate certification when reference status changes
    IF OLD IS NULL OR OLD.status IS DISTINCT FROM NEW.status OR OLD.rating_supported IS DISTINCT FROM NEW.rating_supported THEN
        PERFORM reevaluate_certification_for_player_rating(NEW.player_rating_score_id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: The trigger for INSERT/UPDATE already exists from previous migration,
-- we just updated the function above.

-- ============================================================================
-- 7. COMMENT: Document the triggers
-- ============================================================================

COMMENT ON FUNCTION reevaluate_certification_for_player_rating(UUID) IS 
'Re-evaluates and updates certification status for a player rating score. Called by proof and reference triggers.';

COMMENT ON FUNCTION trigger_certification_on_proof_change() IS 
'Trigger function that re-evaluates certification when rating_proof is inserted, updated, or deleted.';

COMMENT ON FUNCTION trigger_referrals_count_on_reference_delete() IS 
'Trigger function that decrements referrals_count when an accepted reference request is deleted.';
