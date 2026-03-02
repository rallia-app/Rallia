-- =============================================================================
-- Migration: Sync Missing Schema Elements
-- Description: Adds all missing tables, columns, enums, constraints, and RLS 
--              policies that exist in migrations but are missing from the database.
--              NO DROPS - only ADDs.
-- Created: 2026-02-06
-- =============================================================================

-- =============================================================================
-- PART 1: MISSING ENUMS
-- =============================================================================

-- Match format enum
DO $$ BEGIN
  CREATE TYPE match_format_enum AS ENUM ('singles', 'doubles');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Court status enum
DO $$ BEGIN
  CREATE TYPE court_status_enum AS ENUM ('reserved', 'to_reserve');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Match visibility enum
DO $$ BEGIN
  CREATE TYPE match_visibility_enum AS ENUM ('public', 'private');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Match join mode enum
DO $$ BEGIN
  CREATE TYPE match_join_mode_enum AS ENUM ('direct', 'request');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cost split type enum
DO $$ BEGIN
  CREATE TYPE cost_split_type_enum AS ENUM ('host_pays', 'split_equal', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Location type enum
DO $$ BEGIN
  CREATE TYPE location_type_enum AS ENUM ('facility', 'custom', 'tbd');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Share channel enum
DO $$ BEGIN
  CREATE TYPE share_channel_enum AS ENUM ('sms', 'email', 'whatsapp', 'share_sheet', 'copy_link');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Share status enum
DO $$ BEGIN
  CREATE TYPE share_status_enum AS ENUM ('pending', 'sent', 'viewed', 'accepted', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Badge status enum
DO $$ BEGIN
  CREATE TYPE badge_status_enum AS ENUM ('self_declared', 'certified', 'disputed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Storage provider enum
DO $$ BEGIN
  CREATE TYPE storage_provider_enum AS ENUM ('supabase', 'backblaze');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Network member request type enum
DO $$ BEGIN
  CREATE TYPE network_member_request_type AS ENUM ('direct_add', 'join_request', 'member_referral', 'invite_code');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Match outcome enum
DO $$ BEGIN
  CREATE TYPE match_outcome_enum AS ENUM ('win', 'loss', 'draw');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cancellation reason enum
DO $$ BEGIN
  CREATE TYPE cancellation_reason_enum AS ENUM ('schedule_conflict', 'weather', 'injury', 'other', 'no_show');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Notification priority enum
DO $$ BEGIN
  CREATE TYPE notification_priority_enum AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- PART 2: MISSING TABLES
-- =============================================================================

-- Verification code table
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

-- Player favorite table
CREATE TABLE IF NOT EXISTS player_favorite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  favorite_player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT player_favorite_unique UNIQUE(player_id, favorite_player_id),
  CONSTRAINT player_favorite_no_self CHECK (player_id != favorite_player_id)
);

-- Player block table
CREATE TABLE IF NOT EXISTS player_block (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  blocked_player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT player_block_unique UNIQUE(player_id, blocked_player_id),
  CONSTRAINT player_block_no_self CHECK (player_id != blocked_player_id)
);

-- Player favorite facility table
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

-- Shared contact list table
CREATE TABLE IF NOT EXISTS shared_contact_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  contact_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Shared contact table
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

-- Match share table
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

-- Match share recipient table
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

-- Match network junction table
CREATE TABLE IF NOT EXISTS match_network (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  network_id UUID NOT NULL REFERENCES network(id) ON DELETE CASCADE,
  posted_by UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, network_id)
);

-- Message reaction table
CREATE TABLE IF NOT EXISTS message_reaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT message_reaction_unique UNIQUE (message_id, player_id, emoji)
);

