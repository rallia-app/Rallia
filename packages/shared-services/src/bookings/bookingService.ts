/**
 * Unified Booking Service
 *
 * Thin client that calls Supabase Edge Functions for Stripe-dependent
 * operations (create, cancel) and uses direct Supabase queries for reads.
 * Both web and mobile consume this identically.
 */

import { supabase } from '../supabase';
import type {
  CreateBookingClientParams,
  CreateBookingClientResult,
  CancelBookingClientParams,
  CancelBookingClientResult,
  BookingWithDetails,
  BookingListFilters,
  GetPlayerBookingsPaginatedParams,
  PlayerBookingsPage,
} from './types';

// ---------------------------------------------------------------------------
// Booking select fragment (shared across read queries)
// ---------------------------------------------------------------------------

const BOOKING_WITH_DETAILS_SELECT = `
  id, organization_id, court_id, player_id,
  booking_date, start_time, end_time,
  status, booking_type, price_cents, currency,
  payment_status, payment_method,
  stripe_payment_intent_id, stripe_charge_id,
  requires_approval, notes,
  cancelled_at, cancelled_by, cancellation_reason,
  refund_amount_cents, refund_status,
  created_at, updated_at,
  court:court_id (
    id, name, court_number,
    facility:facility_id (
      id, name, address, city, timezone, organization_id
    )
  )
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the error message from a Supabase Edge Function error.
 *
 * When the Edge Function returns a non-2xx status, the Supabase client
 * throws FunctionsHttpError *before* parsing the response body. So `data`
 * is always null. The raw Response is available on `error.context`.
 */
async function extractEdgeFunctionError(
  error: { context?: Response; message?: string },
  fallback: string
): Promise<string> {
  // FunctionsHttpError stores the raw Response in `context`
  if (error.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json();
      if (body?.error && typeof body.error === 'string') {
        return body.error;
      }
    } catch {
      // JSON parsing failed — fall through
    }
  }
  return error.message ?? fallback;
}

// ---------------------------------------------------------------------------
// Create (Edge Function)
// ---------------------------------------------------------------------------

/**
 * Create a booking via the `booking-create` Edge Function.
 * Handles Stripe PaymentIntent creation server-side.
 */
export async function createBooking(
  params: CreateBookingClientParams
): Promise<CreateBookingClientResult> {
  const { data, error } = await supabase.functions.invoke('booking-create', {
    body: params,
  });

  if (error) {
    const message = await extractEdgeFunctionError(error, 'Failed to create booking');
    throw new Error(message);
  }

  return data as CreateBookingClientResult;
}

// ---------------------------------------------------------------------------
// Cancel (Edge Function)
// ---------------------------------------------------------------------------

/**
 * Cancel a booking via the `booking-cancel` Edge Function.
 * Handles Stripe refund processing server-side.
 */
export async function cancelBooking(
  params: CancelBookingClientParams
): Promise<CancelBookingClientResult> {
  const { data, error } = await supabase.functions.invoke('booking-cancel', {
    body: params,
  });

  if (error) {
    const message = await extractEdgeFunctionError(error, 'Failed to cancel booking');
    throw new Error(message);
  }

  return data as CancelBookingClientResult;
}

// ---------------------------------------------------------------------------
// Read: single booking (direct Supabase)
// ---------------------------------------------------------------------------

/**
 * Get a single booking by ID with court/facility details.
 */
export async function getBooking(bookingId: string): Promise<BookingWithDetails | null> {
  const { data, error } = await supabase
    .from('booking')
    .select(BOOKING_WITH_DETAILS_SELECT)
    .eq('id', bookingId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to fetch booking: ${error.message}`);
  }

  return data as unknown as BookingWithDetails;
}

// ---------------------------------------------------------------------------
// Read: player bookings (direct Supabase)
// ---------------------------------------------------------------------------

/**
 * Get all bookings for a player, with optional filters.
 */
export async function getPlayerBookings(
  playerId: string,
  filters?: BookingListFilters
): Promise<BookingWithDetails[]> {
  let query = supabase
    .from('booking')
    .select(BOOKING_WITH_DETAILS_SELECT)
    .eq('player_id', playerId)
    .order('booking_date', { ascending: false });

  query = applyFilters(query, filters);

  const { data, error } = await query;

  if (error) throw new Error(`Failed to fetch player bookings: ${error.message}`);
  return (data ?? []) as unknown as BookingWithDetails[];
}

// ---------------------------------------------------------------------------
// Read: organization bookings (direct Supabase)
// ---------------------------------------------------------------------------

/**
 * Get all bookings for an organization, with optional filters.
 */
export async function getOrgBookings(
  orgId: string,
  filters?: BookingListFilters
): Promise<BookingWithDetails[]> {
  let query = supabase
    .from('booking')
    .select(BOOKING_WITH_DETAILS_SELECT)
    .eq('organization_id', orgId)
    .order('booking_date', { ascending: false });

  query = applyFilters(query, filters);

  const { data, error } = await query;

  if (error) throw new Error(`Failed to fetch organization bookings: ${error.message}`);
  return (data ?? []) as unknown as BookingWithDetails[];
}

// ---------------------------------------------------------------------------
// Read: paginated player bookings (for infinite scroll)
// ---------------------------------------------------------------------------

/** Default page size for paginated queries */
const DEFAULT_PAGE_SIZE = 20;

/**
 * Get paginated bookings for a player with time-based filtering.
 * Designed for useInfiniteQuery consumption (returns page structure).
 */
export async function getPlayerBookingsPaginated(
  params: GetPlayerBookingsPaginatedParams
): Promise<PlayerBookingsPage> {
  const {
    playerId,
    timeFilter,
    statusFilter = 'all',
    limit = DEFAULT_PAGE_SIZE,
    offset = 0,
  } = params;

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let query = supabase
    .from('booking')
    .select(BOOKING_WITH_DETAILS_SELECT)
    .eq('player_id', playerId)
    .eq('booking_type', 'player');

  // Apply time filter and sort: upcoming = soonest first, past = most recent first
  if (timeFilter === 'upcoming') {
    query = query
      .gte('booking_date', todayStr)
      .order('booking_date', { ascending: true })
      .order('start_time', { ascending: true });
  } else {
    query = query
      .lte('booking_date', todayStr)
      .order('booking_date', { ascending: false })
      .order('start_time', { ascending: false });
  }

  // Apply status filter
  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  } else if (timeFilter === 'upcoming') {
    query = query.in('status', ['confirmed', 'pending', 'awaiting_approval']);
  }
  // For 'past' with 'all', we show all statuses (completed, cancelled, no_show)

  // Fetch one extra to determine if there are more pages
  query = query.range(offset, offset + limit);

  const { data, error } = await query;

  if (error) throw new Error(`Failed to fetch player bookings: ${error.message}`);

  const bookings = (data ?? []) as unknown as BookingWithDetails[];
  const hasMore = bookings.length > limit;

  return {
    bookings: hasMore ? bookings.slice(0, limit) : bookings,
    nextOffset: hasMore ? offset + limit : null,
    hasMore,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, filters?: BookingListFilters) {
  if (!filters) return query;

  if (filters.dateFrom) {
    query = query.gte('booking_date', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('booking_date', filters.dateTo);
  }
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status);
    } else {
      query = query.eq('status', filters.status);
    }
  }
  if (filters.bookingType) {
    query = query.eq('booking_type', filters.bookingType);
  }
  if (filters.limit) {
    query = query.limit(filters.limit);
  }
  if (filters.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit ?? 20) - 1);
  }

  return query;
}
