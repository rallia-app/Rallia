// Email type definitions using Database enums
// These match the Database types from types/index.ts

export type AppRole = 'player' | 'organization_member' | 'admin';
export type AdminRole = 'super_admin' | 'moderator' | 'support';
export type NotificationType =
  | 'match_invitation'
  | 'reminder'
  | 'payment'
  | 'support'
  | 'chat'
  | 'system';

export type InviteSource =
  | 'manual'
  | 'auto_match'
  | 'invite_list'
  | 'mailing_list'
  | 'growth_prompt';

export type InviteStatus = 'pending' | 'sent' | 'accepted' | 'expired' | 'bounced' | 'cancelled';

// Email type union
export type EmailType = 'invitation' | 'notification' | 'match_interest';

// Raw database record from Supabase trigger (what we receive)
export interface InvitationRecord {
  emailType: 'invitation'; // Added by trigger to distinguish email types
  id: string;
  email: string | null;
  phone: string | null;
  token: string;
  source?: InviteSource | null;
  inviter_id: string;
  invited_user_id?: string | null;
  organization_id?: string | null;
  role: AppRole;
  admin_role?: AdminRole | null;
  status?: InviteStatus;
  expires_at: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
  revoked_by?: string | null;
  revoke_reason?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

// Raw database record from Supabase trigger (what we receive)
// Note: The database record has a "notification_type" field for notification_type_enum
// The trigger adds "emailType" field to distinguish email types ("invitation" vs "notification")
export interface NotificationRecord {
  emailType: 'notification'; // Added by trigger to distinguish email types
  id: string;
  notification_type: NotificationType; // Database field: notification_type_enum (renamed to avoid conflict)
  target_id: string | null;
  user_id: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// Processed payload for email rendering (after computing missing fields)
export interface InvitationEmailPayload {
  type: 'invitation';
  email: string;
  role: AppRole;
  adminRole?: AdminRole;
  signUpUrl: string;
  inviterName: string;
  expiresAt: string;
  organizationName?: string;
  orgRole?: string;
}

// Processed payload for email rendering (after computing missing fields)
export interface NotificationEmailPayload {
  type: 'notification';
  email: string;
  notificationType: NotificationType;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
}

// Raw record from match_interest trigger
export interface MatchInterestRecord {
  emailType: 'match_interest';
  id: number;
  match_id: string;
  email: string;
  name: string | null;
  created_at: string;
}

// Processed payload for match interest email rendering
export interface MatchInterestEmailPayload {
  type: 'match_interest';
  email: string;
  name: string | null;
  sportName: string;
  matchDate: string;
  matchTime: string;
  location: string;
  matchUrl: string;
}

// Discriminated union for all email requests (raw records from triggers)
export type EmailRequest = InvitationRecord | NotificationRecord | MatchInterestRecord;

// Email response types
export interface EmailSuccessResponse {
  success: true;
  id?: string;
  message?: string;
}

export interface EmailErrorResponse {
  success: false;
  error: string;
}

export type EmailResponse = EmailSuccessResponse | EmailErrorResponse;

// Email content (subject + HTML)
export interface EmailContent {
  subject: string;
  html: string;
}
