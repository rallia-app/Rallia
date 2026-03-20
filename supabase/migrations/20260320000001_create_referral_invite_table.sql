CREATE TABLE referral_invite (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_referrer_email UNIQUE (referrer_id, email)
);

CREATE INDEX idx_referral_invite_referrer_id ON referral_invite(referrer_id);
CREATE INDEX idx_referral_invite_email ON referral_invite(email);

ALTER TABLE referral_invite ENABLE ROW LEVEL SECURITY;

-- Users can view their own invites
CREATE POLICY "Users can view own referral invites"
    ON referral_invite FOR SELECT
    USING (auth.uid() = referrer_id);

-- Users can create their own invites
CREATE POLICY "Users can create referral invites"
    ON referral_invite FOR INSERT
    WITH CHECK (auth.uid() = referrer_id);

GRANT SELECT, INSERT ON referral_invite TO authenticated;
