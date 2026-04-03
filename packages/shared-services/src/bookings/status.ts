/**
 * Booking Status Service
 *
 * Handles updating booking status with validation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingStatus, UpdateBookingStatusParams } from './types';

/**
 * Valid state transitions for bookings
 */
const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ['confirmed', 'cancelled', 'awaiting_approval'],
  awaiting_approval: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [], // Terminal state
  cancelled: [], // Terminal state
  no_show: [], // Terminal state
};

/**
 * Check if a status transition is valid
 */
export function isValidTransition(currentStatus: BookingStatus, newStatus: BookingStatus): boolean {
  const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
  return allowedTransitions.includes(newStatus);
}

/**
 * Update booking status
 */
export async function updateBookingStatus(
  supabase: SupabaseClient,
  params: UpdateBookingStatusParams
): Promise<{ success: boolean; booking: { id: string; status: BookingStatus } }> {
  // 1. Get current booking
  const { data: booking, error: bookingError } = await supabase
    .from('booking')
    .select('id, status, organization_id')
    .eq('id', params.bookingId)
    .single();

  if (bookingError || !booking) {
    throw new Error('Booking not found');
  }

  // 2. Validate state transition
  if (!isValidTransition(booking.status as BookingStatus, params.newStatus)) {
    throw new Error(`Invalid status transition from '${booking.status}' to '${params.newStatus}'`);
  }

  // 3. Build update object based on new status
  const updateData: Record<string, unknown> = {
    status: params.newStatus,
    updated_at: new Date().toISOString(),
  };

  // Add status-specific fields
  if (params.newStatus === 'confirmed') {
    updateData.approved_by = params.updatedBy;
    updateData.approved_at = new Date().toISOString();
  }

  // 4. Update the booking
  const { data: updatedBooking, error: updateError } = await supabase
    .from('booking')
    .update(updateData)
    .eq('id', params.bookingId)
    .select('id, status')
    .single();

  if (updateError) {
    throw new Error(`Failed to update booking status: ${updateError.message}`);
  }

  return {
    success: true,
    booking: {
      id: updatedBooking.id,
      status: updatedBooking.status as BookingStatus,
    },
  };
}

/**
 * Confirm a booking after successful payment
 * Called by webhook when payment_intent.succeeded
 */
export async function confirmBookingPayment(
  supabase: SupabaseClient,
  paymentIntentId: string,
  chargeId?: string
): Promise<{ success: boolean; bookingId?: string }> {
  // Find booking by payment intent ID
  const { data: booking, error: findError } = await supabase
    .from('booking')
    .select('id, status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .single();

  if (findError || !booking) {
    return { success: false };
  }

  // Only confirm if booking is still pending
  if (booking.status !== 'pending') {
    return { success: true, bookingId: booking.id };
  }

  // Update booking to confirmed
  const { error: updateError } = await supabase
    .from('booking')
    .update({
      status: 'confirmed',
      stripe_charge_id: chargeId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', booking.id);

  if (updateError) {
    throw new Error(`Failed to confirm booking: ${updateError.message}`);
  }

  return { success: true, bookingId: booking.id };
}

/**
 * Mark booking as failed after payment failure
 * Called by webhook when payment_intent.payment_failed
 */
export async function markBookingPaymentFailed(
  supabase: SupabaseClient,
  paymentIntentId: string,
  failureMessage?: string
): Promise<{ success: boolean; bookingId?: string }> {
  // Find booking by payment intent ID
  const { data: booking, error: findError } = await supabase
    .from('booking')
    .select('id, status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .single();

  if (findError || !booking) {
    return { success: false };
  }

  // Only cancel if booking is pending
  if (booking.status !== 'pending') {
    return { success: true, bookingId: booking.id };
  }

  // Update booking to cancelled due to payment failure
  const { error: updateError } = await supabase
    .from('booking')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: failureMessage || 'Payment failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', booking.id);

  if (updateError) {
    throw new Error(`Failed to mark booking as failed: ${updateError.message}`);
  }

  return { success: true, bookingId: booking.id };
}

/**
 * Update booking refund status
 * Called by webhook when charge.refunded
 */
export async function updateBookingRefundStatus(
  supabase: SupabaseClient,
  chargeId: string,
  amountRefundedCents: number,
  isFullRefund: boolean
): Promise<{ success: boolean; bookingId?: string }> {
  // Find booking by charge ID
  const { data: booking, error: findError } = await supabase
    .from('booking')
    .select('id')
    .eq('stripe_charge_id', chargeId)
    .single();

  if (findError || !booking) {
    return { success: false };
  }

  // Update refund status
  const { error: updateError } = await supabase
    .from('booking')
    .update({
      refund_amount_cents: amountRefundedCents,
      refund_status: isFullRefund ? 'refunded' : 'partial',
      updated_at: new Date().toISOString(),
    })
    .eq('id', booking.id);

  if (updateError) {
    throw new Error(`Failed to update refund status: ${updateError.message}`);
  }

  return { success: true, bookingId: booking.id };
}
