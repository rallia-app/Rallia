-- ============================================================================
-- A game cannot hold more players than it has seats
-- ============================================================================
-- Capacity lived only in the client: joinMatch and acceptJoinRequest count the
-- joined participants they can see and pick 'joined' / 'waitlisted' from that.
-- match_participant_insert_creator accepts any row where player_id = auth.uid()
-- with no visibility or capacity condition, so whenever that count was wrong
-- the database took the write.
--
-- It was wrong until the migration alongside this one: participants of a
-- private game shared into a community were RLS-hidden from the members
-- reading the card, so a full singles game counted zero joined players and the
-- Join button on the chat card would have written a third joined player into
-- it. No prod game has been over-filled yet; this closes the door rather than
-- trusting every future caller to count correctly.
--
-- Only 'joined' consumes a seat. Requests, invitations and the waitlist are
-- untouched, which is what makes the full game fall through to 'waitlisted'
-- instead of failing.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_participant_capacity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_capacity int;
    v_joined   int;
BEGIN
    IF NEW.status <> 'joined' THEN
        RETURN NEW;
    END IF;

    -- Already holding a seat: re-stamping the row does not take another.
    IF TG_OP = 'UPDATE' AND OLD.status = 'joined' THEN
        RETURN NEW;
    END IF;

    -- Two players tapping Join in the same instant each read a snapshot without
    -- the other's row, so the count has to be serialised per game.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.match_id::text, 0));

    SELECT CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
      INTO v_capacity
      FROM public.match m
     WHERE m.id = NEW.match_id;

    -- No game row (deleted mid-write): leave the verdict to the foreign key.
    IF v_capacity IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT count(*)
      INTO v_joined
      FROM public.match_participant mp
     WHERE mp.match_id = NEW.match_id
       AND mp.status = 'joined'
       AND mp.id <> NEW.id;

    IF v_joined >= v_capacity THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_FULL';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.match_participant_capacity_guard() IS
'Refuses a joined participant beyond the game''s format capacity (singles 2,
doubles 4). The client picks joined vs waitlisted from a count it can read;
RLS or a stale cache can make that count wrong, and the insert policy only
checks that the row is the caller''s own.';

DROP TRIGGER IF EXISTS match_participant_capacity_guard ON match_participant;
CREATE TRIGGER match_participant_capacity_guard
    BEFORE INSERT OR UPDATE OF status ON match_participant
    FOR EACH ROW EXECUTE FUNCTION public.match_participant_capacity_guard();
