-- Migration: Add proof_endorsement table for peer validation of rating proofs
-- This allows multiple players to approve/decline the same proof
-- Proofs become 'approved' when reaching the endorsement threshold

-- Create the proof_endorsement table
CREATE TABLE IF NOT EXISTS public.proof_endorsement (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  proof_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  is_approved boolean NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT proof_endorsement_pkey PRIMARY KEY (id),
  CONSTRAINT proof_endorsement_proof_id_fkey FOREIGN KEY (proof_id) REFERENCES public.rating_proof(id) ON DELETE CASCADE,
  CONSTRAINT proof_endorsement_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profile(id) ON DELETE CASCADE,
  CONSTRAINT proof_endorsement_unique_per_reviewer UNIQUE (proof_id, reviewer_id)
);

-- Add comment for documentation
COMMENT ON TABLE public.proof_endorsement IS 'Tracks peer endorsements/validations of rating proofs. Multiple players can approve or decline each proof.';
COMMENT ON COLUMN public.proof_endorsement.is_approved IS 'true = approved/endorsed, false = declined/rejected';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_proof_endorsement_proof_id ON public.proof_endorsement(proof_id);
CREATE INDEX IF NOT EXISTS idx_proof_endorsement_reviewer_id ON public.proof_endorsement(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_proof_endorsement_is_approved ON public.proof_endorsement(proof_id, is_approved) WHERE is_approved = true;

-- Enable RLS
ALTER TABLE public.proof_endorsement ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Anyone authenticated can view endorsements
CREATE POLICY "Anyone can view endorsements"
  ON public.proof_endorsement
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert their own endorsements
CREATE POLICY "Users can insert own endorsements"
  ON public.proof_endorsement
  FOR INSERT
  TO authenticated
  WITH CHECK (reviewer_id = auth.uid());

-- Users can update their own endorsements (change their vote)
CREATE POLICY "Users can update own endorsements"
  ON public.proof_endorsement
  FOR UPDATE
  TO authenticated
  USING (reviewer_id = auth.uid())
  WITH CHECK (reviewer_id = auth.uid());

-- Users can delete their own endorsements
CREATE POLICY "Users can delete own endorsements"
  ON public.proof_endorsement
  FOR DELETE
  TO authenticated
  USING (reviewer_id = auth.uid());

-- Function to get endorsement counts for a proof
CREATE OR REPLACE FUNCTION public.get_proof_endorsement_counts(p_proof_id uuid)
RETURNS TABLE (
  approvals_count integer,
  declines_count integer,
  total_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 
    COALESCE(SUM(CASE WHEN is_approved THEN 1 ELSE 0 END)::integer, 0) as approvals_count,
    COALESCE(SUM(CASE WHEN NOT is_approved THEN 1 ELSE 0 END)::integer, 0) as declines_count,
    COUNT(*)::integer as total_count
  FROM public.proof_endorsement
  WHERE proof_id = p_proof_id;
$$;

-- Function to auto-approve proofs that reach the endorsement threshold
-- This can be called by a trigger or manually
CREATE OR REPLACE FUNCTION public.check_proof_endorsement_threshold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_approvals_count integer;
  v_declines_count integer;
  v_threshold integer := 3; -- Number of approvals needed
  v_decline_threshold integer := 3; -- Number of declines to flag
BEGIN
  -- Count current endorsements for this proof
  SELECT 
    COALESCE(SUM(CASE WHEN is_approved THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN NOT is_approved THEN 1 ELSE 0 END), 0)
  INTO v_approvals_count, v_declines_count
  FROM public.proof_endorsement
  WHERE proof_id = NEW.proof_id;

  -- If threshold reached and proof is still pending, approve it
  IF v_approvals_count >= v_threshold THEN
    UPDATE public.rating_proof
    SET status = 'approved',
        updated_at = now()
    WHERE id = NEW.proof_id
      AND status = 'pending';
  END IF;

  -- Optionally: Flag proofs with too many declines for admin review
  -- (keeping status as 'pending' but could add a 'flagged' status)
  
  RETURN NEW;
END;
$$;

-- Trigger to check threshold after each endorsement
CREATE TRIGGER trigger_check_proof_endorsement_threshold
  AFTER INSERT OR UPDATE ON public.proof_endorsement
  FOR EACH ROW
  EXECUTE FUNCTION public.check_proof_endorsement_threshold();

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_proof_endorsement_counts(uuid) TO authenticated;
