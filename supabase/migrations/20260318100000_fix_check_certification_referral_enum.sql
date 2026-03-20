-- Migration: Fix check_and_update_certification referral enum value
-- Description: The check_and_update_certification trigger function uses 'referral' (singular)
--              but the correct enum value is 'referrals' (plural).
--              This was missed in the 20260306100003 migration which only fixed
--              reevaluate_certification_for_player_rating.
-- Created: 2026-03-18

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
    AND rp.is_active = true;

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
            NEW.certified_via := 'referrals';
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
