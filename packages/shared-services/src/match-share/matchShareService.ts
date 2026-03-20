/**
 * Match Share Service
 * Handles sharing matches with external (non-app) contacts
 */

import { supabase } from '../supabase';

// ============================================================================
// TYPES
// ============================================================================

export type ShareChannel = 'sms' | 'email' | 'whatsapp' | 'share_sheet' | 'copy_link';
export type ShareStatus = 'pending' | 'sent' | 'viewed' | 'accepted' | 'expired' | 'cancelled';

export interface MatchShare {
  id: string;
  match_id: string;
  shared_by: string;
  shared_at: string;
  share_channel: ShareChannel;
  share_link_token: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchShareRecipient {
  id: string;
  share_id: string;
  contact_id: string | null;
  contact_list_id: string | null;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_email: string | null;
  status: ShareStatus;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  response_note: string | null;
  converted_player_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchShareWithRecipients extends MatchShare {
  recipients: MatchShareRecipient[];
}

export interface ShareMatchInput {
  matchId: string;
  channel: ShareChannel;
  contacts: Array<{
    contactId?: string;
    listId?: string;
    name: string;
    phone?: string;
    email?: string;
  }>;
  expiresInDays?: number; // Default 7 days
}

export interface ShareMatchResult {
  share: MatchShare;
  recipients: MatchShareRecipient[];
  shareLink: string;
  shareMessage: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique share token
 */
function generateShareToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Generate share link for a match.
 * Uses the same /match/{id} deep link format as the social share from MatchDetailSheet.
 * The optional ref param preserves the share token for per-recipient analytics.
 */
function generateShareLink(matchId: string, token?: string): string {
  const base = `https://rallia.app/match/${matchId}`;
  return token ? `${base}?ref=${token}` : base;
}

/**
 * Generate a share message for the match
 */
async function generateShareMessage(
  matchId: string,
  shareLink: string,
  senderName?: string
): Promise<string> {
  // Fetch match details including participant count
  const { data: match, error } = await supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (name),
      participants:match_participant!match_id (status)
    `
    )
    .eq('id', matchId)
    .single();

  if (error || !match) {
    return senderName
      ? `${senderName} invited you to play on Rallia!\n\n${shareLink}`
      : `You're invited to play on Rallia!\n\n${shareLink}`;
  }

  const sportName = match.sport?.name || 'game';

  // Parse date without timezone shift (YYYY-MM-DD)
  const [year, month, day] = (match.match_date as string).split('-').map(Number);
  const dateObj = new Date(year, month - 1, day);
  const matchDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const matchTime = match.start_time?.substring(0, 5) || '';
  const location = match.location_name || match.facility?.name || 'TBD';

  // Compute open spots
  const totalSlots = match.format === 'doubles' ? 4 : 2;
  const joinedCount =
    (match.participants as Array<{ status: string }> | null)?.filter(p => p.status === 'joined')
      .length ?? 0;
  const spotsLeft = Math.max(0, totalSlots - joinedCount);

  // Build message matching the social share format from shareUtils
  const inviteText = senderName
    ? `${senderName} invited you to play ${sportName}!`
    : `Join me for ${sportName}!`;

  const lines: string[] = [inviteText, '', `📅 ${matchDate} at ${matchTime}`, `📍 ${location}`];

  if (match.format) {
    const formatLabel = match.format === 'doubles' ? 'Doubles' : 'Singles';
    lines.push(`👥 ${formatLabel}`);
  }

  if (spotsLeft > 0) {
    lines.push(`🎯 ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`);
  }

  lines.push('', shareLink);

  return lines.join('\n');
}

// ============================================================================
// SERVICE FUNCTIONS
// ============================================================================

/**
 * Share a match with contacts
 */
export async function shareMatchWithContacts(input: ShareMatchInput): Promise<ShareMatchResult> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    throw new Error('User not authenticated');
  }

