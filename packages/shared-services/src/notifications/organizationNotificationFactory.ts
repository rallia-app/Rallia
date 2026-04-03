/**
 * Organization Notification Factory
 * Provides type-safe builders for creating organization-context notifications.
 * Handles recipient resolution, template generation, and batch creation.
 */

import { supabase } from '../supabase';
import { createNotification, createNotifications } from './notificationFactory';
import type { CreateNotificationInput } from './notificationFactory';
import type {
  OrgNotificationTypeEnum,
  Notification,
  RoleEnum,
  DeliveryChannelEnum,
} from '@rallia/shared-types';

/**
 * Payload types for organization notifications
 */
export interface BookingNotificationPayload {
  bookingId: string;
  courtName?: string;
  facilityName?: string;
  bookingDate?: string;
  startTime?: string;
  endTime?: string;
  playerName?: string;
  playerEmail?: string;
  priceCents?: number;
  currency?: string;
}

export interface MemberNotificationPayload {
  memberId: string;
  memberName: string;
  memberEmail?: string;
  role?: RoleEnum;
  previousRole?: RoleEnum;
}

export interface PaymentNotificationPayload {
  bookingId?: string;
  paymentId?: string;
  amountCents: number;
  currency: string;
  playerName?: string;
  failureReason?: string;
}

export interface AnnouncementPayload {
  subject: string;
  message: string;
}

export interface SummaryPayload {
  periodStart: string;
  periodEnd: string;
  totalBookings?: number;
  totalRevenue?: number;
  newMembers?: number;
}

export type OrgNotificationPayload =
  | BookingNotificationPayload
  | MemberNotificationPayload
  | PaymentNotificationPayload
  | AnnouncementPayload
  | SummaryPayload
  | Record<string, unknown>;

/**
 * Input for creating an organization notification
 */
export interface CreateOrgNotificationInput {
  /** Organization ID */
  organizationId: string;
  /** Type of notification */
  type: OrgNotificationTypeEnum;
  /** Optional target entity ID (booking, member, payment, etc.) */
  targetId?: string;
  /** Title override (uses template if not provided) */
  title?: string;
  /** Body override (uses template if not provided) */
  body?: string;
  /** Additional payload data */
  payload?: OrgNotificationPayload;
  /** Override recipients (uses preference-based resolution if not provided) */
  recipientUserIds?: string[];
  /** Channel to send via (defaults to preference-based) */
  channel?: DeliveryChannelEnum;
}

/**
 * Recipient information returned by get_org_notification_recipients
 */
interface OrgRecipient {
  user_id: string;
  email: string;
  full_name: string | null;
}

/**
 * Default titles for organization notification types
 */
const ORG_TITLE_TEMPLATES: Record<OrgNotificationTypeEnum, string> = {
  // Staff notifications
  booking_created: 'New Booking',
  booking_cancelled_by_player: 'Booking Cancelled',
  booking_modified: 'Booking Modified',
  new_member_joined: 'New Member',
  member_left: 'Member Left',
  member_role_changed: 'Role Changed',
  payment_received: 'Payment Received',
  payment_failed: 'Payment Failed',
  refund_processed: 'Refund Processed',
  daily_summary: 'Daily Summary',
  weekly_report: 'Weekly Report',
  // Member notifications
  booking_confirmed: 'Booking Confirmed',
  booking_reminder: 'Booking Reminder',
  booking_cancelled_by_org: 'Booking Cancelled',
  membership_approved: 'Welcome!',
  org_announcement: 'Announcement',
  // Program notifications
  program_registration_confirmed: 'Registration Confirmed',
  program_registration_cancelled: 'Registration Cancelled',
  program_session_reminder: 'Session Reminder',
  program_session_cancelled: 'Session Cancelled',
  program_waitlist_promoted: 'Waitlist Promoted',
  program_payment_due: 'Payment Due',
  program_payment_received: 'Payment Received',
};

/**
 * Default body templates for organization notification types
 */
