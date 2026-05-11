CREATE TABLE revenuecat_event_log (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  app_user_id TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX revenuecat_event_log_app_user_idx
  ON revenuecat_event_log(app_user_id);

ALTER TABLE revenuecat_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_write_event_log" ON revenuecat_event_log
  FOR ALL USING (auth.role() = 'service_role');
