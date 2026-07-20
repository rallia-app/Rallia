-- Paid seasons, part 1 of 2: enum values only.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it,
-- so the new values land here and the RPCs that reference them land in
-- 20260716200100. Same split 20260629110000 used for registration_status's
-- 'payment_pending' before the tournament ledger could reference it.
--
-- season_members.status: the roster was built registration-shaped on purpose
-- (20260629160000 header) precisely so paid could be added this way:
--   (none) --begin-paid--> payment_pending --webhook ok--> enrolled
--
-- season_status gains 'cancelled' because refunds need something to gate on:
-- lt_cancel_refund_candidates selects paid rows for events in a cancelled state.
-- Without it a paid season could never refund anyone.

ALTER TYPE season_member_status ADD VALUE IF NOT EXISTS 'payment_pending';
ALTER TYPE season_status ADD VALUE IF NOT EXISTS 'cancelled';