const ORG_BODY_TEMPLATES: Record<OrgNotificationTypeEnum, string> = {
  // Staff notifications
  booking_created: '{playerName} booked {courtName} on {bookingDate} at {startTime}',
  booking_cancelled_by_player:
    '{playerName} cancelled their booking for {courtName} on {bookingDate}',
  booking_modified: '{playerName} modified their booking for {courtName} on {bookingDate}',
  new_member_joined: '{memberName} joined your organization',
  member_left: '{memberName} left your organization',
  member_role_changed: "{memberName}'s role changed from {previousRole} to {role}",
  payment_received: 'Payment of {amountCents} {currency} received from {playerName}',
  payment_failed: 'Payment from {playerName} failed: {failureReason}',
  refund_processed: 'Refund of {amountCents} {currency} processed for {playerName}',
  daily_summary: 'Summary for {periodStart}: {totalBookings} bookings, {newMembers} new members',
  weekly_report:
    'Weekly report ({periodStart} - {periodEnd}): {totalBookings} bookings, ${totalRevenue} revenue',
  // Member notifications
  booking_confirmed: 'Your booking for {courtName} on {bookingDate} at {startTime} is confirmed',
  booking_reminder: 'Reminder: Your booking for {courtName} is {bookingDate} at {startTime}',
  booking_cancelled_by_org: 'Your booking for {courtName} on {bookingDate} has been cancelled',
  membership_approved: 'Your membership has been approved. Welcome to the team!',
  org_announcement: '{message}',
  // Program notifications
  program_registration_confirmed:
    '{playerName} has been confirmed for {programName}. Session starts {sessionDate}.',
  program_registration_cancelled:
    '{playerName} has cancelled their registration for {programName}.',
  program_session_reminder:
    'Reminder: {programName} session is {sessionDate} at {startTime}. {registeredCount} participants registered.',
  program_session_cancelled:
    'The {programName} session on {sessionDate} has been cancelled. All registered participants have been notified.',
  program_waitlist_promoted:
    '{playerName} has been promoted from the waitlist and is now registered for {programName}.',
  program_payment_due:
    'Payment for {programName} is due from {playerName}. Amount: {amountCents} {currency}.',
  program_payment_received:
    'Payment received from {playerName} for {programName}. Amount: {amountCents} {currency}.',
};

/**
 * Interpolate template variables with payload values
 */
function interpolateTemplate(template: string, payload?: OrgNotificationPayload): string {
  if (!payload) return template;

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = (payload as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== '') {
      // Format currency amounts
      if (key === 'amountCents' && typeof value === 'number') {
        return (value / 100).toFixed(2);
      }
      return String(value);
    }
    return '';
  });
}

/**
 * Get recipients for an organization notification using the database function
 */
async function getOrgRecipients(
  organizationId: string,
  notificationType: OrgNotificationTypeEnum,
  channel: DeliveryChannelEnum = 'email'
): Promise<OrgRecipient[]> {
  const { data, error } = await supabase.rpc('get_org_notification_recipients', {
    p_organization_id: organizationId,
    p_notification_type: notificationType,
    p_channel: channel,
  });

  if (error) {
    console.error('Failed to get org notification recipients:', error);
    return [];
  }

  return (data ?? []) as OrgRecipient[];
}

/**
 * Create a notification for organization members
 * Automatically resolves recipients based on org preferences
 */
export async function createOrgNotification(
  input: CreateOrgNotificationInput
): Promise<Notification[]> {
  const {
    organizationId,
    type,
    targetId,
    title,
    body,
    payload,
    recipientUserIds,
    channel = 'email',
  } = input;

  // Get recipients - either provided or resolved from preferences
  let userIds: string[];

  if (recipientUserIds && recipientUserIds.length > 0) {
    userIds = recipientUserIds;
  } else {
    const recipients = await getOrgRecipients(organizationId, type, channel);
    userIds = recipients.map(r => r.user_id);
  }

  if (userIds.length === 0) {
    return [];
  }

  // Generate title and body from templates if not provided
  const finalTitle = title ?? interpolateTemplate(ORG_TITLE_TEMPLATES[type], payload);
  const finalBody = body ?? interpolateTemplate(ORG_BODY_TEMPLATES[type], payload);

  // Create notifications for all recipients
  const notificationInputs: CreateNotificationInput[] = userIds.map(userId => ({
    type,
    userId,
    targetId,
    title: finalTitle,
    body: finalBody,
    payload: {
      ...(payload ?? {}),
      organizationId, // Include org context in payload
    },
    organizationId, // Set organization_id column for querying
  }));

  return createNotifications(notificationInputs);
}

/**
 * Send a notification to a specific member (e.g., booking confirmation)
 */
export async function createMemberNotification(
  organizationId: string,
  memberUserId: string,
  type: OrgNotificationTypeEnum,
  targetId?: string,
  payload?: OrgNotificationPayload
): Promise<Notification> {
  const finalTitle = interpolateTemplate(ORG_TITLE_TEMPLATES[type], payload);
  const finalBody = interpolateTemplate(ORG_BODY_TEMPLATES[type], payload);

  return createNotification({
    type,
    userId: memberUserId,
    targetId,
    title: finalTitle,
    body: finalBody,
    payload: {
      ...(payload ?? {}),
      organizationId,
    },
    organizationId, // Set organization_id column for querying
  });
}

// ============================================================================
// CONVENIENCE BUILDERS
// Type-safe helper functions for common organization notification types
// ============================================================================

/**
 * Notify staff about a new booking
 */
export async function notifyBookingCreated(
  organizationId: string,
  bookingId: string,
  payload: BookingNotificationPayload
): Promise<Notification[]> {
  return createOrgNotification({
    organizationId,
    type: 'booking_created',
    targetId: bookingId,
    payload,
  });
}

