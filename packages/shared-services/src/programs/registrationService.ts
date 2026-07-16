/**
 * Registration Service
 *
 * Manages program registrations and payments.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProgramRegistration, RegistrationStatusEnum } from '@rallia/shared-types';
import type {
  CreateRegistrationParams,
  RegistrationWithDetails,
  RegistrationListFilters,
  ServiceResult,
  PaginatedResult,
  InstallmentSchedule,
} from './types';

/**
 * Create a new registration
 */
export async function createRegistration(
  supabase: SupabaseClient,
  params: CreateRegistrationParams
): Promise<ServiceResult<ProgramRegistration>> {
  // Get program details
  const { data: program, error: programError } = await supabase
    .from('program')
    .select(
      'id, status, price_cents, currency, max_participants, current_participants, allow_installments, installment_count, registration_deadline'
    )
    .eq('id', params.programId)
    .single();

  if (programError || !program) {
    return { success: false, error: 'Program not found' };
  }

  // Check program is published
  if (program.status !== 'published') {
    return { success: false, error: 'Program is not open for registration' };
  }

  // Check registration deadline
  if (program.registration_deadline) {
    const deadline = new Date(program.registration_deadline);
    if (new Date() > deadline) {
      return { success: false, error: 'Registration deadline has passed' };
    }
  }

  // Check capacity
  if (program.max_participants && program.current_participants >= program.max_participants) {
    return { success: false, error: 'Program is at full capacity' };
  }

  // Check for existing registration
  const { data: existingReg } = await supabase
    .from('program_registration')
    .select('id, status')
    .eq('program_id', params.programId)
    .eq('player_id', params.playerId)
    .single();

  if (existingReg) {
    if (existingReg.status === 'confirmed' || existingReg.status === 'pending') {
      return { success: false, error: 'Player is already registered for this program' };
    }
  }

  // Determine payment plan
  const paymentPlan = params.paymentPlan || (program.allow_installments ? 'installment' : 'full');

  // Create registration
  const { data, error } = await supabase
    .from('program_registration')
    .insert({
      program_id: params.programId,
      player_id: params.playerId,
      registered_by: params.registeredBy,
      status: 'pending',
      payment_plan: paymentPlan,
      total_amount_cents: program.price_cents,
      paid_amount_cents: 0,
      currency: program.currency,
      stripe_customer_id: params.stripeCustomerId || null,
      notes: params.notes || null,
      emergency_contact_name: params.emergencyContactName || null,
      emergency_contact_phone: params.emergencyContactPhone || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'Player is already registered for this program' };
    }
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Get registration by ID with details
 */
export async function getRegistration(
  supabase: SupabaseClient,
  registrationId: string
): Promise<ServiceResult<RegistrationWithDetails>> {
  const { data, error } = await supabase
    .from('program_registration')
    .select(
      `
      *,
      player:player_id (
        id,
        username,
        profile!player_id_fkey (
          first_name,
          last_name,
          display_name,
          profile_picture_url,
          email,
          phone
        )
      ),
      program:program_id (*),
      payments:registration_payment (*)
    `
    )
    .eq('id', registrationId)
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: data as RegistrationWithDetails };
}

/**
 * List registrations for a program
 */
export async function listRegistrations(
  supabase: SupabaseClient,
  filters: RegistrationListFilters
): Promise<PaginatedResult<RegistrationWithDetails>> {
  let query = supabase
    .from('program_registration')
    .select(
      `
      *,
      player:player_id (
        id,
        username,
        profile!player_id_fkey (
          first_name,
          last_name,
          display_name,
          profile_picture_url,
          email,
          phone
        )
      )
    `,
      { count: 'exact' }
    )
    .eq('program_id', filters.programId)
    .order('registered_at', { ascending: false });

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return { data: [], total: 0, limit, offset };
  }

  return {
    data: (data || []) as RegistrationWithDetails[],
    total: count || 0,
    limit,
    offset,
  };
}

/**
 * Update registration status
 */
