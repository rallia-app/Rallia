-- Migration: Add Feedback/Suggestion Box Table
-- Description: Creates a table to store user feedback submissions with email notification trigger

-- =============================================================================
-- FEEDBACK TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID REFERENCES public.player(id) ON DELETE SET NULL,
    category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'improvement', 'other')),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    app_version TEXT,
    device_info JSONB,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'in_progress', 'resolved', 'closed')),
    admin_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_feedback_player_id ON public.feedback(player_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON public.feedback(category);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback(created_at DESC);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_feedback_updated_at ON public.feedback;
CREATE TRIGGER trigger_feedback_updated_at
    BEFORE UPDATE ON public.feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_feedback_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Users can insert their own feedback
CREATE POLICY "Users can submit feedback"
    ON public.feedback
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = player_id OR player_id IS NULL);

-- Users can view their own feedback
CREATE POLICY "Users can view own feedback"
    ON public.feedback
    FOR SELECT
    TO authenticated
    USING (auth.uid() = player_id);

-- Anonymous feedback submission (for users who want privacy)
CREATE POLICY "Anonymous feedback submission"
    ON public.feedback
    FOR INSERT
    TO authenticated
    WITH CHECK (player_id IS NULL);

-- Service role can do everything (for admin dashboard)
CREATE POLICY "Service role full access"
    ON public.feedback
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =============================================================================
-- NOTIFICATION FUNCTION (calls Edge Function)
-- =============================================================================

-- Function to notify admin via Edge Function when new feedback is submitted
CREATE OR REPLACE FUNCTION notify_admin_new_feedback()
RETURNS TRIGGER AS $$
DECLARE
    payload JSONB;
BEGIN
    -- Build the payload
    payload := jsonb_build_object(
        'feedback_id', NEW.id,
        'category', NEW.category,
        'subject', NEW.subject,
        'message', NEW.message,
        'player_id', NEW.player_id,
        'created_at', NEW.created_at
    );
    
    -- Call the Edge Function via pg_net (if available) or http extension
    -- This is a placeholder - the actual email will be sent via Edge Function
    -- triggered by database webhook or called directly from the app
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to notify on new feedback
DROP TRIGGER IF EXISTS trigger_notify_new_feedback ON public.feedback;
CREATE TRIGGER trigger_notify_new_feedback
    AFTER INSERT ON public.feedback
    FOR EACH ROW
    EXECUTE FUNCTION notify_admin_new_feedback();

-- =============================================================================
-- GRANTS
-- =============================================================================

GRANT SELECT, INSERT ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;
