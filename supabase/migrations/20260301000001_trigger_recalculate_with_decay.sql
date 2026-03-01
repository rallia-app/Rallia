-- ============================================================================
-- Apply decay on every reputation event recalculation
-- ============================================================================
-- Previously the AFTER INSERT trigger on reputation_event called
-- recalculate_player_reputation(player_id, false), meaning decay was only
-- applied by the weekly batch job. This caused a sawtooth effect: scores
-- would jump when the batch applied decay, then drop back on the next event.
--
-- The spec says on-event recalculation should "apply current decay factors
-- to all existing events." Changing to apply_decay = true fixes this.
-- The weekly batch job remains as a safety net for inactive players whose
-- scores should still improve via time decay even without new events.
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_recalculate_reputation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM recalculate_player_reputation(NEW.player_id, true);
    RETURN NEW;
END;
$$;
