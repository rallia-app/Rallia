-- Migration: Add proof_reaction table for lightweight social like/dislike on rating proofs
-- This is decoupled from the proof_endorsement / certification flow.

CREATE TABLE IF NOT EXISTS public.proof_reaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id uuid NOT NULL REFERENCES public.rating_proof(id) ON DELETE CASCADE,
  reactor_id uuid NOT NULL REFERENCES public.profile(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('like', 'dislike')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proof_reaction_unique_per_user UNIQUE (proof_id, reactor_id)
);

COMMENT ON TABLE public.proof_reaction IS 'Lightweight social like/dislike reactions on rating proofs. Independent from proof_endorsement (which drives certification).';

CREATE INDEX IF NOT EXISTS idx_proof_reaction_proof_id ON public.proof_reaction(proof_id);
CREATE INDEX IF NOT EXISTS idx_proof_reaction_reactor_id ON public.proof_reaction(reactor_id);

ALTER TABLE public.proof_reaction ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view proof reactions"
  ON public.proof_reaction
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own proof reactions"
  ON public.proof_reaction
  FOR INSERT
  TO authenticated
  WITH CHECK (reactor_id = auth.uid());

CREATE POLICY "Users can update own proof reactions"
  ON public.proof_reaction
  FOR UPDATE
  TO authenticated
  USING (reactor_id = auth.uid())
  WITH CHECK (reactor_id = auth.uid());

CREATE POLICY "Users can delete own proof reactions"
  ON public.proof_reaction
  FOR DELETE
  TO authenticated
  USING (reactor_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proof_reaction TO authenticated;