  const userId = userData.user.id;
  const token = generateShareToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays || 7));

  // Get sender's display name for the message
  const { data: profile } = await supabase
    .from('profile')
    .select('display_name, first_name, last_name')
    .eq('id', userId)
    .single();

  const senderName =
    (profile?.first_name && profile?.last_name
      ? `${profile.first_name} ${profile.last_name}`
      : profile?.first_name) || profile?.display_name;

  // Create the share record
  const { data: share, error: shareError } = await supabase
    .from('match_share')
    .insert({
      match_id: input.matchId,
      shared_by: userId,
      share_channel: input.channel,
      share_link_token: token,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (shareError) {
    throw new Error(`Failed to create share: ${shareError.message}`);
  }

  // Create recipient records
  const recipientInserts = input.contacts.map(contact => ({
    share_id: share.id,
    contact_id: contact.contactId || null,
    contact_list_id: contact.listId || null,
    recipient_name: contact.name,
    recipient_phone: contact.phone || null,
    recipient_email: contact.email || null,
    status: 'pending' as ShareStatus,
  }));

  const { data: recipients, error: recipientsError } = await supabase
    .from('match_share_recipient')
    .insert(recipientInserts)
    .select();

  if (recipientsError) {
    throw new Error(`Failed to create recipients: ${recipientsError.message}`);
  }

  const shareLink = generateShareLink(input.matchId, token);
  const shareMessage = await generateShareMessage(input.matchId, shareLink, senderName);

  return {
    share: share as MatchShare,
    recipients: recipients as MatchShareRecipient[],
    shareLink,
    shareMessage,
  };
}

/**
 * Get all shares for a match
 */
export async function getMatchShares(matchId: string): Promise<MatchShareWithRecipients[]> {
  const { data, error } = await supabase
    .from('match_share')
    .select(
      `
      *,
      recipients:match_share_recipient (*)
    `
    )
    .eq('match_id', matchId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get match shares: ${error.message}`);
  }

  return data as MatchShareWithRecipients[];
}

/**
 * Get all shares made by the current user
 */
export async function getUserMatchShares(): Promise<MatchShareWithRecipients[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('match_share')
    .select(
      `
      *,
      recipients:match_share_recipient (*)
    `
    )
    .eq('shared_by', userData.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get user shares: ${error.message}`);
  }

  return data as MatchShareWithRecipients[];
}

/**
 * Update recipient status (e.g., when they view or respond)
 */
export async function updateRecipientStatus(
  recipientId: string,
  status: ShareStatus,
  responseNote?: string
): Promise<MatchShareRecipient> {
  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'sent') {
    updateData.sent_at = new Date().toISOString();
  } else if (status === 'viewed') {
    updateData.viewed_at = new Date().toISOString();
  } else if (status === 'accepted' || status === 'expired' || status === 'cancelled') {
    updateData.responded_at = new Date().toISOString();
    if (responseNote) {
      updateData.response_note = responseNote;
    }
  }

  const { data, error } = await supabase
    .from('match_share_recipient')
    .update(updateData)
    .eq('id', recipientId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update recipient status: ${error.message}`);
  }

  return data as MatchShareRecipient;
}

/**
 * Mark recipients as sent (after SMS/email is sent)
 */
export async function markRecipientsAsSent(recipientIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('match_share_recipient')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', recipientIds);

  if (error) {
    throw new Error(`Failed to mark recipients as sent: ${error.message}`);
  }
}

/**
 * Cancel a share (and all its recipients)
 */
export async function cancelShare(shareId: string): Promise<void> {
  // Update all recipients to cancelled
  const { error: recipientsError } = await supabase
    .from('match_share_recipient')
    .update({
      status: 'cancelled',
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('share_id', shareId);

  if (recipientsError) {
    throw new Error(`Failed to cancel recipients: ${recipientsError.message}`);
  }

  // Delete the share record
  const { error: shareError } = await supabase.from('match_share').delete().eq('id', shareId);

  if (shareError) {
    throw new Error(`Failed to delete share: ${shareError.message}`);
  }
}

/**
 * Get share by token (for public access when recipient opens link)
 */
export async function getShareByToken(token: string): Promise<{
  share: MatchShare;
  match: unknown;
} | null> {
  const { data, error } = await supabase
    .from('match_share')
    .select(
      `
      *,
      match:match_id (
        *,
        sport:sport_id (name, icon_url),
        facility:facility_id (name, address),
        created_by_player:created_by (
          id,
          profile:id (display_name, first_name, last_name, avatar_url)
        )
      )
    `
    )
    .eq('share_link_token', token)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get share: ${error.message}`);
  }

  // Check if expired
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null; // Expired
  }

  return {
    share: data as MatchShare,
    match: data.match,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export const matchShareService = {
  shareMatchWithContacts,
  getMatchShares,
  getUserMatchShares,
  updateRecipientStatus,
  markRecipientsAsSent,
  cancelShare,
  getShareByToken,
};

export default matchShareService;
