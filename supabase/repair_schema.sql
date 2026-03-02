-- =============================================================================
-- REPAIR MIGRATION: Re-apply specific migrations
-- Combines: 20260206000000, 20260206100000, 20260206110000, 20260214000000,
--           20260214100000, 20260214110000, 20260214120000
-- =============================================================================

-- =============================================================================
-- PART 1: MISSING ENUMS (from 20260206000000)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE match_format_enum AS ENUM ('singles', 'doubles');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE court_status_enum AS ENUM ('reserved', 'to_reserve');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE match_visibility_enum AS ENUM ('public', 'private');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE match_join_mode_enum AS ENUM ('direct', 'request');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE cost_split_type_enum AS ENUM ('host_pays', 'split_equal', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE location_type_enum AS ENUM ('facility', 'custom', 'tbd');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE share_channel_enum AS ENUM ('sms', 'email', 'whatsapp', 'share_sheet', 'copy_link');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE share_status_enum AS ENUM ('pending', 'sent', 'viewed', 'accepted', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE badge_status_enum AS ENUM ('self_declared', 'certified', 'disputed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE storage_provider_enum AS ENUM ('supabase', 'backblaze');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE network_member_request_type AS ENUM ('direct_add', 'join_request', 'member_referral', 'invite_code');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_priority_enum AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- PART 2: MISSING TABLES (from 20260206000000)
-- =============================================================================

CREATE TABLE IF NOT EXISTS verification_code (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    used_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_favorite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  favorite_player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT player_favorite_unique UNIQUE(player_id, favorite_player_id),
  CONSTRAINT player_favorite_no_self CHECK (player_id != favorite_player_id)
);

CREATE TABLE IF NOT EXISTS player_block (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  blocked_player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT player_block_unique UNIQUE(player_id, blocked_player_id),
  CONSTRAINT player_block_no_self CHECK (player_id != blocked_player_id)
);

CREATE TABLE IF NOT EXISTS player_favorite_facility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facility(id) ON DELETE CASCADE,
  display_order INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT player_favorite_facility_unique UNIQUE(player_id, facility_id),
  CONSTRAINT player_favorite_facility_order_check CHECK (display_order >= 1 AND display_order <= 3)
);

CREATE TABLE IF NOT EXISTS shared_contact_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  contact_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES shared_contact_list(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(30),
  email VARCHAR(255),
  notes TEXT,
  source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('phone_book', 'manual')),
  device_contact_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_share (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    shared_by UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
    shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    share_channel share_channel_enum NOT NULL,
    share_link_token VARCHAR(64) UNIQUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_share_recipient (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES match_share(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES shared_contact(id) ON DELETE SET NULL,
    contact_list_id UUID REFERENCES shared_contact_list(id) ON DELETE SET NULL,
    recipient_name VARCHAR(150) NOT NULL,
    recipient_phone VARCHAR(30),
    recipient_email VARCHAR(255),
    status share_status_enum NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    response_note TEXT,
    converted_player_id UUID REFERENCES player(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_network (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  network_id UUID NOT NULL REFERENCES network(id) ON DELETE CASCADE,
  posted_by UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, network_id)
);

CREATE TABLE IF NOT EXISTS message_reaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT message_reaction_unique UNIQUE (message_id, player_id, emoji)
);

CREATE TABLE IF NOT EXISTS match_set (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_result_id UUID NOT NULL REFERENCES match_result(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL CHECK (set_number > 0 AND set_number <= 5),
    team1_score INTEGER NOT NULL CHECK (team1_score >= 0),
    team2_score INTEGER NOT NULL CHECK (team2_score >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(match_result_id, set_number)
);

CREATE TABLE IF NOT EXISTS player_sport_play_style (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_sport_id uuid NOT NULL,
  play_style_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT player_sport_play_style_pkey PRIMARY KEY (id),
  CONSTRAINT player_sport_play_style_player_sport_id_fkey 
    FOREIGN KEY (player_sport_id) REFERENCES player_sport(id) ON DELETE CASCADE,
  CONSTRAINT player_sport_play_style_play_style_id_fkey 
    FOREIGN KEY (play_style_id) REFERENCES play_style(id) ON DELETE CASCADE,
  CONSTRAINT player_sport_play_style_unique UNIQUE (player_sport_id)
);

CREATE TABLE IF NOT EXISTS player_sport_play_attribute (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_sport_id uuid NOT NULL,
  play_attribute_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT player_sport_play_attribute_pkey PRIMARY KEY (id),
  CONSTRAINT player_sport_play_attribute_player_sport_id_fkey 
    FOREIGN KEY (player_sport_id) REFERENCES player_sport(id) ON DELETE CASCADE,
  CONSTRAINT player_sport_play_attribute_play_attribute_id_fkey 
    FOREIGN KEY (play_attribute_id) REFERENCES play_attribute(id) ON DELETE CASCADE,
  CONSTRAINT player_sport_play_attribute_unique UNIQUE (player_sport_id, play_attribute_id)
);

CREATE TABLE IF NOT EXISTS notification_preference (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
    notification_type notification_type_enum NOT NULL,
    channel delivery_channel_enum NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_notification_preference UNIQUE (user_id, notification_type, channel)
);

-- =============================================================================
-- PART 3: group_activity TABLE (from 20260206110000)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.group_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID NOT NULL REFERENCES public.network(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL CHECK (activity_type IN (
    'member_joined', 
    'member_left',
    'member_promoted',
    'member_demoted',
    'match_created', 
    'match_completed',
    'game_created',
    'message_sent',
    'group_updated'
  )),
  related_entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.group_activity IS 'Activity feed for group/community home page showing recent events';

CREATE INDEX IF NOT EXISTS idx_group_activity_network_id ON public.group_activity(network_id);
CREATE INDEX IF NOT EXISTS idx_group_activity_created_at ON public.group_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_activity_type ON public.group_activity(activity_type);

-- =============================================================================
-- PART 4: MISSING COLUMNS ON EXISTING TABLES (from 20260206000000)
-- =============================================================================

-- Match table columns
ALTER TABLE match ADD COLUMN IF NOT EXISTS duration match_duration_enum;
ALTER TABLE match ADD COLUMN IF NOT EXISTS custom_duration_minutes INT;
ALTER TABLE match ADD COLUMN IF NOT EXISTS format match_format_enum DEFAULT 'singles';
ALTER TABLE match ADD COLUMN IF NOT EXISTS location_type location_type_enum DEFAULT 'tbd';
ALTER TABLE match ADD COLUMN IF NOT EXISTS facility_id UUID;
ALTER TABLE match ADD COLUMN IF NOT EXISTS court_id UUID;
ALTER TABLE match ADD COLUMN IF NOT EXISTS court_status court_status_enum;
ALTER TABLE match ADD COLUMN IF NOT EXISTS is_court_free BOOLEAN DEFAULT true;
ALTER TABLE match ADD COLUMN IF NOT EXISTS cost_split_type cost_split_type_enum DEFAULT 'split_equal';
ALTER TABLE match ADD COLUMN IF NOT EXISTS estimated_cost DECIMAL(10,2);
ALTER TABLE match ADD COLUMN IF NOT EXISTS min_rating_score_id UUID;
ALTER TABLE match ADD COLUMN IF NOT EXISTS preferred_opponent_gender gender_type;
ALTER TABLE match ADD COLUMN IF NOT EXISTS player_expectation match_type_enum DEFAULT 'both';
ALTER TABLE match ADD COLUMN IF NOT EXISTS visibility match_visibility_enum DEFAULT 'public';
ALTER TABLE match ADD COLUMN IF NOT EXISTS join_mode match_join_mode_enum DEFAULT 'direct';
ALTER TABLE match ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL;
ALTER TABLE match ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE match ADD COLUMN IF NOT EXISTS custom_latitude NUMERIC(10, 7);
ALTER TABLE match ADD COLUMN IF NOT EXISTS custom_longitude NUMERIC(10, 7);
ALTER TABLE match ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE match ADD COLUMN IF NOT EXISTS mutually_cancelled BOOLEAN;
ALTER TABLE match ADD COLUMN IF NOT EXISTS visible_in_groups BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE match ADD COLUMN IF NOT EXISTS visible_in_communities BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE match ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN DEFAULT FALSE;

-- Match result columns
ALTER TABLE match_result ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES player(id);
ALTER TABLE match_result ADD COLUMN IF NOT EXISTS confirmation_deadline TIMESTAMPTZ;
ALTER TABLE match_result ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES player(id);
ALTER TABLE match_result ADD COLUMN IF NOT EXISTS disputed BOOLEAN DEFAULT FALSE;
ALTER TABLE match_result ADD COLUMN IF NOT EXISTS dispute_reason TEXT;

-- Match participant columns
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS match_outcome match_outcome_enum;
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS feedback_completed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS showed_up BOOLEAN;
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS was_late BOOLEAN;
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS star_rating SMALLINT CHECK (star_rating IS NULL OR star_rating >= 1 AND star_rating <= 5);
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS aggregated_at TIMESTAMPTZ;
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS cancellation_reason cancellation_reason_enum;
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS cancellation_notes TEXT;
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS initial_feedback_notification_sent_at TIMESTAMPTZ;
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS feedback_reminder_sent_at TIMESTAMPTZ;

-- Player table columns
ALTER TABLE player ADD COLUMN IF NOT EXISTS expo_push_token TEXT;
ALTER TABLE player ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE player ADD COLUMN IF NOT EXISTS reputation_score DECIMAL(5,2) DEFAULT 0.00 NOT NULL;
ALTER TABLE player ADD COLUMN IF NOT EXISTS chat_rules_agreed_at TIMESTAMPTZ;
ALTER TABLE player ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE player ADD COLUMN IF NOT EXISTS postal_code VARCHAR;
ALTER TABLE player ADD COLUMN IF NOT EXISTS postal_code_country VARCHAR;
ALTER TABLE player ADD COLUMN IF NOT EXISTS postal_code_lat NUMERIC;
ALTER TABLE player ADD COLUMN IF NOT EXISTS postal_code_long NUMERIC;

-- Profile table columns
ALTER TABLE profile ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Player rating score columns
ALTER TABLE player_rating_score ADD COLUMN IF NOT EXISTS badge_status badge_status_enum NOT NULL DEFAULT 'self_declared';
ALTER TABLE player_rating_score ADD COLUMN IF NOT EXISTS approved_proofs_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_rating_score ADD COLUMN IF NOT EXISTS peer_evaluation_average NUMERIC(4,2);
ALTER TABLE player_rating_score ADD COLUMN IF NOT EXISTS peer_evaluation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_rating_score ADD COLUMN IF NOT EXISTS previous_rating_score_id UUID REFERENCES rating_score(id) ON DELETE SET NULL;
ALTER TABLE player_rating_score ADD COLUMN IF NOT EXISTS level_changed_at TIMESTAMPTZ;

-- Rating proof columns
ALTER TABLE rating_proof ADD COLUMN IF NOT EXISTS rating_score_id UUID REFERENCES rating_score(id) ON DELETE SET NULL;

-- Message columns
ALTER TABLE message ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES message(id) ON DELETE SET NULL;
ALTER TABLE message ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
ALTER TABLE message ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE message ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Conversation participant columns
ALTER TABLE conversation_participant ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_participant ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE conversation_participant ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_participant ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Conversation columns
ALTER TABLE conversation ADD COLUMN IF NOT EXISTS picture_url TEXT;

-- Network columns
ALTER TABLE network ADD COLUMN IF NOT EXISTS invite_code VARCHAR(12) UNIQUE;
ALTER TABLE network ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE network ADD COLUMN IF NOT EXISTS max_members INTEGER DEFAULT 10;
ALTER TABLE network ADD COLUMN IF NOT EXISTS member_count INTEGER DEFAULT 0;

-- Network member columns
ALTER TABLE network_member ADD COLUMN IF NOT EXISTS request_type network_member_request_type DEFAULT 'direct_add';

-- Notification columns
ALTER TABLE notification ADD COLUMN IF NOT EXISTS priority notification_priority_enum DEFAULT 'normal';
ALTER TABLE notification ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- File columns
ALTER TABLE file ADD COLUMN IF NOT EXISTS storage_provider storage_provider_enum NOT NULL DEFAULT 'supabase';
ALTER TABLE file ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
ALTER TABLE file ADD COLUMN IF NOT EXISTS thumbnail_status VARCHAR(50) DEFAULT 'pending';

-- Player sport columns
ALTER TABLE player_sport ADD COLUMN IF NOT EXISTS preferred_facility_id UUID REFERENCES facility(id);

-- Sport columns
ALTER TABLE sport ADD COLUMN IF NOT EXISTS display_name VARCHAR NOT NULL DEFAULT '';
ALTER TABLE sport ADD COLUMN IF NOT EXISTS icon_url TEXT;

-- Rating score columns
ALTER TABLE rating_score ADD COLUMN IF NOT EXISTS skill_level skill_level_enum;

-- Facility columns
ALTER TABLE facility ADD COLUMN IF NOT EXISTS timezone TEXT;

-- =============================================================================
-- PART 5: MISSING INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_verification_code_email ON verification_code(email);
CREATE INDEX IF NOT EXISTS idx_verification_code_lookup ON verification_code(email, code, used);
CREATE INDEX IF NOT EXISTS idx_verification_code_expires_at ON verification_code(expires_at);

CREATE INDEX IF NOT EXISTS idx_player_favorite_player_id ON player_favorite(player_id);
CREATE INDEX IF NOT EXISTS idx_player_favorite_favorite_player_id ON player_favorite(favorite_player_id);

CREATE INDEX IF NOT EXISTS idx_player_block_player_id ON player_block(player_id);
CREATE INDEX IF NOT EXISTS idx_player_block_blocked_player_id ON player_block(blocked_player_id);

CREATE INDEX IF NOT EXISTS idx_player_favorite_facility_player_id ON player_favorite_facility(player_id);
CREATE INDEX IF NOT EXISTS idx_player_favorite_facility_facility_id ON player_favorite_facility(facility_id);

CREATE INDEX IF NOT EXISTS idx_shared_contact_list_player ON shared_contact_list(player_id);
CREATE INDEX IF NOT EXISTS idx_shared_contact_list_id ON shared_contact(list_id);

CREATE INDEX IF NOT EXISTS idx_match_share_match_id ON match_share(match_id);
CREATE INDEX IF NOT EXISTS idx_match_share_shared_by ON match_share(shared_by);
CREATE INDEX IF NOT EXISTS idx_match_share_token ON match_share(share_link_token);
CREATE INDEX IF NOT EXISTS idx_match_share_recipient_share_id ON match_share_recipient(share_id);

CREATE INDEX IF NOT EXISTS idx_match_network_match_id ON match_network(match_id);
CREATE INDEX IF NOT EXISTS idx_match_network_network_id ON match_network(network_id);
CREATE INDEX IF NOT EXISTS idx_match_network_posted_by ON match_network(posted_by);

CREATE INDEX IF NOT EXISTS idx_message_reaction_message_id ON message_reaction(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reaction_player_id ON message_reaction(player_id);

CREATE INDEX IF NOT EXISTS idx_match_set_result_id ON match_set(match_result_id);

CREATE INDEX IF NOT EXISTS idx_player_sport_play_style_player_sport_id ON player_sport_play_style(player_sport_id);
CREATE INDEX IF NOT EXISTS idx_player_sport_play_style_play_style_id ON player_sport_play_style(play_style_id);

CREATE INDEX IF NOT EXISTS idx_player_sport_play_attribute_player_sport_id ON player_sport_play_attribute(player_sport_id);
CREATE INDEX IF NOT EXISTS idx_player_sport_play_attribute_play_attribute_id ON player_sport_play_attribute(play_attribute_id);

CREATE INDEX IF NOT EXISTS idx_match_timezone ON match(timezone);
CREATE INDEX IF NOT EXISTS idx_match_is_auto_generated ON match(is_auto_generated);

CREATE INDEX IF NOT EXISTS idx_player_last_seen_at ON player(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_player_reputation_score ON player(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_player_push_token ON player(expo_push_token) WHERE expo_push_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_network_invite_code ON network(invite_code) WHERE invite_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_network_is_private ON network(is_private) WHERE is_private = false;

CREATE INDEX IF NOT EXISTS idx_notification_preference_user ON notification_preference(user_id);
CREATE INDEX IF NOT EXISTS idx_player_rating_score_badge_status ON player_rating_score(badge_status);
CREATE INDEX IF NOT EXISTS idx_rating_proof_rating_score_id ON rating_proof(rating_score_id);
CREATE INDEX IF NOT EXISTS idx_message_reply_to ON message(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_match_result_submitted_by ON match_result(submitted_by);

-- =============================================================================
-- PART 6: ENABLE RLS ON NEW TABLES
-- =============================================================================

ALTER TABLE verification_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_favorite ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_favorite_facility ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_contact_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_share_recipient ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_network ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_sport_play_style ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_sport_play_attribute ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_activity ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- PART 7: RLS POLICIES
-- =============================================================================

-- Verification code policies
DROP POLICY IF EXISTS "Allow anonymous insert" ON verification_code;
CREATE POLICY "Allow anonymous insert" ON verification_code FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow select by email" ON verification_code;
CREATE POLICY "Allow select by email" ON verification_code FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow update by email" ON verification_code;
CREATE POLICY "Allow update by email" ON verification_code FOR UPDATE USING (true) WITH CHECK (true);

-- Player favorite policies
DROP POLICY IF EXISTS "Users can view their own favorites" ON player_favorite;
CREATE POLICY "Users can view their own favorites" ON player_favorite FOR SELECT USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Users can add favorites" ON player_favorite;
CREATE POLICY "Users can add favorites" ON player_favorite FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Users can delete their own favorites" ON player_favorite;
CREATE POLICY "Users can delete their own favorites" ON player_favorite FOR DELETE USING (auth.uid() = player_id);

-- Player block policies
DROP POLICY IF EXISTS "Users can view their own blocks" ON player_block;
CREATE POLICY "Users can view their own blocks" ON player_block FOR SELECT USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Users can add blocks" ON player_block;
CREATE POLICY "Users can add blocks" ON player_block FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Users can delete their own blocks" ON player_block;
CREATE POLICY "Users can delete their own blocks" ON player_block FOR DELETE USING (auth.uid() = player_id);

-- Player favorite facility policies
DROP POLICY IF EXISTS "Players can view own favorite facilities" ON player_favorite_facility;
CREATE POLICY "Players can view own favorite facilities" ON player_favorite_facility FOR SELECT USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can insert own favorite facilities" ON player_favorite_facility;
CREATE POLICY "Players can insert own favorite facilities" ON player_favorite_facility FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can update own favorite facilities" ON player_favorite_facility;
CREATE POLICY "Players can update own favorite facilities" ON player_favorite_facility FOR UPDATE USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can delete own favorite facilities" ON player_favorite_facility;
CREATE POLICY "Players can delete own favorite facilities" ON player_favorite_facility FOR DELETE USING (auth.uid() = player_id);

-- Shared contact list policies
DROP POLICY IF EXISTS "Users can view own contact lists" ON shared_contact_list;
CREATE POLICY "Users can view own contact lists" ON shared_contact_list FOR SELECT TO authenticated USING (player_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own contact lists" ON shared_contact_list;
CREATE POLICY "Users can create own contact lists" ON shared_contact_list FOR INSERT TO authenticated WITH CHECK (player_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own contact lists" ON shared_contact_list;
CREATE POLICY "Users can update own contact lists" ON shared_contact_list FOR UPDATE TO authenticated USING (player_id = auth.uid()) WITH CHECK (player_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own contact lists" ON shared_contact_list;
CREATE POLICY "Users can delete own contact lists" ON shared_contact_list FOR DELETE TO authenticated USING (player_id = auth.uid());

-- Shared contact policies
DROP POLICY IF EXISTS "Users can view contacts in own lists" ON shared_contact;
CREATE POLICY "Users can view contacts in own lists" ON shared_contact FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_contact_list scl WHERE scl.id = shared_contact.list_id AND scl.player_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can create contacts in own lists" ON shared_contact;
CREATE POLICY "Users can create contacts in own lists" ON shared_contact FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM shared_contact_list scl WHERE scl.id = shared_contact.list_id AND scl.player_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can update contacts in own lists" ON shared_contact;
CREATE POLICY "Users can update contacts in own lists" ON shared_contact FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_contact_list scl WHERE scl.id = shared_contact.list_id AND scl.player_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can delete contacts in own lists" ON shared_contact;
CREATE POLICY "Users can delete contacts in own lists" ON shared_contact FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_contact_list scl WHERE scl.id = shared_contact.list_id AND scl.player_id = auth.uid())
);

-- Match share policies
DROP POLICY IF EXISTS "Users can view their own match shares" ON match_share;
CREATE POLICY "Users can view their own match shares" ON match_share FOR SELECT USING (auth.uid() = shared_by);

DROP POLICY IF EXISTS "Users can create match shares" ON match_share;
CREATE POLICY "Users can create match shares" ON match_share FOR INSERT WITH CHECK (auth.uid() = shared_by);

DROP POLICY IF EXISTS "Users can update their own match shares" ON match_share;
CREATE POLICY "Users can update their own match shares" ON match_share FOR UPDATE USING (auth.uid() = shared_by);

DROP POLICY IF EXISTS "Users can delete their own match shares" ON match_share;
CREATE POLICY "Users can delete their own match shares" ON match_share FOR DELETE USING (auth.uid() = shared_by);

-- Match share recipient policies
DROP POLICY IF EXISTS "Users can view recipients of their shares" ON match_share_recipient;
CREATE POLICY "Users can view recipients of their shares" ON match_share_recipient FOR SELECT USING (
    EXISTS (SELECT 1 FROM match_share ms WHERE ms.id = match_share_recipient.share_id AND ms.shared_by = auth.uid())
);

DROP POLICY IF EXISTS "Users can create recipients for their shares" ON match_share_recipient;
CREATE POLICY "Users can create recipients for their shares" ON match_share_recipient FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM match_share ms WHERE ms.id = match_share_recipient.share_id AND ms.shared_by = auth.uid())
);

DROP POLICY IF EXISTS "Users can update recipients of their shares" ON match_share_recipient;
CREATE POLICY "Users can update recipients of their shares" ON match_share_recipient FOR UPDATE USING (
    EXISTS (SELECT 1 FROM match_share ms WHERE ms.id = match_share_recipient.share_id AND ms.shared_by = auth.uid())
);

DROP POLICY IF EXISTS "Users can delete recipients of their shares" ON match_share_recipient;
CREATE POLICY "Users can delete recipients of their shares" ON match_share_recipient FOR DELETE USING (
    EXISTS (SELECT 1 FROM match_share ms WHERE ms.id = match_share_recipient.share_id AND ms.shared_by = auth.uid())
);

-- Match network policies
DROP POLICY IF EXISTS "match_network_select_policy" ON match_network;
CREATE POLICY "match_network_select_policy" ON match_network FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM network_member nm
      WHERE nm.network_id = match_network.network_id
      AND nm.player_id = auth.uid()
      AND nm.status = 'active'
    )
);

DROP POLICY IF EXISTS "match_network_insert_policy" ON match_network;
CREATE POLICY "match_network_insert_policy" ON match_network FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM network_member nm
      WHERE nm.network_id = network_id
      AND nm.player_id = auth.uid()
      AND nm.status = 'active'
    )
    AND
    (
      EXISTS (SELECT 1 FROM match_participant mp WHERE mp.match_id = match_id AND mp.player_id = auth.uid())
      OR
      EXISTS (SELECT 1 FROM match m WHERE m.id = match_id AND m.created_by = auth.uid())
    )
);

DROP POLICY IF EXISTS "match_network_delete_policy" ON match_network;
CREATE POLICY "match_network_delete_policy" ON match_network FOR DELETE USING (
    posted_by = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM network_member nm
      WHERE nm.network_id = match_network.network_id
      AND nm.player_id = auth.uid()
      AND nm.role = 'moderator'
      AND nm.status = 'active'
    )
);

-- Message reaction policies
DROP POLICY IF EXISTS "Users can view reactions in their conversations" ON message_reaction;
CREATE POLICY "Users can view reactions in their conversations" ON message_reaction FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM message m
      JOIN conversation_participant cp ON cp.conversation_id = m.conversation_id
      WHERE m.id = message_reaction.message_id AND cp.player_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Users can add reactions to messages in their conversations" ON message_reaction;
CREATE POLICY "Users can add reactions to messages in their conversations" ON message_reaction FOR INSERT WITH CHECK (
    player_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM message m
      JOIN conversation_participant cp ON cp.conversation_id = m.conversation_id
      WHERE m.id = message_reaction.message_id AND cp.player_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Users can remove their own reactions" ON message_reaction;
CREATE POLICY "Users can remove their own reactions" ON message_reaction FOR DELETE USING (player_id = auth.uid());

-- Match set policies
DROP POLICY IF EXISTS "Anyone can view match sets" ON match_set;
CREATE POLICY "Anyone can view match sets" ON match_set FOR SELECT USING (true);

DROP POLICY IF EXISTS "Match participants can insert match sets" ON match_set;
CREATE POLICY "Match participants can insert match sets" ON match_set FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM match_result mr
      JOIN match_participant mp ON mp.match_id = mr.match_id
      WHERE mr.id = match_result_id AND mp.player_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Match participants can update match sets" ON match_set;
CREATE POLICY "Match participants can update match sets" ON match_set FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM match_result mr
      JOIN match_participant mp ON mp.match_id = mr.match_id
      WHERE mr.id = match_result_id AND mp.player_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Match participants can delete match sets" ON match_set;
CREATE POLICY "Match participants can delete match sets" ON match_set FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM match_result mr
      JOIN match_participant mp ON mp.match_id = mr.match_id
      WHERE mr.id = match_result_id AND mp.player_id = auth.uid()
    )
);

-- Notification preference policies
DROP POLICY IF EXISTS "Users can view their own notification preferences" ON notification_preference;
CREATE POLICY "Users can view their own notification preferences" ON notification_preference FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own notification preferences" ON notification_preference;
CREATE POLICY "Users can create their own notification preferences" ON notification_preference FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notification preferences" ON notification_preference;
CREATE POLICY "Users can update their own notification preferences" ON notification_preference FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own notification preferences" ON notification_preference;
CREATE POLICY "Users can delete their own notification preferences" ON notification_preference FOR DELETE USING (auth.uid() = user_id);

-- Group activity policies
DROP POLICY IF EXISTS "Members can view group activity" ON public.group_activity;
CREATE POLICY "Members can view group activity" ON public.group_activity FOR SELECT USING (
    network_id IN (
      SELECT network_id FROM public.network_member 
      WHERE player_id = auth.uid() AND status = 'active'
    )
    OR network_id IN (
      SELECT id FROM public.network WHERE created_by = auth.uid()
    )
);

DROP POLICY IF EXISTS "System can insert group activity" ON public.group_activity;
CREATE POLICY "System can insert group activity" ON public.group_activity FOR INSERT WITH CHECK (
    network_id IN (
      SELECT network_id FROM public.network_member 
      WHERE player_id = auth.uid() AND status = 'active'
    )
    OR network_id IN (
      SELECT id FROM public.network WHERE created_by = auth.uid()
    )
);

-- =============================================================================
-- PART 8: NETWORK TYPE (Community)
-- =============================================================================

INSERT INTO network_type (name, display_name, description, is_active)
VALUES ('community', 'Community', 'Public or private communities for players with shared interests', true)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- PART 9: FUNCTIONS
-- =============================================================================

-- get_public_communities function
CREATE OR REPLACE FUNCTION get_public_communities(p_player_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  cover_image_url TEXT,
  member_count INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ,
  is_member BOOLEAN,
  membership_status TEXT,
  membership_role TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.name,
    n.description,
    n.cover_image_url,
    n.member_count,
    n.created_by,
    n.created_at,
    CASE WHEN nm.id IS NOT NULL THEN true ELSE false END as is_member,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  LEFT JOIN public.network_member nm ON nm.network_id = n.id 
    AND nm.player_id = COALESCE(p_player_id, auth.uid())
  WHERE nt.name = 'community'
    AND n.is_private = false
    AND n.member_count > 0
    AND n.archived_at IS NULL
  ORDER BY n.member_count DESC, n.created_at DESC;
END;
$$;

-- check_community_access function
CREATE OR REPLACE FUNCTION check_community_access(
  p_community_id UUID,
  p_player_id UUID DEFAULT NULL
)
RETURNS TABLE (
  can_access BOOLEAN,
  is_member BOOLEAN,
  membership_status TEXT,
  membership_role TEXT,
  is_public BOOLEAN,
  has_active_moderator BOOLEAN,
  access_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_community_exists BOOLEAN;
  v_is_public BOOLEAN;
  v_is_archived BOOLEAN;
  v_created_by UUID;
  v_membership_status TEXT;
  v_membership_role TEXT;
  v_has_moderator BOOLEAN;
BEGIN
  SELECT 
    TRUE,
    NOT n.is_private,
    n.archived_at IS NOT NULL,
    n.created_by
  INTO 
    v_community_exists,
    v_is_public,
    v_is_archived,
    v_created_by
  FROM public.network n
  JOIN public.network_type nt ON nt.id = n.network_type_id
  WHERE n.id = p_community_id
    AND nt.name = 'community';
  
  IF NOT v_community_exists THEN
    RETURN QUERY SELECT 
      FALSE,
      FALSE,
      NULL::TEXT,
      NULL::TEXT,
      FALSE,
      FALSE,
      'Community not found'::TEXT;
    RETURN;
  END IF;
  
  IF v_is_archived THEN
    RETURN QUERY SELECT 
      FALSE,
      FALSE,
      NULL::TEXT,
      NULL::TEXT,
      v_is_public,
      FALSE,
      'Community is archived'::TEXT;
    RETURN;
  END IF;
  
  SELECT EXISTS (
    SELECT 1 FROM public.network_member
    WHERE network_id = p_community_id
      AND role = 'moderator'
      AND status = 'active'
  ) INTO v_has_moderator;
  
  IF p_player_id IS NULL THEN
    RETURN QUERY SELECT 
      v_is_public,
      FALSE,
      NULL::TEXT,
      NULL::TEXT,
      v_is_public,
      v_has_moderator,
      CASE 
        WHEN v_is_public THEN 'Public community - view access'
        ELSE 'Login required for access'
      END::TEXT;
    RETURN;
  END IF;
  
  SELECT 
    nm.status::TEXT,
    nm.role::TEXT
  INTO v_membership_status, v_membership_role
  FROM public.network_member nm
  WHERE nm.network_id = p_community_id AND nm.player_id = p_player_id;
  
  IF p_player_id = v_created_by THEN
    RETURN QUERY SELECT 
      TRUE,
      COALESCE(v_membership_status = 'active', FALSE),
      v_membership_status,
      v_membership_role,
      v_is_public,
      v_has_moderator,
      'Creator has full access'::TEXT;
    RETURN;
  END IF;
  
  IF v_membership_status = 'active' THEN
    RETURN QUERY SELECT 
      TRUE,
      TRUE,
      v_membership_status,
      v_membership_role,
      v_is_public,
      v_has_moderator,
      'Active member'::TEXT;
    RETURN;
  END IF;
  
  IF v_membership_status = 'pending' THEN
    RETURN QUERY SELECT 
      FALSE,
      FALSE,
      v_membership_status,
      v_membership_role,
      v_is_public,
      v_has_moderator,
      'Membership request pending'::TEXT;
    RETURN;
  END IF;
  
  RETURN QUERY SELECT 
    FALSE,
    FALSE,
    NULL::TEXT,
    NULL::TEXT,
    v_is_public,
    v_has_moderator,
    CASE 
      WHEN NOT v_has_moderator THEN 'Community has no active moderator'
      ELSE 'Membership required'
    END::TEXT;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION check_community_access(UUID, UUID) TO authenticated;

-- handle_orphaned_community function
CREATE OR REPLACE FUNCTION handle_orphaned_community()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.member_count = 0 AND (OLD.member_count IS NULL OR OLD.member_count > 0) THEN
    NEW.archived_at := NOW();
  END IF;
  
  IF NEW.member_count > 0 AND OLD.member_count = 0 AND OLD.archived_at IS NOT NULL THEN
    NEW.archived_at := NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_handle_orphaned_community ON public.network;
CREATE TRIGGER trigger_handle_orphaned_community
BEFORE UPDATE OF member_count ON public.network
FOR EACH ROW
EXECUTE FUNCTION handle_orphaned_community();

-- auto_add_creator_as_moderator function
CREATE OR REPLACE FUNCTION auto_add_creator_as_moderator()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.network_member (
    network_id,
    player_id,
    role,
    status,
    joined_at
  )
  VALUES (
    NEW.id,
    NEW.created_by,
    'moderator',
    'active',
    NOW()
  )
  ON CONFLICT (network_id, player_id) DO NOTHING;
  
  UPDATE public.network
  SET member_count = 1
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_add_creator ON public.network;
CREATE TRIGGER trigger_auto_add_creator
  AFTER INSERT ON public.network
  FOR EACH ROW
  EXECUTE FUNCTION auto_add_creator_as_moderator();

-- log_network_created_activity function
CREATE OR REPLACE FUNCTION log_network_created_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.group_activity (
    network_id,
    player_id,
    activity_type,
    metadata
  )
  VALUES (
    NEW.id,
    NEW.created_by,
    'group_updated',
    jsonb_build_object(
      'action', 'created',
      'network_name', NEW.name,
      'created_at', NEW.created_at
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_log_network_created ON public.network;
CREATE TRIGGER trigger_log_network_created
  AFTER INSERT ON public.network
  FOR EACH ROW
  EXECUTE FUNCTION log_network_created_activity();

-- log_member_joined_activity function
CREATE OR REPLACE FUNCTION log_member_joined_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' THEN
    INSERT INTO public.group_activity (network_id, player_id, activity_type, metadata)
    VALUES (
      NEW.network_id, 
      NEW.player_id, 
      'member_joined',
      jsonb_build_object('joined_at', NEW.joined_at)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_log_member_joined ON public.network_member;
CREATE TRIGGER trigger_log_member_joined
  AFTER INSERT ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION log_member_joined_activity();

-- log_member_left_activity function
CREATE OR REPLACE FUNCTION log_member_left_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'active' AND (NEW.status = 'removed' OR NEW.status = 'blocked') THEN
    INSERT INTO public.group_activity (network_id, player_id, activity_type, metadata)
    VALUES (
      OLD.network_id, 
      OLD.player_id, 
      'member_left',
      jsonb_build_object('left_at', COALESCE(NEW.left_at, NOW()))
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_log_member_left ON public.network_member;
CREATE TRIGGER trigger_log_member_left
  AFTER UPDATE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION log_member_left_activity();

-- get_group_activity function
CREATE OR REPLACE FUNCTION get_group_activity(
  p_network_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  network_id UUID,
  player_id UUID,
  activity_type VARCHAR(50),
  related_entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  player_first_name VARCHAR,
  player_last_name VARCHAR,
  player_avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ga.id,
    ga.network_id,
    ga.player_id,
    ga.activity_type,
    ga.related_entity_id,
    ga.metadata,
    ga.created_at,
    p.first_name AS player_first_name,
    p.last_name AS player_last_name,
    p.avatar_url AS player_avatar_url
  FROM public.group_activity ga
  LEFT JOIN public.player p ON p.id = ga.player_id
  WHERE ga.network_id = p_network_id
  ORDER BY ga.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_group_activity(UUID, INTEGER) TO authenticated;

-- update_network_member_count function
CREATE OR REPLACE FUNCTION update_network_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE public.network 
    SET member_count = member_count + 1 
    WHERE id = NEW.network_id;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    UPDATE public.network 
    SET member_count = GREATEST(0, member_count - 1) 
    WHERE id = OLD.network_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'active' AND OLD.status != 'active' THEN
      UPDATE public.network 
      SET member_count = member_count + 1 
      WHERE id = NEW.network_id;
    ELSIF NEW.status != 'active' AND OLD.status = 'active' THEN
      UPDATE public.network 
      SET member_count = GREATEST(0, member_count - 1) 
      WHERE id = NEW.network_id;
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_network_member_count ON public.network_member;
DROP TRIGGER IF EXISTS trigger_update_network_member_count_insert ON public.network_member;
DROP TRIGGER IF EXISTS trigger_update_network_member_count_update ON public.network_member;
DROP TRIGGER IF EXISTS trigger_update_network_member_count_delete ON public.network_member;

CREATE TRIGGER trigger_update_network_member_count_insert
  AFTER INSERT ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION update_network_member_count();

CREATE TRIGGER trigger_update_network_member_count_update
  AFTER UPDATE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION update_network_member_count();

CREATE TRIGGER trigger_update_network_member_count_delete
  AFTER DELETE ON public.network_member
  FOR EACH ROW
  EXECUTE FUNCTION update_network_member_count();

-- =============================================================================
-- PART 10: Fix existing networks
-- =============================================================================

-- Add creator as moderator for orphaned networks
INSERT INTO public.network_member (network_id, player_id, role, status, joined_at)
SELECT 
  n.id,
  n.created_by,
  'moderator',
  'active',
  n.created_at
FROM public.network n
WHERE NOT EXISTS (
  SELECT 1 FROM public.network_member nm 
  WHERE nm.network_id = n.id AND nm.player_id = n.created_by
)
AND n.created_by IS NOT NULL
ON CONFLICT (network_id, player_id) DO NOTHING;

-- =============================================================================
-- PART 11: Update member_count for all networks
-- =============================================================================

UPDATE public.network n
SET member_count = COALESCE((
  SELECT COUNT(*) 
  FROM public.network_member nm 
  WHERE nm.network_id = n.id AND nm.status = 'active'
), 0);

UPDATE public.network n
SET max_members = 10
WHERE max_members IS NULL OR max_members = 0;

-- =============================================================================
-- COMPLETION
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Repair migration completed successfully!';
END $$;
