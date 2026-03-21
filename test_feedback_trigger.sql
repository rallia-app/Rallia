-- Insert a test feedback row to trigger the AFTER INSERT trigger
INSERT INTO public.feedback (player_id, category, subject, message, status)
VALUES (
  '882074a5-3984-49c3-81ef-3d50a5bfc78e',
  'bug',
  'Trigger test via SQL insert',
  'Testing whether the trigger fires on a real INSERT',
  'new'
)
RETURNING id, created_at;
