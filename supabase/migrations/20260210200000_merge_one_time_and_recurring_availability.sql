-- ============================================
-- MERGE ONE-TIME AND RECURRING AVAILABILITY
-- ============================================
-- Previously, one-time availability completely overrode recurring
-- templates for the same court+date. This meant that adding a
-- one-time slot (e.g., an evening session) would hide all recurring
-- slots for that entire day.
--
-- New behaviour: both sources are merged together. When a one-time
-- slot overlaps with a recurring slot for the same court+date+time,
-- the one-time entry wins (it may carry different pricing or duration).
-- Non-overlapping slots from both sources are included.
--
-- NOTE: All CTE column references MUST be table-qualified because
-- RETURNS TABLE columns become PL/pgSQL variables (price_cents,
-- template_source, start_time, end_time) and would be ambiguous.
-- ============================================

-- ============================================
-- 1. UPDATE get_available_slots (single-court)
-- ============================================

CREATE OR REPLACE FUNCTION get_available_slots(
    p_court_id UUID,
    p_date DATE
)
RETURNS TABLE (
    start_time TIME,
    end_time TIME,
    price_cents INTEGER,
    template_source TEXT
) AS $$
DECLARE
    v_day_of_week TEXT;
    v_facility_id UUID;
    v_court_status TEXT;
BEGIN
    v_day_of_week := lower(trim(to_char(p_date, 'Day')));
    SELECT c.facility_id, c.availability_status INTO v_facility_id, v_court_status
    FROM court c WHERE c.id = p_court_id;

    -- If court is not available (maintenance, closed, etc.), return no slots
    IF v_court_status IS NOT NULL AND v_court_status != 'available' THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH
    -- Get one-time availability slots for this specific date
    one_time_templates AS (
        SELECT
            ota.start_time AS template_start,
            ota.end_time AS template_end,
            ota.price_cents AS tpl_price_cents,
            ota.slot_duration_minutes AS tpl_slot_duration,
            'one_time'::TEXT AS tpl_source
        FROM court_one_time_availability ota
        WHERE ota.availability_date = p_date
            AND (ota.court_id = p_court_id OR (ota.court_id IS NULL AND ota.facility_id = v_facility_id))
            AND ota.is_available = TRUE
    ),
    -- Get effective recurring templates (court-specific overrides facility-wide)
    recurring_templates AS (
        SELECT
            et.start_time AS template_start,
            et.end_time AS template_end,
            et.price_cents AS tpl_price_cents,
            et.slot_duration_minutes AS tpl_slot_duration,
            et.template_source AS tpl_source
        FROM get_effective_templates(p_court_id, p_date) et
    ),
    -- Merge both sources
    all_templates AS (
        SELECT ot.template_start, ot.template_end, ot.tpl_price_cents, ot.tpl_slot_duration, ot.tpl_source
        FROM one_time_templates ot
        UNION ALL
        SELECT rt.template_start, rt.template_end, rt.tpl_price_cents, rt.tpl_slot_duration, rt.tpl_source
        FROM recurring_templates rt
    ),
    -- Generate individual slots from templates
    generated_slots AS (
        SELECT
            (t.template_start + (gs.slot_num * (t.tpl_slot_duration || ' minutes')::INTERVAL))::TIME AS slot_start,
            (t.template_start + ((gs.slot_num + 1) * (t.tpl_slot_duration || ' minutes')::INTERVAL))::TIME AS slot_end,
            t.tpl_price_cents,
            t.tpl_source
        FROM all_templates t
        CROSS JOIN LATERAL generate_series(
            0,
            GREATEST(0, (EXTRACT(EPOCH FROM (t.template_end - t.template_start)) / 60 / t.tpl_slot_duration)::INTEGER - 1)
        ) AS gs(slot_num)
        WHERE (t.template_start + ((gs.slot_num + 1) * (t.tpl_slot_duration || ' minutes')::INTERVAL))::TIME <= t.template_end
    ),
    -- Deduplicate overlapping slots: one_time wins over recurring
    deduped_slots AS (
        SELECT DISTINCT ON (g.slot_start, g.slot_end)
            g.slot_start,
            g.slot_end,
            g.tpl_price_cents,
            g.tpl_source
        FROM generated_slots g
        ORDER BY g.slot_start, g.slot_end,
            CASE WHEN g.tpl_source = 'one_time' THEN 0 ELSE 1 END
    ),
    -- Get existing bookings for this court and date
    booked_times AS (
        SELECT b.start_time AS booked_start, b.end_time AS booked_end
        FROM booking b
        WHERE b.court_id = p_court_id
            AND b.booking_date = p_date
            AND b.status NOT IN ('cancelled')
    ),
    -- Get blocks for this court/facility and date (from availability_block table)
    blocked_times AS (
        SELECT ab.start_time AS blocked_start, ab.end_time AS blocked_end
        FROM availability_block ab
        WHERE ab.block_date = p_date
            AND (ab.court_id = p_court_id OR (ab.court_id IS NULL AND ab.facility_id = v_facility_id))
    ),
    -- Also get one-time unavailability entries (is_available = FALSE)
    one_time_blocked AS (
        SELECT ota.start_time AS blocked_start, ota.end_time AS blocked_end
        FROM court_one_time_availability ota
        WHERE ota.availability_date = p_date
            AND (ota.court_id = p_court_id OR (ota.court_id IS NULL AND ota.facility_id = v_facility_id))
            AND ota.is_available = FALSE
    )
    -- Return slots that are not booked or blocked
    SELECT
        ds.slot_start,
        ds.slot_end,
        -- Apply pricing rules if any match this slot
        COALESCE(
            (SELECT pr.price_cents
             FROM pricing_rule pr
             WHERE (pr.court_id = p_court_id OR (pr.facility_id = v_facility_id AND pr.court_id IS NULL))
                 AND p_date >= COALESCE(pr.valid_from, '1900-01-01'::DATE)
                 AND p_date <= COALESCE(pr.valid_until, '2100-01-01'::DATE)
                 AND EXTRACT(DOW FROM p_date)::INTEGER = ANY(pr.days_of_week)
                 AND ds.slot_start >= pr.start_time
                 AND ds.slot_start < pr.end_time
                 AND pr.is_active = TRUE
             ORDER BY CASE WHEN pr.court_id IS NOT NULL THEN 1 ELSE 0 END DESC, pr.priority DESC
             LIMIT 1),
            ds.tpl_price_cents
        ),
        ds.tpl_source
    FROM deduped_slots ds
    -- Exclude booked slots
    WHERE NOT EXISTS (
        SELECT 1 FROM booked_times bt
        WHERE (ds.slot_start, ds.slot_end) OVERLAPS (bt.booked_start, bt.booked_end)
    )
    -- Exclude blocked slots (from availability_block)
    AND NOT EXISTS (
        SELECT 1 FROM blocked_times bl
        WHERE bl.blocked_start IS NULL  -- entire day block
           OR (ds.slot_start, ds.slot_end) OVERLAPS (bl.blocked_start, bl.blocked_end)
    )
    -- Exclude one-time blocked slots
    AND NOT EXISTS (
        SELECT 1 FROM one_time_blocked otb
        WHERE (ds.slot_start, ds.slot_end) OVERLAPS (otb.blocked_start, otb.blocked_end)
    )
    ORDER BY ds.slot_start;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_available_slots(UUID, DATE) IS
    'Returns available booking slots for a court on a specific date.
     Merges one-time availability (court_one_time_availability) with recurring
     templates (court_slot). When both produce the same slot time, one-time wins.
     Computes: (one-time + recurring templates → individual slots → dedup) - bookings - blocks.
     Also applies pricing rules if defined.';

