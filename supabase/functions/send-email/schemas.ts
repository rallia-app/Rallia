import { z } from 'zod';

// Enum schemas matching Database types
const AppRoleSchema = z.enum(['player', 'organization_member', 'admin']);
const AdminRoleSchema = z.enum(['super_admin', 'moderator', 'support']);
const NotificationTypeSchema = z.enum([
  'match_invitation',
  'reminder',
  'payment',
  'support',
  'chat',
  'system',
]);
const InviteSourceSchema = z.enum([
  'manual',
  'auto_match',
  'invite_list',
  'mailing_list',
  'growth_prompt',
]);
const InviteStatusSchema = z.enum([
  'pending',
  'sent',
  'accepted',
  'expired',
  'bounced',
  'cancelled',
]);

// Invitation record schema (what comes from Supabase trigger)
export const InvitationRecordSchema = z
  .object({
    emailType: z.literal('invitation'),
    id: z.string().uuid(),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
    token: z.string().min(1),
    source: InviteSourceSchema.nullable().optional(),
    inviter_id: z.string().uuid(),
    invited_user_id: z.string().uuid().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    role: AppRoleSchema,
    admin_role: AdminRoleSchema.nullable().optional(),
    status: InviteStatusSchema.optional(),
    expires_at: z.string(),
    accepted_at: z.string().nullable().optional(),
    revoked_at: z.string().nullable().optional(),
    revoked_by: z.string().uuid().nullable().optional(),
    revoke_reason: z.string().nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .refine(data => data.email !== null || data.phone !== null, {
    message: 'Either email or phone must be provided',
    path: ['email', 'phone'],
  });

// Notification record schema (what comes from Supabase trigger)
// IMPORTANT: The database notifications table has a "type" field (notification_type_enum).
// The trigger must rename this field to "notification_type" when sending the record,
// so it doesn't conflict with the "emailType" field used for email type discrimination.
// Expected trigger payload structure:
// {
//   emailType: "notification",  // Added by trigger for email type discrimination
//   id: "...",
//   notification_type: "match_invitation", // Database "type" field renamed by trigger
//   user_id: "...",
//   title: "...",
//   ...other fields
// }
export const NotificationRecordSchema = z.object({
  emailType: z.literal('notification'), // Email type discriminator (added by trigger)
  id: z.string().uuid(),
  notification_type: NotificationTypeSchema, // Database "type" field (must be renamed by trigger)
  target_id: z.string().uuid().nullable(),
  user_id: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().nullable(),
  payload: z.record(z.unknown()).nullable(),
  read_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Match interest record schema (from match_interest trigger)
export const MatchInterestRecordSchema = z.object({
  emailType: z.literal('match_interest'),
  id: z.number(),
  match_id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  created_at: z.string(),
});

// Union schema for all email types (raw records from triggers)
// Using z.union() instead of z.discriminatedUnion() because InvitationRecordSchema
// uses .refine() which wraps it in ZodEffects
export const EmailRequestSchema = z.union([
  InvitationRecordSchema,
  NotificationRecordSchema,
  MatchInterestRecordSchema,
]);
