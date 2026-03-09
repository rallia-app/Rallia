/**
 * Types for the send-notification Edge Function
 */

// Notification types (must match database enum)
export type NotificationType =
  | 'match_invitation'
  | 'match_join_request'
  | 'match_join_accepted'
  | 'match_join_rejected'
  | 'match_player_joined'
  | 'match_cancelled'
  | 'match_updated'
  | 'match_starting_soon'
  | 'match_check_in_available'
  | 'match_new_available'
  | 'player_kicked'
  | 'player_left'
  | 'new_message'
  | 'chat'
  | 'rating_verified'
  | 'reminder'
  | 'payment'
  | 'support'
  | 'system'
  | 'feedback_request'
  | 'feedback_reminder'
  | 'score_confirmation'
  // Community notifications
  | 'community_join_request'
  | 'community_join_accepted'
  | 'community_join_rejected'
  // Organization staff notifications
  | 'booking_created'
  | 'booking_cancelled_by_player'
  | 'booking_modified'
  | 'new_member_joined'
  | 'member_left'
  | 'member_role_changed'
  | 'payment_received'
  | 'payment_failed'
  | 'refund_processed'
  | 'daily_summary'
  | 'weekly_report'
  // Organization member notifications
  | 'booking_confirmed'
  | 'booking_reminder'
  | 'booking_cancelled_by_org'
  | 'membership_approved'
  | 'org_announcement'
  // Match discovery notifications
  | 'match_spot_opened'
  | 'nearby_match_available';

// Organization notification types (subset for org-specific handling)
export type OrgNotificationType =
  | 'booking_created'
  | 'booking_cancelled_by_player'
  | 'booking_modified'
  | 'new_member_joined'
  | 'member_left'
  | 'member_role_changed'
  | 'payment_received'
  | 'payment_failed'
  | 'refund_processed'
  | 'daily_summary'
  | 'weekly_report'
  | 'booking_confirmed'
  | 'booking_reminder'
  | 'booking_cancelled_by_org'
  | 'membership_approved'
  | 'org_announcement';

// List of organization notification types for checking
export const ORG_NOTIFICATION_TYPES: OrgNotificationType[] = [
  'booking_created',
  'booking_cancelled_by_player',
  'booking_modified',
  'new_member_joined',
  'member_left',
  'member_role_changed',
  'payment_received',
  'payment_failed',
  'refund_processed',
  'daily_summary',
  'weekly_report',
  'booking_confirmed',
  'booking_reminder',
  'booking_cancelled_by_org',
  'membership_approved',
  'org_announcement',
];

export type DeliveryChannel = 'email' | 'push' | 'sms';

export type DeliveryStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'skipped_preference'
  | 'skipped_missing_contact';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Notification record from database trigger
 */
export interface NotificationRecord {
  id: string;
  user_id: string;
  type: NotificationType;
  target_id: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  priority: NotificationPriority;
  scheduled_at: string | null;
  expires_at: string | null;
  read_at: string | null;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * User contact info for delivery
 */
export interface UserContactInfo {
  email: string | null;
  phone: string | null;
  phone_verified: boolean;
  expo_push_token: string | null;
  push_notifications_enabled: boolean;
  preferred_locale: string;
}

/**
 * Notification preference from database
 */
export interface NotificationPreference {
  notification_type: NotificationType;
  channel: DeliveryChannel;
  enabled: boolean;
}

/**
 * Delivery attempt record to insert
 */
export interface DeliveryAttemptInsert {
  notification_id: string;
  attempt_number: number;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  error_message?: string | null;
  provider_response?: Record<string, unknown> | null;
}

/**
 * Result of a delivery attempt
 */
export interface DeliveryResult {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  errorMessage?: string;
  providerResponse?: Record<string, unknown>;
}

/**
 * Default preferences for each notification type
 */
export const DEFAULT_PREFERENCES: Record<NotificationType, Record<DeliveryChannel, boolean>> = {
  match_invitation: { email: true, push: true, sms: false },
  match_join_request: { email: true, push: true, sms: false },
  match_join_accepted: { email: true, push: true, sms: false },
  match_join_rejected: { email: true, push: true, sms: false },
  match_player_joined: { email: false, push: true, sms: false },
  match_cancelled: { email: true, push: true, sms: true },
  match_updated: { email: false, push: true, sms: false },
  match_starting_soon: { email: false, push: true, sms: true },
  match_check_in_available: { email: true, push: true, sms: false },
  match_new_available: { email: false, push: true, sms: false },
  match_spot_opened: { email: false, push: true, sms: false },
  nearby_match_available: { email: false, push: true, sms: false },
  player_kicked: { email: true, push: true, sms: false },
  player_left: { email: false, push: true, sms: false },
  chat: { email: false, push: true, sms: false },
  new_message: { email: false, push: true, sms: false },
  rating_verified: { email: true, push: true, sms: false },
  reminder: { email: false, push: true, sms: false },
  payment: { email: true, push: true, sms: false },
  support: { email: true, push: false, sms: false },
  system: { email: true, push: false, sms: false },
  feedback_request: { email: true, push: true, sms: false },
  feedback_reminder: { email: true, push: true, sms: false },
  score_confirmation: { email: true, push: true, sms: false },
  // Organization staff notifications - email only by default
  booking_created: { email: true, push: false, sms: false },
  booking_cancelled_by_player: { email: true, push: false, sms: false },
  booking_modified: { email: true, push: false, sms: false },
  new_member_joined: { email: true, push: false, sms: false },
  member_left: { email: true, push: false, sms: false },
  member_role_changed: { email: true, push: false, sms: false },
  payment_received: { email: true, push: false, sms: false },
  payment_failed: { email: true, push: false, sms: true },
  refund_processed: { email: true, push: false, sms: false },
  daily_summary: { email: false, push: false, sms: false },
  weekly_report: { email: true, push: false, sms: false },
  // Organization member notifications
  booking_confirmed: { email: true, push: false, sms: false },
  booking_reminder: { email: true, push: false, sms: true },
  booking_cancelled_by_org: { email: true, push: false, sms: true },
  membership_approved: { email: true, push: false, sms: false },
  org_announcement: { email: true, push: false, sms: false },
};

/**
 * Organization info for branded emails
 */
export interface OrganizationInfo {
  id: string;
  name: string;
  email: string | null;
  website: string | null;
}

/**
 * Check if a notification type is an organization notification
 */
export function isOrgNotification(type: NotificationType): type is OrgNotificationType {
  return ORG_NOTIFICATION_TYPES.includes(type as OrgNotificationType);
}