/**
 * Notify staff about a booking cancelled by player
 */
export async function notifyBookingCancelledByPlayer(
  organizationId: string,
  bookingId: string,
  payload: BookingNotificationPayload
): Promise<Notification[]> {
  return createOrgNotification({
    organizationId,
    type: 'booking_cancelled_by_player',
    targetId: bookingId,
    payload,
  });
}

/**
 * Notify a member that their booking is confirmed
 */
export async function notifyBookingConfirmed(
  organizationId: string,
  memberUserId: string,
  bookingId: string,
  payload: BookingNotificationPayload
): Promise<Notification> {
  return createMemberNotification(
    organizationId,
    memberUserId,
    'booking_confirmed',
    bookingId,
    payload
  );
}

/**
 * Notify a member about their upcoming booking
 */
export async function notifyBookingReminder(
  organizationId: string,
  memberUserId: string,
  bookingId: string,
  payload: BookingNotificationPayload
): Promise<Notification> {
  return createMemberNotification(
    organizationId,
    memberUserId,
    'booking_reminder',
    bookingId,
    payload
  );
}

/**
 * Notify a member that their booking was cancelled by the org
 */
export async function notifyBookingCancelledByOrg(
  organizationId: string,
  memberUserId: string,
  bookingId: string,
  payload: BookingNotificationPayload
): Promise<Notification> {
  return createMemberNotification(
    organizationId,
    memberUserId,
    'booking_cancelled_by_org',
    bookingId,
    payload
  );
}

/**
 * Notify staff about a new member
 */
export async function notifyNewMemberJoined(
  organizationId: string,
  payload: MemberNotificationPayload
): Promise<Notification[]> {
  return createOrgNotification({
    organizationId,
    type: 'new_member_joined',
    targetId: payload.memberId,
    payload,
  });
}

/**
 * Notify staff about a member leaving
 */
export async function notifyMemberLeft(
  organizationId: string,
  payload: MemberNotificationPayload
): Promise<Notification[]> {
  return createOrgNotification({
    organizationId,
    type: 'member_left',
    targetId: payload.memberId,
    payload,
  });
}

/**
 * Notify staff about a role change
 */
export async function notifyMemberRoleChanged(
  organizationId: string,
  payload: MemberNotificationPayload
): Promise<Notification[]> {
  return createOrgNotification({
    organizationId,
    type: 'member_role_changed',
    targetId: payload.memberId,
    payload,
  });
}

/**
 * Notify staff about a payment received
 */
export async function notifyPaymentReceived(
  organizationId: string,
  payload: PaymentNotificationPayload
): Promise<Notification[]> {
  return createOrgNotification({
    organizationId,
    type: 'payment_received',
    targetId: payload.bookingId ?? payload.paymentId,
    payload,
  });
}

/**
 * Notify staff about a failed payment
 */
export async function notifyPaymentFailed(
  organizationId: string,
  payload: PaymentNotificationPayload
): Promise<Notification[]> {
  return createOrgNotification({
    organizationId,
    type: 'payment_failed',
    targetId: payload.bookingId ?? payload.paymentId,
    payload,
  });
}

/**
 * Notify a member that their membership was approved
 */
export async function notifyMembershipApproved(
  organizationId: string,
  memberUserId: string
): Promise<Notification> {
  return createMemberNotification(organizationId, memberUserId, 'membership_approved');
}

/**
 * Send an announcement to all org members
 */
export async function sendOrgAnnouncement(
  organizationId: string,
  subject: string,
  message: string,
  recipientUserIds?: string[]
): Promise<Notification[]> {
  return createOrgNotification({
    organizationId,
    type: 'org_announcement',
    title: subject,
    payload: { subject, message },
    recipientUserIds,
  });
}

/**
 * Organization notification factory object for grouped exports
 */
export const organizationNotificationFactory = {
  // Core functions
  create: createOrgNotification,
  createForMember: createMemberNotification,

  // Booking notifications
  bookingCreated: notifyBookingCreated,
  bookingCancelledByPlayer: notifyBookingCancelledByPlayer,
  bookingConfirmed: notifyBookingConfirmed,
  bookingReminder: notifyBookingReminder,
  bookingCancelledByOrg: notifyBookingCancelledByOrg,

  // Member notifications
  newMemberJoined: notifyNewMemberJoined,
  memberLeft: notifyMemberLeft,
  memberRoleChanged: notifyMemberRoleChanged,
  membershipApproved: notifyMembershipApproved,

  // Payment notifications
  paymentReceived: notifyPaymentReceived,
  paymentFailed: notifyPaymentFailed,

  // Announcements
  announcement: sendOrgAnnouncement,
};

export default organizationNotificationFactory;
