-- Table for capturing email interest from public visitors on the /games marketing page
CREATE TABLE IF NOT EXISTS match_interest (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  ip_address TEXT,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE match_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access on match_interest"
  ON match_interest
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX match_interest_match_id_idx ON match_interest(match_id);
CREATE INDEX match_interest_email_idx ON match_interest(email);
