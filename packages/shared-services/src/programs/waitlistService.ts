/**
 * Waitlist Service
 *
 * Manages program waitlists with FIFO promotion.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProgramWaitlist } from '@rallia/shared-types';
import type {
  AddToWaitlistParams,
  WaitlistEntryWithDetails,
  ServiceResult,
  PaginatedResult,
} from './types';

/** Default hours to claim a promoted spot */
const DEFAULT_PROMOTION_CLAIM_HOURS = 48;

/**
 * Add a player to the waitlist
 */
export async function addToWaitlist(
  supabase: SupabaseClient,
  params: AddToWaitlistParams
): Promise<ServiceResult<ProgramWaitlist>> {
  // Check program exists and has waitlist enabled
  const { data: program } = await supabase
    .from('program')
    .select('id, status, waitlist_enabled, waitlist_limit')
    .eq('id', params.programId)
    .single();

  if (!program) {
    return { success: false, error: 'Program not found' };
  }

  if (program.status !== 'published') {
    return { success: false, error: 'Program is not open for registration' };
  }

  if (!program.waitlist_enabled) {
    return { success: false, error: 'Waitlist is not enabled for this program' };
  }

  // Check waitlist limit
  if (program.waitlist_limit) {
    const { count } = await supabase
      .from('program_waitlist')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', params.programId);

    if (count && count >= program.waitlist_limit) {
      return { success: false, error: 'Waitlist is full' };
    }
  }

  // Check if player is already on waitlist
  const { data: existing } = await supabase
    .from('program_waitlist')
    .select('id')
    .eq('program_id', params.programId)
    .eq('player_id', params.playerId)
    .single();

  if (existing) {
    return { success: false, error: 'Player is already on the waitlist' };
  }

  // Check if player is already registered
  const { data: existingReg } = await supabase
    .from('program_registration')
    .select('id, status')
    .eq('program_id', params.programId)
    .eq('player_id', params.playerId)
    .in('status', ['pending', 'confirmed'])
    .single();

  if (existingReg) {
    return { success: false, error: 'Player is already registered for this program' };
  }

  // Add to waitlist (position is auto-assigned by trigger)
  const { data, error } = await supabase
    .from('program_waitlist')
    .insert({
      program_id: params.programId,
      player_id: params.playerId,
      added_by: params.addedBy,
      position: 0, // Will be set by trigger
      notes: params.notes || null,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Get waitlist entry by ID
 */
export async function getWaitlistEntry(
  supabase: SupabaseClient,
  waitlistId: string
): Promise<ServiceResult<WaitlistEntryWithDetails>> {
  const { data, error } = await supabase
    .from('program_waitlist')
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
    `
    )
    .eq('id', waitlistId)
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: data as WaitlistEntryWithDetails };
}

/**
 * List waitlist entries for a program
 */
export async function listWaitlist(
  supabase: SupabaseClient,
  programId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedResult<WaitlistEntryWithDetails>> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  const { data, error, count } = await supabase
    .from('program_waitlist')
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
    .eq('program_id', programId)
    .order('position', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return { data: [], total: 0, limit, offset };
  }

  return {
    data: (data || []) as WaitlistEntryWithDetails[],
    total: count || 0,
    limit,
    offset,
  };
}

/**
 * Remove a player from the waitlist
 */
export async function removeFromWaitlist(
  supabase: SupabaseClient,
  waitlistId: string
): Promise<ServiceResult<void>> {
  // Get the entry to know its position
  const { data: entry } = await supabase
    .from('program_waitlist')
    .select('program_id, position')
    .eq('id', waitlistId)
    .single();

  if (!entry) {
    return { success: false, error: 'Waitlist entry not found' };
  }

  // Delete the entry
  const { error } = await supabase.from('program_waitlist').delete().eq('id', waitlistId);

  if (error) {
    return { success: false, error: error.message };
  }

  // Reorder remaining entries (decrement positions after the removed one)
  await supabase
    .from('program_waitlist')
    .update({ position: supabase.rpc('decrement_position') })
    .eq('program_id', entry.program_id)
    .gt('position', entry.position);

  return { success: true };
}

/**
 * Remove player from waitlist by player ID
 */
export async function removePlayerFromWaitlist(
  supabase: SupabaseClient,
  programId: string,
  playerId: string
): Promise<ServiceResult<void>> {
  const { data: entry } = await supabase
    .from('program_waitlist')
    .select('id')
    .eq('program_id', programId)
    .eq('player_id', playerId)
    .single();

  if (!entry) {
    return { success: false, error: 'Player is not on the waitlist' };
  }

  return removeFromWaitlist(supabase, entry.id);
}

/**
 * Get next player to promote from waitlist
 */
export async function getNextInWaitlist(
  supabase: SupabaseClient,
  programId: string
): Promise<WaitlistEntryWithDetails | null> {
  const { data } = await supabase
    .from('program_waitlist')
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
    `
    )
    .eq('program_id', programId)
    .is('promoted_at', null) // Not already promoted
    .order('position', { ascending: true })
    .limit(1)
    .single();

  return (data as WaitlistEntryWithDetails) || null;
}

/**
 * Promote a player from waitlist (mark as promoted, set expiry)
 */
export async function promoteFromWaitlist(
  supabase: SupabaseClient,
  waitlistId: string,
  claimHours?: number
): Promise<ServiceResult<ProgramWaitlist>> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + (claimHours || DEFAULT_PROMOTION_CLAIM_HOURS));

  const { data, error } = await supabase
    .from('program_waitlist')
    .update({
      promoted_at: new Date().toISOString(),
      promotion_expires_at: expiresAt.toISOString(),
      notification_sent_at: new Date().toISOString(),
    })
    .eq('id', waitlistId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  // TODO: Send notification to the player

  return { success: true, data };
}

/**
 * Handle promotion claim (convert waitlist entry to registration)
 */
export async function claimPromotedSpot(
  supabase: SupabaseClient,
  waitlistId: string,
  registrationId: string
): Promise<ServiceResult<void>> {
  const { error } = await supabase
    .from('program_waitlist')
    .update({ registration_id: registrationId })
    .eq('id', waitlistId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Get expired promotions that need to be recycled
 */
export async function getExpiredPromotions(
  supabase: SupabaseClient
): Promise<WaitlistEntryWithDetails[]> {
  const now = new Date().toISOString();

  const { data } = await supabase
    .from('program_waitlist')
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
    `
    )
    .not('promoted_at', 'is', null)
    .is('registration_id', null) // Not claimed
    .lt('promotion_expires_at', now);

  return (data || []) as WaitlistEntryWithDetails[];
}

/**
 * Reset expired promotion (move to end of waitlist)
 */
export async function resetExpiredPromotion(
  supabase: SupabaseClient,
  waitlistId: string
): Promise<ServiceResult<void>> {
  // Get max position
  const { data: entry } = await supabase
    .from('program_waitlist')
    .select('program_id')
    .eq('id', waitlistId)
    .single();

  if (!entry) {
    return { success: false, error: 'Waitlist entry not found' };
  }

  const { data: maxPosition } = await supabase
    .from('program_waitlist')
    .select('position')
    .eq('program_id', entry.program_id)
    .order('position', { ascending: false })
    .limit(1)
    .single();

  // Reset promotion and move to end
  const { error } = await supabase
    .from('program_waitlist')
    .update({
      promoted_at: null,
      promotion_expires_at: null,
      notification_sent_at: null,
      position: (maxPosition?.position || 0) + 1,
    })
    .eq('id', waitlistId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Process waitlist after a cancellation
 */
export async function processWaitlistAfterCancellation(
  supabase: SupabaseClient,
  programId: string
): Promise<ServiceResult<{ promoted: boolean; playerId?: string }>> {
  // Get next person in waitlist
  const next = await getNextInWaitlist(supabase, programId);

  if (!next) {
    return { success: true, data: { promoted: false } };
  }

  // Promote them
  const result = await promoteFromWaitlist(supabase, next.id);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: {
      promoted: true,
      playerId: next.player_id,
    },
  };
}

/**
 * Get player's position on waitlist
 */
export async function getPlayerWaitlistPosition(
  supabase: SupabaseClient,
  programId: string,
  playerId: string
): Promise<number | null> {
  const { data } = await supabase
    .from('program_waitlist')
    .select('position')
    .eq('program_id', programId)
    .eq('player_id', playerId)
    .single();

  return data?.position || null;
}
