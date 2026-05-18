-- pending_host_transfer had RLS enabled with no policies, blocking the
-- mobile client from reading its own rows. The "$X ready — finish setup"
-- JIT banner queries this table client-side from the host's account.

CREATE POLICY "Hosts can read their own pending transfers"
  ON public.pending_host_transfer
  FOR SELECT
  TO authenticated
  USING (host_player_id = auth.uid());
