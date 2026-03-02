-- ============================================================
-- ANALYTICS TABLES MIGRATION
-- Phase 3: Analytics & KPIs for Admin Interface
-- 
-- This migration creates tables for storing analytics snapshots
-- and tracking screen/onboarding analytics.
-- ============================================================

-- ============================================================
-- ANALYTICS SNAPSHOT TABLE
-- Stores daily aggregated metrics for dashboards
-- ============================================================
CREATE TABLE IF NOT EXISTS public.analytics_snapshot (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  sport_id uuid REFERENCES public.sport(id) ON DELETE SET NULL,
  metric_type text NOT NULL,
  metric_name text NOT NULL,
  metric_value numeric NOT NULL DEFAULT 0,
  metric_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT analytics_snapshot_pkey PRIMARY KEY (id),
  CONSTRAINT analytics_snapshot_unique UNIQUE (snapshot_date, sport_id, metric_type, metric_name)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_analytics_snapshot_date 
  ON public.analytics_snapshot(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshot_sport 
  ON public.analytics_snapshot(sport_id);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshot_type 
  ON public.analytics_snapshot(metric_type);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshot_composite 
  ON public.analytics_snapshot(metric_type, metric_name, snapshot_date DESC);

-- ============================================================
-- SCREEN ANALYTICS TABLE
-- Tracks screen views for usage analytics
-- ============================================================
CREATE TABLE IF NOT EXISTS public.screen_analytics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES public.player(id) ON DELETE SET NULL,
  screen_name text NOT NULL,
  view_started_at timestamp with time zone NOT NULL DEFAULT now(),
  view_ended_at timestamp with time zone,
  duration_seconds integer,
  sport_id uuid REFERENCES public.sport(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT screen_analytics_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_screen_analytics_screen 
  ON public.screen_analytics(screen_name);
CREATE INDEX IF NOT EXISTS idx_screen_analytics_date 
  ON public.screen_analytics(view_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_screen_analytics_player 
  ON public.screen_analytics(player_id);

-- ============================================================
-- ONBOARDING ANALYTICS TABLE
-- Tracks onboarding funnel progress
-- ============================================================
CREATE TABLE IF NOT EXISTS public.onboarding_analytics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
  session_id text,
  screen_name text NOT NULL,
  entered_at timestamp with time zone NOT NULL DEFAULT now(),
  exited_at timestamp with time zone,
  completed boolean DEFAULT false,
  time_spent_seconds integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_analytics_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_analytics_player 
  ON public.onboarding_analytics(player_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_analytics_screen 
  ON public.onboarding_analytics(screen_name);
CREATE INDEX IF NOT EXISTS idx_onboarding_analytics_date 
  ON public.onboarding_analytics(entered_at DESC);

-- ============================================================
-- RLS POLICIES FOR ANALYTICS TABLES
-- ============================================================

-- Enable RLS
ALTER TABLE public.analytics_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screen_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_analytics ENABLE ROW LEVEL SECURITY;

-- Analytics snapshot policies (admins only)
CREATE POLICY "Admins can read analytics snapshots"
  ON public.analytics_snapshot FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid())
  );

CREATE POLICY "System can insert analytics snapshots"
  ON public.analytics_snapshot FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update analytics snapshots"
  ON public.analytics_snapshot FOR UPDATE
  USING (true);

-- Screen analytics policies
CREATE POLICY "Users can insert own screen analytics"
  ON public.screen_analytics FOR INSERT
  WITH CHECK (
    player_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid())
  );

CREATE POLICY "Admins can read all screen analytics"
  ON public.screen_analytics FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid())
  );

-- Onboarding analytics policies
CREATE POLICY "Users can insert own onboarding analytics"
  ON public.onboarding_analytics FOR INSERT
  WITH CHECK (player_id = auth.uid());

CREATE POLICY "Users can update own onboarding analytics"
  ON public.onboarding_analytics FOR UPDATE
  USING (player_id = auth.uid());

CREATE POLICY "Admins can read all onboarding analytics"
  ON public.onboarding_analytics FOR SELECT
  USING (
    player_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid())
  );

-- ============================================================
-- HELPER FUNCTIONS FOR ANALYTICS
-- ============================================================

-- Function to get latest snapshot value
CREATE OR REPLACE FUNCTION public.get_latest_metric(
  p_metric_type text,
  p_metric_name text,
  p_sport_id uuid DEFAULT NULL
)
RETURNS numeric AS $$
DECLARE
  result numeric;
