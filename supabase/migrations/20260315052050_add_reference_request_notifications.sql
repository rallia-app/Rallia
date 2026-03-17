-- Migration: Add reference request notifications
-- Sends notifications to referees when they receive a reference request
-- Sends notifications to requesters when their reference request is responded to

-- ============================================
-- PHASE 1: ADD NOTIFICATION TYPES
-- ============================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'reference_request_received';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'reference_request_accepted';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'reference_request_declined';

-- ============================================
-- PHASE 2: TRIGGER FOR NEW REFERENCE REQUESTS
-- ============================================

CREATE OR REPLACE FUNCTION notify_referee_on_reference_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_requester_name TEXT;
  v_sport_name TEXT;
  v_rating_label TEXT;
BEGIN
  -- Get requester's name
  SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), display_name, 'A player')
  INTO v_requester_name
  FROM profile
  WHERE id = NEW.requester_id;
  
  -- Get sport name and rating label through the rating chain
  SELECT 
    COALESCE(s.display_name, s.name, 'a sport'),
    COALESCE(rs.label, '')
  INTO v_sport_name, v_rating_label
  FROM player_rating_score prs
  JOIN rating_score rs ON prs.rating_score_id = rs.id
  JOIN rating_system rsys ON rs.rating_system_id = rsys.id
  JOIN sport s ON rsys.sport_id = s.id
  WHERE prs.id = NEW.player_rating_score_id;
  
  -- Insert notification for the referee
  INSERT INTO notification (
    user_id,
    type,
    target_id,
    title,
    body,
    payload,
    priority
  ) VALUES (
    NEW.referee_id,
    'reference_request_received'::notification_type_enum,
    NEW.id,  -- The reference request ID
    'Reference Request',
    v_requester_name || ' is asking you to validate their ' || v_sport_name || ' level (' || v_rating_label || ')',
    jsonb_build_object(
      'requestId', NEW.id,
      'requesterId', NEW.requester_id,
      'requesterName', v_requester_name,
      'sportName', v_sport_name,
      'ratingLabel', v_rating_label,
      'playerRatingScoreId', NEW.player_rating_score_id
    ),
    'normal'::notification_priority_enum
  );
  
  RETURN NEW;
END;
$$;

-- Create trigger for new reference requests
DROP TRIGGER IF EXISTS trigger_notify_referee_on_reference_request ON rating_reference_request;
CREATE TRIGGER trigger_notify_referee_on_reference_request
  AFTER INSERT ON rating_reference_request
  FOR EACH ROW
  EXECUTE FUNCTION notify_referee_on_reference_request();

-- ============================================
-- PHASE 3: TRIGGER FOR REFERENCE REQUEST RESPONSES
-- ============================================

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
  -- Only trigger when status changes from 'pending' to 'accepted' or 'declined'
  IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined') THEN
    
    -- Get referee's name
    SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), display_name, 'A player')
    INTO v_referee_name
    FROM profile
    WHERE id = NEW.referee_id;
    
    -- Get sport name and rating label
    SELECT 
      COALESCE(s.display_name, s.name, 'your sport'),
      COALESCE(rs.label, '')
    INTO v_sport_name, v_rating_label
    FROM player_rating_score prs
    JOIN rating_score rs ON prs.rating_score_id = rs.id
    JOIN rating_system rsys ON rs.rating_system_id = rsys.id
    JOIN sport s ON rsys.sport_id = s.id
    WHERE prs.id = NEW.player_rating_score_id;
    
    -- Determine notification type and message based on response
    IF NEW.status = 'accepted' THEN
      v_notification_type := 'reference_request_accepted'::notification_type_enum;
      v_title := 'Reference Accepted!';
      v_body := v_referee_name || ' confirmed your ' || v_sport_name || ' level (' || v_rating_label || ')';
    ELSE
      v_notification_type := 'reference_request_declined'::notification_type_enum;
      v_title := 'Reference Declined';
      v_body := v_referee_name || ' could not confirm your ' || v_sport_name || ' level';
    END IF;
    
    -- Insert notification for the requester
    INSERT INTO notification (
      user_id,
      type,
      target_id,
      title,
      body,
      payload,
      priority
    ) VALUES (
      NEW.requester_id,
      v_notification_type,
      NEW.id,
      v_title,
      v_body,
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

-- Create trigger for reference request responses
DROP TRIGGER IF EXISTS trigger_notify_requester_on_reference_response ON rating_reference_request;
CREATE TRIGGER trigger_notify_requester_on_reference_response
  AFTER UPDATE ON rating_reference_request
  FOR EACH ROW
  EXECUTE FUNCTION notify_requester_on_reference_response();

-- ============================================
-- PHASE 4: ADD DEFAULT NOTIFICATION PREFERENCES
-- ============================================

-- These types will default to enabled for push notifications
-- Users can disable them in settings

COMMENT ON FUNCTION notify_referee_on_reference_request() IS 
  'Sends a push notification to the referee when someone requests them to validate a rating';

COMMENT ON FUNCTION notify_requester_on_reference_response() IS 
  'Sends a push notification to the requester when their reference request is accepted or declined';