-- ============================================
-- 2. UPDATE get_available_slots_batch
-- ============================================

DROP FUNCTION IF EXISTS get_available_slots_batch(UUID[], DATE, DATE);

CREATE OR REPLACE FUNCTION get_available_slots_batch(
    p_court_ids UUID[],
    p_date_from DATE,
    p_date_to DATE
)
RETURNS TABLE (
    out_court_id UUID,
    out_slot_date DATE,
    out_start_time TIME,
    out_end_time TIME,
    out_price_cents INTEGER,
    out_template_source TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH
    -- Generate all dates in the range
    date_range AS (
        SELECT generate_series(p_date_from, p_date_to, '1 day'::INTERVAL)::DATE AS the_date
    ),
    -- Get all courts with their facility info and status
    courts_info AS (
        SELECT
            c.id AS court_id,
            c.facility_id,
            c.availability_status
        FROM court c
        WHERE c.id = ANY(p_court_ids)
            AND (c.availability_status IS NULL OR c.availability_status = 'available')
    ),
    -- Cross join courts with dates to get all (court, date) combinations
    court_dates AS (
        SELECT
            ci.court_id,
            ci.facility_id,
            dr.the_date,
            lower(trim(to_char(dr.the_date, 'Day'))) AS day_of_week
        FROM courts_info ci
        CROSS JOIN date_range dr
    ),
    -- Get one-time availability templates
    one_time_templates AS (
        SELECT
            cd.court_id,
            cd.the_date,
            cd.facility_id,
            ota.start_time AS template_start,
            ota.end_time AS template_end,
            ota.price_cents AS tpl_price_cents,
            ota.slot_duration_minutes AS tpl_slot_duration,
            'one_time'::TEXT AS tpl_source
        FROM court_dates cd
        JOIN court_one_time_availability ota ON (
            ota.availability_date = cd.the_date
            AND (ota.court_id = cd.court_id OR (ota.court_id IS NULL AND ota.facility_id = cd.facility_id))
            AND ota.is_available = TRUE
        )
    ),
    -- Get recurring templates (no longer excluded by one-time presence)
    recurring_templates AS (
        SELECT
            cd.court_id,
            cd.the_date,
            cd.facility_id,
            cs.start_time AS template_start,
            cs.end_time AS template_end,
            COALESCE(cs.price_cents, (cs.price * 100)::INTEGER) AS tpl_price_cents,
            COALESCE(cs.slot_duration_minutes, 60) AS tpl_slot_duration,
            CASE WHEN cs.court_id IS NOT NULL THEN 'court' ELSE 'facility' END AS tpl_source,
            -- Priority for deduplication: court-specific > facility-wide
            CASE WHEN cs.court_id IS NOT NULL THEN 1 ELSE 0 END AS priority
        FROM court_dates cd
        JOIN court_slot cs ON (
            (cs.court_id = cd.court_id OR (cs.facility_id = cd.facility_id AND cs.court_id IS NULL))
            AND cs.day_of_week::TEXT = cd.day_of_week
            AND cs.is_available = TRUE
            AND (cs.valid_from IS NULL OR cs.valid_from <= cd.the_date)
            AND (cs.valid_until IS NULL OR cs.valid_until >= cd.the_date)
        )
    ),
    -- Deduplicate recurring templates (court-specific overrides facility-wide)
    recurring_deduped AS (
        SELECT DISTINCT ON (rt.court_id, rt.the_date, rt.template_start)
            rt.court_id,
            rt.the_date,
            rt.facility_id,
            rt.template_start,
            rt.template_end,
            rt.tpl_price_cents,
            rt.tpl_slot_duration,
            rt.tpl_source
        FROM recurring_templates rt
        ORDER BY rt.court_id, rt.the_date, rt.template_start, rt.priority DESC
    ),
    -- Merge one-time and recurring templates
    all_templates AS (
        SELECT ot.court_id, ot.the_date, ot.facility_id, ot.template_start, ot.template_end,
               ot.tpl_price_cents, ot.tpl_slot_duration, ot.tpl_source
        FROM one_time_templates ot
        UNION ALL
        SELECT rd.court_id, rd.the_date, rd.facility_id, rd.template_start, rd.template_end,
               rd.tpl_price_cents, rd.tpl_slot_duration, rd.tpl_source
        FROM recurring_deduped rd
    ),
    -- Generate individual slots from templates
    generated_slots AS (
        SELECT
            t.court_id,
            t.the_date,
            t.facility_id,
            (t.template_start + (gs.slot_num * (t.tpl_slot_duration || ' minutes')::INTERVAL))::TIME AS slot_start,
            (t.template_start + ((gs.slot_num + 1) * (t.tpl_slot_duration || ' minutes')::INTERVAL))::TIME AS slot_end,
            t.tpl_price_cents,
            t.tpl_source
        FROM all_templates t
        CROSS JOIN LATERAL generate_series(
            0,
            GREATEST(0, (EXTRACT(EPOCH FROM (t.template_end - t.template_start)) / 60 / t.tpl_slot_duration)::INTEGER - 1)
        ) AS gs(slot_num)
        WHERE (t.template_start + ((gs.slot_num + 1) * (t.tpl_slot_duration || ' minutes')::INTERVAL))::TIME <= t.template_end
    ),
    -- Deduplicate overlapping slots: one_time wins over court-specific wins over facility-wide
    deduped_slots AS (
        SELECT DISTINCT ON (g.court_id, g.the_date, g.slot_start, g.slot_end)
            g.court_id,
            g.the_date,
            g.facility_id,
            g.slot_start,
            g.slot_end,
            g.tpl_price_cents,
            g.tpl_source
        FROM generated_slots g
        ORDER BY g.court_id, g.the_date, g.slot_start, g.slot_end,
            CASE WHEN g.tpl_source = 'one_time' THEN 0
                 WHEN g.tpl_source = 'court' THEN 1
                 ELSE 2
            END
    ),
    -- Get all bookings for these courts in the date range
    booked_times AS (
        SELECT b.court_id AS booked_court_id, b.booking_date, b.start_time AS booked_start, b.end_time AS booked_end
        FROM booking b
        WHERE b.court_id = ANY(p_court_ids)
            AND b.booking_date >= p_date_from
            AND b.booking_date <= p_date_to
            AND b.status NOT IN ('cancelled')
    ),
    -- Get all blocks for these courts/facilities in the date range
    blocked_times AS (
        SELECT
            COALESCE(ab.court_id, cd.court_id) AS blocked_court_id,
            ab.block_date,
            ab.start_time AS blocked_start,
            ab.end_time AS blocked_end
        FROM availability_block ab
        JOIN court_dates cd ON (
            ab.block_date = cd.the_date
            AND (ab.court_id = cd.court_id OR (ab.court_id IS NULL AND ab.facility_id = cd.facility_id))
        )
        WHERE ab.block_date >= p_date_from AND ab.block_date <= p_date_to
    ),
    -- Get one-time blocked entries
    one_time_blocked AS (
        SELECT
            COALESCE(ota.court_id, cd.court_id) AS blocked_court_id,
            ota.availability_date AS block_date,
            ota.start_time AS blocked_start,
            ota.end_time AS blocked_end
        FROM court_one_time_availability ota
        JOIN court_dates cd ON (
            ota.availability_date = cd.the_date
            AND (ota.court_id = cd.court_id OR (ota.court_id IS NULL AND ota.facility_id = cd.facility_id))
        )
        WHERE ota.is_available = FALSE
            AND ota.availability_date >= p_date_from
            AND ota.availability_date <= p_date_to
    )
    -- Return available slots (excluding booked and blocked)
    SELECT
        ds.court_id,
        ds.the_date,
        ds.slot_start,
        ds.slot_end,
        -- Apply pricing rules if any match this slot
        COALESCE(
            (SELECT pr.price_cents
             FROM pricing_rule pr
             WHERE (pr.court_id = ds.court_id OR (pr.facility_id = ds.facility_id AND pr.court_id IS NULL))
                 AND ds.the_date >= COALESCE(pr.valid_from, '1900-01-01'::DATE)
                 AND ds.the_date <= COALESCE(pr.valid_until, '2100-01-01'::DATE)
                 AND EXTRACT(DOW FROM ds.the_date)::INTEGER = ANY(pr.days_of_week)
                 AND ds.slot_start >= pr.start_time
                 AND ds.slot_start < pr.end_time
                 AND pr.is_active = TRUE
             ORDER BY CASE WHEN pr.court_id IS NOT NULL THEN 1 ELSE 0 END DESC, pr.priority DESC
             LIMIT 1),
            ds.tpl_price_cents
        ),
        ds.tpl_source
    FROM deduped_slots ds
    -- Exclude booked slots
    WHERE NOT EXISTS (
        SELECT 1 FROM booked_times bt
        WHERE bt.booked_court_id = ds.court_id
            AND bt.booking_date = ds.the_date
            AND (ds.slot_start, ds.slot_end) OVERLAPS (bt.booked_start, bt.booked_end)
    )
    -- Exclude blocked slots (from availability_block)
    AND NOT EXISTS (
        SELECT 1 FROM blocked_times bl
        WHERE bl.blocked_court_id = ds.court_id
            AND bl.block_date = ds.the_date
            AND (bl.blocked_start IS NULL OR (ds.slot_start, ds.slot_end) OVERLAPS (bl.blocked_start, bl.blocked_end))
    )
    -- Exclude one-time blocked slots
    AND NOT EXISTS (
        SELECT 1 FROM one_time_blocked otb
        WHERE otb.blocked_court_id = ds.court_id
            AND otb.block_date = ds.the_date
            AND (ds.slot_start, ds.slot_end) OVERLAPS (otb.blocked_start, otb.blocked_end)
    )
    ORDER BY ds.court_id, ds.the_date, ds.slot_start;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_available_slots_batch(UUID[], DATE, DATE) IS
    'Batched version of get_available_slots for performance optimization.
     Accepts an array of court IDs and a date range, returning all available
     slots for all courts and dates in a single query.

     Returns: court_id, slot_date, start_time, end_time, price_cents, template_source

     Logic:
     1. Generates all (court, date) combinations
     2. Gets BOTH one-time and recurring templates (merged, not overriding)
     3. Generates individual slots from all templates
     4. Deduplicates overlapping slots (one_time > court > facility priority)
     5. Excludes booked slots, availability blocks, and one-time blocks
     6. Applies pricing rules if defined';
