-- Remove reference request notification triggers
-- Notifications are now created app-side via notificationFactory for i18n support

DROP TRIGGER IF EXISTS trigger_notify_referee_on_reference_request ON rating_reference_request;
DROP TRIGGER IF EXISTS trigger_notify_requester_on_reference_response ON rating_reference_request;
DROP FUNCTION IF EXISTS notify_referee_on_reference_request();
DROP FUNCTION IF EXISTS notify_requester_on_reference_response();
