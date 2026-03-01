-- ============================================
-- FIX: Allow all authenticated users to read one-time availability
-- ============================================
-- The existing SELECT policy only allowed organization members to read
-- court_one_time_availability rows. This prevented mobile app users
-- (players) from seeing one-time availability slots in the facility
-- detail availability tab.
--
-- The get_available_slots_batch RPC runs with SECURITY INVOKER,
-- so RLS applies. Without this fix, all JOINs on
-- court_one_time_availability return empty for non-org-members.
-- ============================================

-- Add a SELECT policy for all authenticated users
-- One-time availability data is not sensitive — it's the same kind of
-- information as court_slot (which has no RLS at all).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = 'court_one_time_availability'
        AND policyname = 'one_time_availability_select_authenticated'
    ) THEN
        CREATE POLICY "one_time_availability_select_authenticated" ON court_one_time_availability
            FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
END $$;
