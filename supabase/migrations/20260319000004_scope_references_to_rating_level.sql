-- Migration: Scope references to rating level (prevents false certification)
-- Description: When a player changes their NTRP rating, references earned at the old level
--              should NOT count toward certification at the new (higher) level.
--              This migration:
--              1. Adds rating_score_id to rating_reference_request
--              2. Auto-populates rating_score_id on INSERT via trigger
--              3. Fixes status enum bug ('accepted' -> 'completed') in triggers
--              4. Makes certification reference counting level-aware (like proofs)
-- Created: 2026-03-19

-- ============================================================================
-- 1. Add rating_score_id column to rating_reference_request
-- ============================================================================

ALTER TABLE rating_reference_request
ADD COLUMN IF NOT EXISTS rating_score_id UUID REFERENCES rating_score(id);

-- ============================================================================
-- 2. Auto-populate rating_score_id on INSERT
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_populate_reference_rating_score_id()
RETURNS TRIGGER AS $$
BEGIN
    -- If rating_score_id is not provided, look it up from player_rating_score
    IF NEW.rating_score_id IS NULL AND NEW.player_rating_score_id IS NOT NULL THEN
        SELECT rating_score_id INTO NEW.rating_score_id
        FROM player_rating_score
        WHERE id = NEW.player_rating_score_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_populate_reference_rating_score_id ON rating_reference_request;
CREATE TRIGGER trigger_auto_populate_reference_rating_score_id
BEFORE INSERT ON rating_reference_request
FOR EACH ROW EXECUTE FUNCTION auto_populate_reference_rating_score_id();

-- ============================================================================
-- 3. Fix update_referrals_count_on_reference() — status enum + level-aware counting
--    Bug: was checking 'accepted' but app sets status to 'completed'
--    Fix: recount valid references at current level or higher instead of increment/decrement
-- ============================================================================

CREATE OR REPLACE FUNCTION update_referrals_count_on_reference()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Fix check_and_update_certification() — level-aware reference counting
--    Instead of reading NEW.referrals_count, query rating_reference_request directly
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
    -- Get rating info
    SELECT rs.value, rs.rating_system_id, s.name, rsys.min_for_referral
    INTO v_rating_value, v_rating_system_id, v_sport_name, v_min_for_referral
    FROM rating_score rs
    JOIN rating_system rsys ON rs.rating_system_id = rsys.id
    JOIN sport s ON rsys.sport_id = s.id
    WHERE rs.id = NEW.rating_score_id;

    -- Count valid references at current level or higher (level-aware, like proofs)
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

    -- Count valid proofs (including those at higher levels)
    SELECT COUNT(*) INTO v_valid_proofs_count
    FROM rating_proof rp
    JOIN rating_score rs ON rp.rating_score_id = rs.id
    WHERE rp.player_rating_score_id = NEW.id
    AND rs.rating_system_id = v_rating_system_id
    AND rs.value >= v_rating_value
    AND rp.is_active = true;

    -- Check certification conditions:
    -- 1. At least 2 valid proofs (at current level or higher)
    -- 2. At least 3 references from certified players (at current level or higher)
    IF v_valid_proofs_count >= 2 THEN
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

        IF v_valid_proofs_count >= 2 THEN
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. Fix reevaluate_certification_for_player_rating() — level-aware reference counting
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. Fix trigger_referrals_count_on_reference_delete() — status enum + level-aware
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_referrals_count_on_reference_delete()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. Fix notify_requester_on_reference_response() — 'accepted' -> 'completed'
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_requester_on_reference_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referee_name TEXT;
  v_sport_name TEXT;
  v_rating_label TEXT;
  v_notification_type notification_type_enum;
  v_title TEXT;
  v_body TEXT;
BEGIN
  -- Only trigger when status changes from 'pending' to 'completed' or 'declined'
  IF OLD.status = 'pending' AND NEW.status IN ('completed', 'declined') THEN

    SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), display_name, 'A player')
    INTO v_referee_name
    FROM profile
    WHERE id = NEW.referee_id;

    SELECT
      COALESCE(s.display_name, s.name, 'your sport'),
      COALESCE(rs.label, '')
    INTO v_sport_name, v_rating_label
    FROM player_rating_score prs
    JOIN rating_score rs ON prs.rating_score_id = rs.id
    JOIN rating_system rsys ON rs.rating_system_id = rsys.id
    JOIN sport s ON rsys.sport_id = s.id
    WHERE prs.id = NEW.player_rating_score_id;

    IF NEW.status = 'completed' THEN
      v_notification_type := 'reference_request_accepted'::notification_type_enum;
      v_title := 'Reference Accepted!';
      v_body := v_referee_name || ' confirmed your ' || v_sport_name || ' level (' || v_rating_label || ')';
    ELSE
      v_notification_type := 'reference_request_declined'::notification_type_enum;
      v_title := 'Reference Declined';
      v_body := v_referee_name || ' could not confirm your ' || v_sport_name || ' level';
    END IF;

    INSERT INTO notification (
      user_id, type, target_id, title, body, payload, priority
    ) VALUES (
      NEW.requester_id, v_notification_type, NEW.id, v_title, v_body,
      jsonb_build_object(
        'requestId', NEW.id,
        'refereeId', NEW.referee_id,
        'refereeName', v_referee_name,
        'sportName', v_sport_name,
        'ratingLabel', v_rating_label,
        'status', NEW.status,
        'ratingSupported', NEW.rating_supported,
        'responseMessage', NEW.response_message
      ),
      'normal'::notification_priority_enum
    );

  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 8. Backfill existing rows (after trigger functions are fixed above)
-- ============================================================================

UPDATE rating_reference_request rrr
SET rating_score_id = prs.rating_score_id
FROM player_rating_score prs
WHERE rrr.player_rating_score_id = prs.id
AND rrr.rating_score_id IS NULL;
