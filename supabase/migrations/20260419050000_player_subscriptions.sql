CREATE TABLE player_subscription (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  revenuecat_customer_id TEXT,
  store TEXT,
  product_identifier TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  in_grace_period BOOLEAN DEFAULT FALSE,
  entitlements JSONB DEFAULT '[]',
  original_transaction_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  grace_period_expires_at TIMESTAMPTZ,
  cancellation_date TIMESTAMPTZ,
  last_revenuecat_event TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id)
);

ALTER TABLE player_subscription ENABLE ROW LEVEL SECURITY;

CREATE POLICY "players_read_own_subscription" ON player_subscription
  FOR SELECT USING (auth.uid() = player_id);

CREATE POLICY "service_role_write_subscription" ON player_subscription
  FOR ALL USING (auth.role() = 'service_role');