-- Match set table
CREATE TABLE IF NOT EXISTS match_set (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_result_id UUID NOT NULL REFERENCES match_result(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL CHECK (set_number > 0 AND set_number <= 5),
    team1_score INTEGER NOT NULL CHECK (team1_score >= 0),
    team2_score INTEGER NOT NULL CHECK (team2_score >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(match_result_id, set_number)
);

-- Player sport play style junction table
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

-- Player sport play attribute junction table
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

-- Notification preference table
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
-- PART 3: MISSING COLUMNS ON EXISTING TABLES
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
ALTER TABLE match ADD COLUMN IF NOT EXISTS location extensions.geography;
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
ALTER TABLE player ADD COLUMN IF NOT EXISTS postal_code_location extensions.geography;

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
ALTER TABLE message ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Conversation participant columns
ALTER TABLE conversation_participant ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_participant ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE conversation_participant ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_participant ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Conversation columns
ALTER TABLE conversation ADD COLUMN IF NOT EXISTS picture_url TEXT;

-- Network columns
ALTER TABLE network ADD COLUMN IF NOT EXISTS invite_code VARCHAR(12) UNIQUE;

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

-- Rating system columns
ALTER TABLE rating_system ADD COLUMN IF NOT EXISTS code rating_system_code_enum;

-- Facility columns
ALTER TABLE facility ADD COLUMN IF NOT EXISTS timezone TEXT;

-- =============================================================================
-- PART 4: MISSING FOREIGN KEY CONSTRAINTS
-- =============================================================================

-- Match FKs (add only if not exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'match_facility_id_fkey' AND table_name = 'match'
  ) THEN
    ALTER TABLE match ADD CONSTRAINT match_facility_id_fkey 
      FOREIGN KEY (facility_id) REFERENCES facility(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'match_court_id_fkey' AND table_name = 'match'
  ) THEN
    ALTER TABLE match ADD CONSTRAINT match_court_id_fkey 
      FOREIGN KEY (court_id) REFERENCES court(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'match_min_rating_score_id_fkey' AND table_name = 'match'
  ) THEN
    ALTER TABLE match ADD CONSTRAINT match_min_rating_score_id_fkey 
      FOREIGN KEY (min_rating_score_id) REFERENCES rating_score(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =============================================================================
-- PART 5: MISSING INDEXES
-- =============================================================================

-- Verification code indexes
CREATE INDEX IF NOT EXISTS idx_verification_code_email ON verification_code(email);
CREATE INDEX IF NOT EXISTS idx_verification_code_lookup ON verification_code(email, code, used);
CREATE INDEX IF NOT EXISTS idx_verification_code_expires_at ON verification_code(expires_at);

-- Player favorite indexes
CREATE INDEX IF NOT EXISTS idx_player_favorite_player_id ON player_favorite(player_id);
CREATE INDEX IF NOT EXISTS idx_player_favorite_favorite_player_id ON player_favorite(favorite_player_id);

-- Player block indexes
CREATE INDEX IF NOT EXISTS idx_player_block_player_id ON player_block(player_id);
CREATE INDEX IF NOT EXISTS idx_player_block_blocked_player_id ON player_block(blocked_player_id);

-- Player favorite facility indexes
CREATE INDEX IF NOT EXISTS idx_player_favorite_facility_player_id ON player_favorite_facility(player_id);
CREATE INDEX IF NOT EXISTS idx_player_favorite_facility_facility_id ON player_favorite_facility(facility_id);

-- Shared contact indexes
CREATE INDEX IF NOT EXISTS idx_shared_contact_list_player ON shared_contact_list(player_id);
CREATE INDEX IF NOT EXISTS idx_shared_contact_list_id ON shared_contact(list_id);

-- Match share indexes
CREATE INDEX IF NOT EXISTS idx_match_share_match_id ON match_share(match_id);
CREATE INDEX IF NOT EXISTS idx_match_share_shared_by ON match_share(shared_by);
CREATE INDEX IF NOT EXISTS idx_match_share_token ON match_share(share_link_token);
CREATE INDEX IF NOT EXISTS idx_match_share_recipient_share_id ON match_share_recipient(share_id);

-- Match network indexes
CREATE INDEX IF NOT EXISTS idx_match_network_match_id ON match_network(match_id);
CREATE INDEX IF NOT EXISTS idx_match_network_network_id ON match_network(network_id);
CREATE INDEX IF NOT EXISTS idx_match_network_posted_by ON match_network(posted_by);

-- Message reaction indexes
CREATE INDEX IF NOT EXISTS idx_message_reaction_message_id ON message_reaction(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reaction_player_id ON message_reaction(player_id);

-- Match set indexes
CREATE INDEX IF NOT EXISTS idx_match_set_result_id ON match_set(match_result_id);

-- Player sport play style indexes
CREATE INDEX IF NOT EXISTS idx_player_sport_play_style_player_sport_id ON player_sport_play_style(player_sport_id);
CREATE INDEX IF NOT EXISTS idx_player_sport_play_style_play_style_id ON player_sport_play_style(play_style_id);

-- Player sport play attribute indexes
CREATE INDEX IF NOT EXISTS idx_player_sport_play_attribute_player_sport_id ON player_sport_play_attribute(player_sport_id);
CREATE INDEX IF NOT EXISTS idx_player_sport_play_attribute_play_attribute_id ON player_sport_play_attribute(play_attribute_id);

-- Match indexes
CREATE INDEX IF NOT EXISTS idx_match_timezone ON match(timezone);
CREATE INDEX IF NOT EXISTS idx_match_is_auto_generated ON match(is_auto_generated);

-- Player indexes
CREATE INDEX IF NOT EXISTS idx_player_last_seen_at ON player(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_player_reputation_score ON player(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_player_push_token ON player(expo_push_token) WHERE expo_push_token IS NOT NULL;

-- Network indexes
CREATE INDEX IF NOT EXISTS idx_network_invite_code ON network(invite_code) WHERE invite_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_network_is_private ON network(is_private) WHERE is_private = false;

-- Notification preference indexes
CREATE INDEX IF NOT EXISTS idx_notification_preference_user ON notification_preference(user_id);

-- Player rating score indexes
CREATE INDEX IF NOT EXISTS idx_player_rating_score_badge_status ON player_rating_score(badge_status);

-- Rating proof indexes
CREATE INDEX IF NOT EXISTS idx_rating_proof_rating_score_id ON rating_proof(rating_score_id);

-- Message indexes
CREATE INDEX IF NOT EXISTS idx_message_reply_to ON message(reply_to_message_id);

-- Match result indexes
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

-- =============================================================================
-- PART 7: RLS POLICIES FOR NEW TABLES
-- =============================================================================

-- Verification code policies
DROP POLICY IF EXISTS "Allow anonymous insert" ON verification_code;
CREATE POLICY "Allow anonymous insert" ON verification_code
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow select by email" ON verification_code;
CREATE POLICY "Allow select by email" ON verification_code
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow update by email" ON verification_code;
CREATE POLICY "Allow update by email" ON verification_code
    FOR UPDATE USING (true) WITH CHECK (true);

-- Player favorite policies
DROP POLICY IF EXISTS "Users can view their own favorites" ON player_favorite;
CREATE POLICY "Users can view their own favorites" ON player_favorite
  FOR SELECT USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Users can add favorites" ON player_favorite;
CREATE POLICY "Users can add favorites" ON player_favorite
  FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Users can delete their own favorites" ON player_favorite;
CREATE POLICY "Users can delete their own favorites" ON player_favorite
  FOR DELETE USING (auth.uid() = player_id);

-- Player block policies
DROP POLICY IF EXISTS "Users can view their own blocks" ON player_block;
CREATE POLICY "Users can view their own blocks" ON player_block
  FOR SELECT USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Users can add blocks" ON player_block;
CREATE POLICY "Users can add blocks" ON player_block
  FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Users can delete their own blocks" ON player_block;
CREATE POLICY "Users can delete their own blocks" ON player_block
  FOR DELETE USING (auth.uid() = player_id);

-- Player favorite facility policies
DROP POLICY IF EXISTS "Players can view own favorite facilities" ON player_favorite_facility;
CREATE POLICY "Players can view own favorite facilities" ON player_favorite_facility
  FOR SELECT USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can insert own favorite facilities" ON player_favorite_facility;
CREATE POLICY "Players can insert own favorite facilities" ON player_favorite_facility
  FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can update own favorite facilities" ON player_favorite_facility;
CREATE POLICY "Players can update own favorite facilities" ON player_favorite_facility
  FOR UPDATE USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can delete own favorite facilities" ON player_favorite_facility;
CREATE POLICY "Players can delete own favorite facilities" ON player_favorite_facility
  FOR DELETE USING (auth.uid() = player_id);

-- Shared contact list policies
DROP POLICY IF EXISTS "Users can view own contact lists" ON shared_contact_list;
CREATE POLICY "Users can view own contact lists" ON shared_contact_list
  FOR SELECT TO authenticated USING (player_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own contact lists" ON shared_contact_list;
CREATE POLICY "Users can create own contact lists" ON shared_contact_list
  FOR INSERT TO authenticated WITH CHECK (player_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own contact lists" ON shared_contact_list;
CREATE POLICY "Users can update own contact lists" ON shared_contact_list
  FOR UPDATE TO authenticated USING (player_id = auth.uid()) WITH CHECK (player_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own contact lists" ON shared_contact_list;
CREATE POLICY "Users can delete own contact lists" ON shared_contact_list
  FOR DELETE TO authenticated USING (player_id = auth.uid());

-- Shared contact policies
DROP POLICY IF EXISTS "Users can view contacts in own lists" ON shared_contact;
CREATE POLICY "Users can view contacts in own lists" ON shared_contact
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_contact_list scl WHERE scl.id = shared_contact.list_id AND scl.player_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create contacts in own lists" ON shared_contact;
CREATE POLICY "Users can create contacts in own lists" ON shared_contact
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM shared_contact_list scl WHERE scl.id = shared_contact.list_id AND scl.player_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update contacts in own lists" ON shared_contact;
CREATE POLICY "Users can update contacts in own lists" ON shared_contact
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_contact_list scl WHERE scl.id = shared_contact.list_id AND scl.player_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete contacts in own lists" ON shared_contact;
CREATE POLICY "Users can delete contacts in own lists" ON shared_contact
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM shared_contact_list scl WHERE scl.id = shared_contact.list_id AND scl.player_id = auth.uid())
  );

-- Match share policies
DROP POLICY IF EXISTS "Users can view their own match shares" ON match_share;
CREATE POLICY "Users can view their own match shares" ON match_share
  FOR SELECT USING (auth.uid() = shared_by);

DROP POLICY IF EXISTS "Users can create match shares" ON match_share;
CREATE POLICY "Users can create match shares" ON match_share
  FOR INSERT WITH CHECK (auth.uid() = shared_by);

DROP POLICY IF EXISTS "Users can update their own match shares" ON match_share;
CREATE POLICY "Users can update their own match shares" ON match_share
  FOR UPDATE USING (auth.uid() = shared_by);

DROP POLICY IF EXISTS "Users can delete their own match shares" ON match_share;
CREATE POLICY "Users can delete their own match shares" ON match_share
  FOR DELETE USING (auth.uid() = shared_by);

-- Match share recipient policies
DROP POLICY IF EXISTS "Users can view recipients of their shares" ON match_share_recipient;
CREATE POLICY "Users can view recipients of their shares" ON match_share_recipient
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM match_share ms WHERE ms.id = match_share_recipient.share_id AND ms.shared_by = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create recipients for their shares" ON match_share_recipient;
CREATE POLICY "Users can create recipients for their shares" ON match_share_recipient
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM match_share ms WHERE ms.id = match_share_recipient.share_id AND ms.shared_by = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update recipients of their shares" ON match_share_recipient;
CREATE POLICY "Users can update recipients of their shares" ON match_share_recipient
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM match_share ms WHERE ms.id = match_share_recipient.share_id AND ms.shared_by = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete recipients of their shares" ON match_share_recipient;
CREATE POLICY "Users can delete recipients of their shares" ON match_share_recipient
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM match_share ms WHERE ms.id = match_share_recipient.share_id AND ms.shared_by = auth.uid())
  );

-- Match network policies
DROP POLICY IF EXISTS "match_network_select_policy" ON match_network;
CREATE POLICY "match_network_select_policy" ON match_network
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM network_member nm
      WHERE nm.network_id = match_network.network_id
      AND nm.player_id = auth.uid()
      AND nm.status = 'active'
    )
  );

DROP POLICY IF EXISTS "match_network_insert_policy" ON match_network;
CREATE POLICY "match_network_insert_policy" ON match_network
  FOR INSERT WITH CHECK (
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
-- Note: Only allowing poster to delete for now. Moderator check removed due to
-- role column not existing at this migration point. A later migration will add
-- proper moderator support when the role column is added.
CREATE POLICY "match_network_delete_policy" ON match_network
  FOR DELETE USING (posted_by = auth.uid());

-- Message reaction policies
DROP POLICY IF EXISTS "Users can view reactions in their conversations" ON message_reaction;
CREATE POLICY "Users can view reactions in their conversations" ON message_reaction
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM message m
      JOIN conversation_participant cp ON cp.conversation_id = m.conversation_id
      WHERE m.id = message_reaction.message_id AND cp.player_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can add reactions to messages in their conversations" ON message_reaction;
CREATE POLICY "Users can add reactions to messages in their conversations" ON message_reaction
  FOR INSERT WITH CHECK (
    player_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM message m
      JOIN conversation_participant cp ON cp.conversation_id = m.conversation_id
      WHERE m.id = message_reaction.message_id AND cp.player_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can remove their own reactions" ON message_reaction;
CREATE POLICY "Users can remove their own reactions" ON message_reaction
  FOR DELETE USING (player_id = auth.uid());

-- Match set policies
DROP POLICY IF EXISTS "Anyone can view match sets" ON match_set;
CREATE POLICY "Anyone can view match sets" ON match_set
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Match participants can insert match sets" ON match_set;
CREATE POLICY "Match participants can insert match sets" ON match_set
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM match_result mr
      JOIN match_participant mp ON mp.match_id = mr.match_id
      WHERE mr.id = match_result_id AND mp.player_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Match participants can update match sets" ON match_set;
CREATE POLICY "Match participants can update match sets" ON match_set
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM match_result mr
      JOIN match_participant mp ON mp.match_id = mr.match_id
      WHERE mr.id = match_result_id AND mp.player_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Match participants can delete match sets" ON match_set;
CREATE POLICY "Match participants can delete match sets" ON match_set
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM match_result mr
      JOIN match_participant mp ON mp.match_id = mr.match_id
      WHERE mr.id = match_result_id AND mp.player_id = auth.uid()
    )
  );

-- Notification preference policies
DROP POLICY IF EXISTS "Users can view their own notification preferences" ON notification_preference;
CREATE POLICY "Users can view their own notification preferences" ON notification_preference
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own notification preferences" ON notification_preference;
CREATE POLICY "Users can create their own notification preferences" ON notification_preference
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notification preferences" ON notification_preference;
CREATE POLICY "Users can update their own notification preferences" ON notification_preference
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own notification preferences" ON notification_preference;
CREATE POLICY "Users can delete their own notification preferences" ON notification_preference
  FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- PART 8: INSERT MISSING NETWORK TYPE (Community)
-- =============================================================================

INSERT INTO network_type (name, display_name, description, is_active)
VALUES ('community', 'Community', 'Public or private communities for players with shared interests', true)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- PART 9: COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE verification_code IS 'Stores email verification codes for user authentication';
COMMENT ON TABLE player_favorite IS 'Stores player favorites - allows users to mark other players as favorites';
COMMENT ON TABLE player_block IS 'Stores blocked players - allows users to block other players';
COMMENT ON TABLE player_favorite_facility IS 'Junction table linking players to their favorite facilities (max 3)';
COMMENT ON TABLE shared_contact_list IS 'Lists of non-app contacts for inviting to matches';
COMMENT ON TABLE shared_contact IS 'Individual contacts within shared contact lists';
COMMENT ON TABLE match_share IS 'Records of matches shared with external contacts';
COMMENT ON TABLE match_share_recipient IS 'Individual recipients of match shares';
COMMENT ON TABLE match_network IS 'Junction table linking matches to networks (groups/communities)';
COMMENT ON TABLE message_reaction IS 'Stores emoji reactions to messages';
COMMENT ON TABLE match_set IS 'Individual set scores for tennis/pickleball matches';
COMMENT ON TABLE notification_preference IS 'Stores user notification preferences per type and channel';

COMMENT ON COLUMN match.is_auto_generated IS 'Whether this match was auto-generated by the weekly match generator';
COMMENT ON COLUMN match.cancelled_at IS 'Timestamp when the match was cancelled. NULL means not cancelled.';
COMMENT ON COLUMN match.timezone IS 'IANA timezone identifier for the match location';
COMMENT ON COLUMN player.expo_push_token IS 'Expo Push Notification token for push notifications';
COMMENT ON COLUMN player.push_notifications_enabled IS 'Global toggle for push notifications';
COMMENT ON COLUMN player.reputation_score IS 'Player reputation score (0-100) based on behavior';
COMMENT ON COLUMN player.chat_rules_agreed_at IS 'Timestamp when user agreed to chat guidelines';
COMMENT ON COLUMN player_rating_score.badge_status IS 'Badge color: self_declared (yellow), certified (green), disputed (red)';

-- =============================================================================
-- COMPLETION
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Missing schema elements sync completed successfully';
END $$;