export async function updateRegistrationStatus(
  supabase: SupabaseClient,
  registrationId: string,
  status: RegistrationStatusEnum,
  updatedBy?: string
): Promise<ServiceResult<ProgramRegistration>> {
  const updateData: Record<string, unknown> = { status };

  if (status === 'confirmed') {
    updateData.confirmed_at = new Date().toISOString();
  } else if (status === 'cancelled') {
    updateData.cancelled_at = new Date().toISOString();
  } else if (status === 'refunded') {
    updateData.refunded_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('program_registration')
    .update(updateData)
    .eq('id', registrationId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Confirm a registration (after payment)
 */
export async function confirmRegistration(
  supabase: SupabaseClient,
  registrationId: string,
  paidAmountCents: number
): Promise<ServiceResult<ProgramRegistration>> {
  const { data, error } = await supabase
    .from('program_registration')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      paid_amount_cents: paidAmountCents,
    })
    .eq('id', registrationId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Calculate installment schedule for a registration
 */
export function calculateInstallmentSchedule(
  totalAmountCents: number,
  installmentCount: number,
  programStartDate: Date
): InstallmentSchedule[] {
  const baseAmount = Math.floor(totalAmountCents / installmentCount);
  const remainder = totalAmountCents - baseAmount * installmentCount;

  const schedule: InstallmentSchedule[] = [];
  const now = new Date();
  const daysUntilStart = Math.max(
    1,
    Math.ceil((programStartDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );

  for (let i = 0; i < installmentCount; i++) {
    // First payment is due immediately, rest spread before program start
    let dueDate: Date;
    if (i === 0) {
      dueDate = now;
    } else {
      // Spread remaining payments evenly before program start
      const daysBeforeStart = Math.floor(
        ((installmentCount - 1 - i) / (installmentCount - 1)) * Math.min(30, daysUntilStart)
      );
      dueDate = new Date(now.getTime() + daysBeforeStart * 24 * 60 * 60 * 1000);
    }

    schedule.push({
      installmentNumber: i + 1,
      // Add remainder to first payment
      amountCents: baseAmount + (i === 0 ? remainder : 0),
      dueDate,
    });
  }

  return schedule;
}

/**
 * Create payment records for a registration (installments)
 */
export async function createInstallmentPayments(
  supabase: SupabaseClient,
  registrationId: string,
  schedule: InstallmentSchedule[],
  stripeCustomerId?: string
): Promise<ServiceResult<void>> {
  const { data: registration } = await supabase
    .from('program_registration')
    .select('currency')
    .eq('id', registrationId)
    .single();

  const payments = schedule.map(s => ({
    registration_id: registrationId,
    amount_cents: s.amountCents,
    currency: registration?.currency || 'CAD',
    installment_number: s.installmentNumber,
    total_installments: schedule.length,
    due_date: s.dueDate.toISOString().split('T')[0],
    stripe_customer_id: stripeCustomerId || null,
    status: 'pending',
  }));

  const { error } = await supabase.from('registration_payment').insert(payments);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Update registration paid amount
 */
export async function updatePaidAmount(
  supabase: SupabaseClient,
  registrationId: string
): Promise<ServiceResult<number>> {
  // Calculate total paid from successful payments
  const { data: payments } = await supabase
    .from('registration_payment')
    .select('amount_cents')
    .eq('registration_id', registrationId)
    .eq('status', 'succeeded');

  const totalPaid = payments?.reduce((sum, p) => sum + p.amount_cents, 0) || 0;

  const { error } = await supabase
    .from('program_registration')
    .update({ paid_amount_cents: totalPaid })
    .eq('id', registrationId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: totalPaid };
}

/**
 * Get registration by program and player
 */
export async function getRegistrationByPlayer(
  supabase: SupabaseClient,
  programId: string,
  playerId: string
): Promise<ServiceResult<ProgramRegistration | null>> {
  const { data, error } = await supabase
    .from('program_registration')
    .select('*')
    .eq('program_id', programId)
    .eq('player_id', playerId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return { success: false, error: error.message };
  }

  return { success: true, data: data || null };
}

/**
 * Get count of sessions attended by a registration
 */
export async function getSessionsAttended(
  supabase: SupabaseClient,
  registrationId: string
): Promise<{ attended: number; total: number }> {
  // Get program ID from registration
  const { data: registration } = await supabase
    .from('program_registration')
    .select('program_id')
    .eq('id', registrationId)
    .single();

  if (!registration) {
    return { attended: 0, total: 0 };
  }

  // Get total sessions for the program
  const { count: totalSessions } = await supabase
    .from('program_session')
    .select('*', { count: 'exact', head: true })
    .eq('program_id', registration.program_id)
    .eq('is_cancelled', false);

  // Get attendance records for this registration
  const { count: attendedSessions } = await supabase
    .from('session_attendance')
    .select('*', { count: 'exact', head: true })
    .eq('registration_id', registrationId)
    .eq('attended', true);

  return {
    attended: attendedSessions || 0,
    total: totalSessions || 0,
  };
}
