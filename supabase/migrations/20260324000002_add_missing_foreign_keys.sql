-- =============================================================================
-- Migration: Add missing foreign key constraints
-- Description: Several UUID _id columns reference other tables but lack actual
-- FK constraints, allowing orphaned data and bypassing cascade deletes.
-- =============================================================================

-- ---- Clean up orphaned data ----

-- Remove player_rating_score rows where player no longer exists
DELETE FROM public.player_rating_score
WHERE player_id NOT IN (SELECT id FROM public.player);

-- Remove peer_rating_request rows where players no longer exist
DELETE FROM public.peer_rating_request
WHERE requester_id NOT IN (SELECT id FROM public.player)
   OR evaluator_id NOT IN (SELECT id FROM public.player);

-- Remove reference_request rows where sport/rating_score no longer exist
DELETE FROM public.reference_request
WHERE sport_id NOT IN (SELECT id FROM public.sport)
   OR claimed_rating_score_id NOT IN (SELECT id FROM public.rating_score)
   OR (reference_rating_score_id IS NOT NULL AND reference_rating_score_id NOT IN (SELECT id FROM public.rating_score));

-- ---- peer_rating_request ----

ALTER TABLE public.peer_rating_request
  ADD CONSTRAINT peer_rating_request_requester_id_fkey
  FOREIGN KEY (requester_id) REFERENCES public.player(id) ON DELETE CASCADE;

ALTER TABLE public.peer_rating_request
  ADD CONSTRAINT peer_rating_request_evaluator_id_fkey
  FOREIGN KEY (evaluator_id) REFERENCES public.player(id) ON DELETE CASCADE;

-- ---- player_rating_score ----

ALTER TABLE public.player_rating_score
  ADD CONSTRAINT player_rating_score_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.player(id) ON DELETE CASCADE;

-- ---- reference_request ----

ALTER TABLE public.reference_request
  ADD CONSTRAINT reference_request_sport_id_fkey
  FOREIGN KEY (sport_id) REFERENCES public.sport(id) ON DELETE CASCADE;

ALTER TABLE public.reference_request
  ADD CONSTRAINT reference_request_claimed_rating_score_id_fkey
  FOREIGN KEY (claimed_rating_score_id) REFERENCES public.rating_score(id) ON DELETE CASCADE;

ALTER TABLE public.reference_request
  ADD CONSTRAINT reference_request_reference_rating_score_id_fkey
  FOREIGN KEY (reference_rating_score_id) REFERENCES public.rating_score(id) ON DELETE SET NULL;
