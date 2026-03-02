/**
 * Booking Create Edge Function
 *
 * Creates a new booking with optional Stripe payment processing.
 * Consolidates logic from web API route + create service so both
 * web and mobile can call supabase.functions.invoke('booking-create').
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

// ---------------------------------------------------------------------------
// Helpers (inlined from shared-services – Deno can't import monorepo pkgs)
// ---------------------------------------------------------------------------

function normalizeTimeForComparison(time: string): string {
  if (!time || typeof time !== 'string') return time;
  const trimmed = time.trim();
  const parts = trimmed.split(/[.:]/);
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10) || 0;
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return trimmed;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
}

function calculateApplicationFee(amountCents: number, feePercent: number = 5): number {
  return Math.round((amountCents * feePercent) / 100);
}

// ---------------------------------------------------------------------------
// Validation helpers (inlined from validation.ts)
// ---------------------------------------------------------------------------

interface CheckPlayerBlockedResult {
  blocked: boolean;
  reason?: string;
}

async function checkPlayerBlocked(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  organizationId: string,
  playerId: string
): Promise<CheckPlayerBlockedResult> {
  const { data: block } = await supabase
    .from('organization_player_block')
    .select('reason, blocked_until')
    .eq('organization_id', organizationId)
    .eq('player_id', playerId)
    .eq('is_active', true)
    .single();

  if (!block) return { blocked: false };

  if (block.blocked_until && new Date(block.blocked_until) < new Date()) {
    return { blocked: false };
  }

  return {
    blocked: true,
    reason: block.reason || 'You are blocked from booking at this organization',
  };
}

async function checkBookingConstraints(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: { organizationId: string; bookingDate: string; startTime: string }
): Promise<{ valid: boolean; error?: string }> {
  const { data: settings } = await supabase
    .from('organization_settings')
    .select('*')
    .eq('organization_id', params.organizationId)
    .single();

  if (!settings) return { valid: true };

  const now = new Date();
  const bookingDateTime = new Date(`${params.bookingDate}T${params.startTime}`);
  const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isToday = params.bookingDate === todayLocal;
  if (isToday && !settings.allow_same_day_booking) {
    return { valid: false, error: 'Same-day bookings are not allowed' };
  }

  if (hoursUntilBooking < settings.min_booking_notice_hours) {
    return {
      valid: false,
      error: `Bookings require at least ${settings.min_booking_notice_hours} hours notice`,
    };
  }

  const daysInAdvance = Math.ceil(hoursUntilBooking / 24);
  if (daysInAdvance > settings.max_advance_booking_days) {
    return {
      valid: false,
      error: `Bookings can only be made up to ${settings.max_advance_booking_days} days in advance`,
    };
  }

  return { valid: true };
}

async function validateBookingSlot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: { courtId: string; bookingDate: string; startTime: string; endTime: string }
): Promise<{ valid: boolean; error?: string }> {
  const { data: court, error: courtError } = await supabase
    .from('court')
    .select('availability_status')
    .eq('id', params.courtId)
    .single();

  if (courtError) return { valid: false, error: 'Court not found' };

  // NULL availability_status means "available" (default)
  if (court.availability_status && court.availability_status !== 'available') {
    const statusMessages: Record<string, string> = {
      maintenance: 'This court is currently under maintenance',
      closed: 'This court is closed',
      reserved: 'This court is reserved',
    };
    return {
      valid: false,
      error: statusMessages[court.availability_status] || 'This court is not available for booking',
    };
  }

  const { data: availableSlots, error } = await supabase.rpc('get_available_slots', {
    p_court_id: params.courtId,
    p_date: params.bookingDate,
  });

  if (error) return { valid: false, error: `Failed to check availability: ${error.message}` };

  const normStart = normalizeTimeForComparison(params.startTime);
  const normEnd = normalizeTimeForComparison(params.endTime);
  const matchingSlot = availableSlots?.find(
    (slot: { start_time: string; end_time: string }) =>
      normalizeTimeForComparison(slot.start_time) === normStart &&
      normalizeTimeForComparison(slot.end_time) === normEnd
  );

  if (!matchingSlot) return { valid: false, error: 'The requested time slot is not available' };

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ---- Auth ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;

    // User-scoped client for auth verification
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }
    const user = authData.user;

    // Service-role client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ---- Parse body ----
    const body = await req.json();
    const {
      courtId,
      bookingDate,
      startTime,
      endTime,
      skipPayment,
      playerId: requestedPlayerId,
      guestName,
      guestEmail,
      guestPhone,
      notes,
    } = body;

    if (!courtId || !bookingDate || !startTime || !endTime) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields: courtId, bookingDate, startTime, endTime',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // ---- Look up court -> facility -> org ----
    const { data: court, error: courtError } = await supabase
      .from('court')
      .select('id, facility:facility_id (id, organization_id)')
      .eq('id', courtId)
      .single();

    if (courtError || !court || !court.facility) {
      return new Response(JSON.stringify({ error: 'Court not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    const facility = court.facility as { id: string; organization_id: string };
    const organizationId = facility.organization_id;

    // ---- Staff / guest permission checks ----
    let effectivePlayerId = user.id;
    let isStaffBooking = false;

    if (requestedPlayerId && requestedPlayerId !== user.id) {
      const { data: membership } = await supabase
        .from('organization_member')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .is('left_at', null)
        .single();

      const isOrgStaff = membership?.role && ['owner', 'admin', 'staff'].includes(membership.role);
      if (!isOrgStaff) {
        return new Response(
          JSON.stringify({
            error: 'Only organization staff can create bookings for other players',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
      effectivePlayerId = requestedPlayerId;
      isStaffBooking = true;
    }

    const isGuestBooking = guestName && !requestedPlayerId;
    if (isGuestBooking) {
      const { data: membership } = await supabase
        .from('organization_member')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .is('left_at', null)
        .single();

      const isOrgStaff = membership?.role && ['owner', 'admin', 'staff'].includes(membership.role);
      if (!isOrgStaff) {
        return new Response(
          JSON.stringify({ error: 'Only organization staff can create guest bookings' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
      isStaffBooking = true;
    }

    // ---- Find matching slot + price ----
    const { data: slots, error: slotsError } = await supabase.rpc('get_available_slots', {
      p_court_id: courtId,
      p_date: bookingDate,
    });

    if (slotsError) {
      console.error('get_available_slots RPC error:', slotsError);
      return new Response(
        JSON.stringify({
          error: `Failed to check availability: ${slotsError.message}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    const normStart = normalizeTimeForComparison(startTime);
    const normEnd = normalizeTimeForComparison(endTime);
    const matchingSlot = slots?.find(
      (slot: { start_time: string; end_time: string }) =>
        normalizeTimeForComparison(slot.start_time) === normStart &&
        normalizeTimeForComparison(slot.end_time) === normEnd
    );

    if (!matchingSlot) {
      return new Response(JSON.stringify({ error: 'The requested time slot is not available' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // ---- Approval check ----
    const { data: settings } = await supabase
      .from('organization_settings')
      .select('require_booking_approval')
      .eq('organization_id', organizationId)
      .single();

    const requiresApproval = settings?.require_booking_approval || false;

    // ---- Payment determination ----
    const slotPriceCents = matchingSlot.price_cents ?? 0;
    const isFreeSlot = slotPriceCents === 0;
    const shouldSkipPayment =
      skipPayment || isFreeSlot || (isStaffBooking && skipPayment !== false);

    let stripeAccountId: string | undefined;
    if (!shouldSkipPayment) {
      const { data: stripeAccount } = await supabase
        .from('organization_stripe_account')
        .select('stripe_account_id, charges_enabled')
        .eq('organization_id', organizationId)
        .single();

      if (!stripeAccount || !stripeAccount.charges_enabled) {
        const priceDisplay = (slotPriceCents / 100).toFixed(2);
        return new Response(
          JSON.stringify({
            error: `This slot costs $${priceDisplay} but the organization hasn't set up payments yet. Please contact the facility or choose a free slot.`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
      stripeAccountId = stripeAccount.stripe_account_id;
    }

    // ---- Build notes for guest bookings ----
    let bookingNotes = notes || '';
    if (isGuestBooking) {
      const guestInfo = [`Guest: ${guestName}`];
      if (guestEmail) guestInfo.push(`Email: ${guestEmail}`);
      if (guestPhone) guestInfo.push(`Phone: ${guestPhone}`);
      bookingNotes = guestInfo.join(' | ') + (bookingNotes ? ` | ${bookingNotes}` : '');
    }

    // ---- Validation (player blocked, constraints, slot available) ----
    const actualPlayerId = isGuestBooking ? null : effectivePlayerId;

    if (actualPlayerId) {
      const blockCheck = await checkPlayerBlocked(supabase, organizationId, actualPlayerId);
      if (blockCheck.blocked) {
        return new Response(JSON.stringify({ error: blockCheck.reason }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        });
      }
    }

    const constraintCheck = await checkBookingConstraints(supabase, {
      organizationId,
      bookingDate,
      startTime,
    });
    if (!constraintCheck.valid) {
      return new Response(JSON.stringify({ error: constraintCheck.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const slotValidation = await validateBookingSlot(supabase, {
      courtId,
      bookingDate,
      startTime,
      endTime,
    });
    if (!slotValidation.valid) {
      return new Response(JSON.stringify({ error: slotValidation.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // ---- Determine initial status ----
    let status: 'pending' | 'confirmed' | 'awaiting_approval' = 'pending';
    if (shouldSkipPayment) {
      status = 'confirmed';
    } else if (isStaffBooking ? false : requiresApproval) {
      status = 'awaiting_approval';
    }

    // ---- Create PaymentIntent if needed ----
    let paymentIntentId: string | null = null;
    let clientSecret: string | null = null;

    if (!shouldSkipPayment && stripeAccountId) {
      const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });
      const applicationFee = calculateApplicationFee(slotPriceCents, 5);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: slotPriceCents,
        currency: 'cad',
        description: `Court booking for ${bookingDate}`,
        metadata: {
          court_id: courtId,
          organization_id: organizationId,
          player_id: actualPlayerId || 'guest',
          booking_date: bookingDate,
          start_time: startTime,
          end_time: endTime,
        },
        transfer_data: { destination: stripeAccountId },
        application_fee_amount: applicationFee,
        automatic_payment_methods: { enabled: true },
      });

      paymentIntentId = paymentIntent.id;
      clientSecret = paymentIntent.client_secret!;
    }

    // ---- Insert booking record ----
    const { data: booking, error: bookingError } = await supabase
      .from('booking')
      .insert({
        organization_id: organizationId,
        court_id: courtId,
        player_id: actualPlayerId,
        booking_date: bookingDate,
        start_time: startTime,
        end_time: endTime,
        status,
        price_cents: slotPriceCents,
        currency: 'CAD',
        stripe_payment_intent_id: paymentIntentId,
        requires_approval: isStaffBooking ? false : requiresApproval,
        notes: bookingNotes || null,
      })
      .select('id, status')
      .single();

    if (bookingError) {
      // If DB insert fails after PaymentIntent was created, cancel the intent
      if (paymentIntentId) {
        try {
          const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });
          await stripe.paymentIntents.cancel(paymentIntentId);
        } catch (cancelErr) {
          console.error('Failed to cancel PaymentIntent after DB error:', cancelErr);
        }
      }

      if (bookingError.code === '23P01') {
        return new Response(JSON.stringify({ error: 'This time slot has already been booked' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 409,
        });
      }
      return new Response(
        JSON.stringify({ error: `Failed to create booking: ${bookingError.message}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    return new Response(
      JSON.stringify({
        bookingId: booking.id,
        status: booking.status,
        clientSecret,
        priceCents: slotPriceCents,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create booking';
    console.error('booking-create error:', message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
