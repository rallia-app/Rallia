-- =============================================================================
-- Migration: Add metadata JSONB column to feedback table
-- Description: Stores category-specific fields (severity, steps_to_reproduce,
--              expected_vs_actual, use_case, disappointment_score, etc.)
--              Keeps schema flexible while generic subject/message stay for
--              backward compatibility.
-- =============================================================================

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

COMMENT ON COLUMN public.feedback.metadata IS 'Category-specific structured data (severity, steps, disappointment score, etc.)';