BEGIN
  SELECT metric_value INTO result
  FROM analytics_snapshot
  WHERE metric_type = p_metric_type
    AND metric_name = p_metric_name
    AND (p_sport_id IS NULL AND sport_id IS NULL OR sport_id = p_sport_id)
  ORDER BY snapshot_date DESC
  LIMIT 1;
  
  RETURN COALESCE(result, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get metric trend (last N days)
CREATE OR REPLACE FUNCTION public.get_metric_trend(
  p_metric_type text,
  p_metric_name text,
  p_days integer DEFAULT 7,
  p_sport_id uuid DEFAULT NULL
)
RETURNS TABLE(snapshot_date date, metric_value numeric) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.snapshot_date,
    s.metric_value
  FROM analytics_snapshot s
  WHERE s.metric_type = p_metric_type
    AND s.metric_name = p_metric_name
    AND (p_sport_id IS NULL AND s.sport_id IS NULL OR s.sport_id = p_sport_id)
    AND s.snapshot_date >= CURRENT_DATE - p_days
  ORDER BY s.snapshot_date ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to calculate real-time user count
CREATE OR REPLACE FUNCTION public.get_realtime_user_count()
RETURNS TABLE(
  total_users bigint,
  active_today bigint,
  active_week bigint,
  active_month bigint,
  new_today bigint,
  new_week bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM profile)::bigint as total_users,
    (SELECT COUNT(DISTINCT id) FROM player WHERE last_seen_at >= CURRENT_DATE)::bigint as active_today,
    (SELECT COUNT(DISTINCT id) FROM player WHERE last_seen_at >= CURRENT_DATE - INTERVAL '7 days')::bigint as active_week,
    (SELECT COUNT(DISTINCT id) FROM player WHERE last_seen_at >= CURRENT_DATE - INTERVAL '30 days')::bigint as active_month,
    (SELECT COUNT(*) FROM profile WHERE created_at >= CURRENT_DATE)::bigint as new_today,
    (SELECT COUNT(*) FROM profile WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::bigint as new_week;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get match statistics
CREATE OR REPLACE FUNCTION public.get_match_statistics(
  p_sport_id uuid DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS TABLE(
  total_matches bigint,
  scheduled_matches bigint,
  completed_matches bigint,
  cancelled_matches bigint,
  avg_participants numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint as total_matches,
    COUNT(*) FILTER (WHERE status = 'scheduled')::bigint as scheduled_matches,
    COUNT(*) FILTER (WHERE status = 'completed' OR closed_at IS NOT NULL)::bigint as completed_matches,
    COUNT(*) FILTER (WHERE status = 'cancelled')::bigint as cancelled_matches,
    COALESCE(AVG(
      (SELECT COUNT(*) FROM match_participant mp WHERE mp.match_id = m.id)
    ), 0)::numeric as avg_participants
  FROM match m
  WHERE 
    (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    AND m.created_at >= CURRENT_DATE - p_days;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get onboarding funnel statistics
CREATE OR REPLACE FUNCTION public.get_onboarding_funnel(
  p_days integer DEFAULT 30
)
RETURNS TABLE(
  screen_name text,
  total_views bigint,
  completions bigint,
  completion_rate numeric,
  avg_time_seconds numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    oa.screen_name,
    COUNT(*)::bigint as total_views,
    COUNT(*) FILTER (WHERE oa.completed = true)::bigint as completions,
    ROUND(
      (COUNT(*) FILTER (WHERE oa.completed = true)::numeric / NULLIF(COUNT(*), 0) * 100), 
      2
    ) as completion_rate,
    ROUND(AVG(oa.time_spent_seconds)::numeric, 2) as avg_time_seconds
  FROM onboarding_analytics oa
  WHERE oa.entered_at >= CURRENT_DATE - p_days
  GROUP BY oa.screen_name
  ORDER BY 
    CASE oa.screen_name
      WHEN 'welcome' THEN 1
      WHEN 'personal_info' THEN 2
      WHEN 'sport_selection' THEN 3
      WHEN 'skill_level' THEN 4
      WHEN 'availability' THEN 5
      WHEN 'location' THEN 6
      WHEN 'complete' THEN 7
      ELSE 8
    END;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to generate daily analytics snapshot
CREATE OR REPLACE FUNCTION public.generate_daily_analytics_snapshot()
RETURNS void AS $$
DECLARE
  tennis_id uuid;
  pickleball_id uuid;
  target_date date := CURRENT_DATE - INTERVAL '1 day';
BEGIN
  -- Get sport IDs
  SELECT id INTO tennis_id FROM sport WHERE slug = 'tennis' LIMIT 1;
  SELECT id INTO pickleball_id FROM sport WHERE slug = 'pickleball' LIMIT 1;

  -- ============ GLOBAL METRICS ============
  
  -- Total users
  INSERT INTO analytics_snapshot (snapshot_date, metric_type, metric_name, metric_value)
  SELECT target_date, 'users', 'total_users', COUNT(*)
  FROM profile
  ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
  DO UPDATE SET metric_value = EXCLUDED.metric_value;

  -- DAU (Daily Active Users)
  INSERT INTO analytics_snapshot (snapshot_date, metric_type, metric_name, metric_value)
  SELECT target_date, 'users', 'dau', COUNT(DISTINCT id)
  FROM player
  WHERE last_seen_at >= target_date AND last_seen_at < target_date + INTERVAL '1 day'
  ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
  DO UPDATE SET metric_value = EXCLUDED.metric_value;

  -- New users that day
  INSERT INTO analytics_snapshot (snapshot_date, metric_type, metric_name, metric_value)
  SELECT target_date, 'users', 'new_users', COUNT(*)
  FROM profile
  WHERE created_at::date = target_date
  ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
  DO UPDATE SET metric_value = EXCLUDED.metric_value;

  -- Onboarding completion count
  INSERT INTO analytics_snapshot (snapshot_date, metric_type, metric_name, metric_value)
  SELECT target_date, 'onboarding', 'completed', COUNT(*)
  FROM profile
  WHERE onboarding_completed = true 
    AND updated_at::date = target_date
  ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
  DO UPDATE SET metric_value = EXCLUDED.metric_value;

  -- ============ TENNIS METRICS ============
  IF tennis_id IS NOT NULL THEN
    -- Tennis players total
    INSERT INTO analytics_snapshot (snapshot_date, sport_id, metric_type, metric_name, metric_value)
    SELECT target_date, tennis_id, 'players', 'total', COUNT(DISTINCT player_id)
    FROM player_sport_profile
    WHERE sport_id = tennis_id
    ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
    DO UPDATE SET metric_value = EXCLUDED.metric_value;

    -- Tennis matches created
    INSERT INTO analytics_snapshot (snapshot_date, sport_id, metric_type, metric_name, metric_value)
    SELECT target_date, tennis_id, 'matches', 'created', COUNT(*)
    FROM match
    WHERE sport_id = tennis_id AND created_at::date = target_date
    ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
    DO UPDATE SET metric_value = EXCLUDED.metric_value;

    -- Tennis matches completed
    INSERT INTO analytics_snapshot (snapshot_date, sport_id, metric_type, metric_name, metric_value)
    SELECT target_date, tennis_id, 'matches', 'completed', COUNT(*)
    FROM match
    WHERE sport_id = tennis_id 
      AND (status = 'completed' OR closed_at IS NOT NULL)
      AND COALESCE(closed_at, updated_at)::date = target_date
    ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
    DO UPDATE SET metric_value = EXCLUDED.metric_value;
  END IF;

  -- ============ PICKLEBALL METRICS ============
  IF pickleball_id IS NOT NULL THEN
    -- Pickleball players total
    INSERT INTO analytics_snapshot (snapshot_date, sport_id, metric_type, metric_name, metric_value)
    SELECT target_date, pickleball_id, 'players', 'total', COUNT(DISTINCT player_id)
    FROM player_sport_profile
    WHERE sport_id = pickleball_id
    ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
    DO UPDATE SET metric_value = EXCLUDED.metric_value;

    -- Pickleball matches created
    INSERT INTO analytics_snapshot (snapshot_date, sport_id, metric_type, metric_name, metric_value)
    SELECT target_date, pickleball_id, 'matches', 'created', COUNT(*)
    FROM match
    WHERE sport_id = pickleball_id AND created_at::date = target_date
    ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
    DO UPDATE SET metric_value = EXCLUDED.metric_value;

    -- Pickleball matches completed
    INSERT INTO analytics_snapshot (snapshot_date, sport_id, metric_type, metric_name, metric_value)
    SELECT target_date, pickleball_id, 'matches', 'completed', COUNT(*)
    FROM match
    WHERE sport_id = pickleball_id 
      AND (status = 'completed' OR closed_at IS NOT NULL)
      AND COALESCE(closed_at, updated_at)::date = target_date
    ON CONFLICT (snapshot_date, sport_id, metric_type, metric_name) 
    DO UPDATE SET metric_value = EXCLUDED.metric_value;
  END IF;

  -- Log completion
  RAISE NOTICE 'Analytics snapshot generated for %', target_date;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================
COMMENT ON TABLE public.analytics_snapshot IS 'Daily aggregated analytics metrics for admin dashboards';
COMMENT ON TABLE public.screen_analytics IS 'Screen view tracking for usage analytics';
COMMENT ON TABLE public.onboarding_analytics IS 'Onboarding funnel tracking and completion analytics';
COMMENT ON FUNCTION public.get_realtime_user_count() IS 'Returns real-time user statistics';
COMMENT ON FUNCTION public.get_match_statistics(uuid, integer) IS 'Returns match statistics, optionally filtered by sport';
COMMENT ON FUNCTION public.get_onboarding_funnel(integer) IS 'Returns onboarding funnel statistics';
COMMENT ON FUNCTION public.generate_daily_analytics_snapshot() IS 'Generates daily analytics snapshot - run via cron job';
