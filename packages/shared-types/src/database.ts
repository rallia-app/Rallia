/**
 * Database Types - Derived from Supabase Generated Types
 *
 * This file provides convenient type aliases and composite types
 * built from the auto-generated supabase.ts file.
 *
 * DO NOT manually define database row types here - they should be
 * derived from the Database type in supabase.ts
 *
 * NOTE: All tables use SINGULAR naming convention (profile, player, sport, etc.)
 */

import type { Database } from './supabase';

// ============================================
// HELPER TYPES
// ============================================

/** Helper to extract Row type from a table */
type TableRow<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

/** Helper to extract Insert type from a table */
type TableInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

/** Helper to extract Update type from a table */
type TableUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

/** Helper to extract Enum type */
type DbEnum<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];

// ============================================
// ENUM TYPES (Aligned with consolidated schema)
// ============================================

// Admin & User Roles
export type AdminRoleEnum = DbEnum<'admin_role_enum'>;
export type AppRoleEnum = DbEnum<'app_role_enum'>;
export type RoleEnum = DbEnum<'role_enum'>;

// Player
export type GenderEnum = DbEnum<'gender_enum'>;
export type PlayingHandEnum = DbEnum<'playing_hand_enum'>;

// Match
export type MatchDurationEnum = DbEnum<'match_duration_enum'>;
export type MatchTypeEnum = DbEnum<'match_type_enum'>;

// Match Creation (enums for match wizard)
export type MatchFormatEnum = DbEnum<'match_format_enum'>;
export type CourtStatusEnum = DbEnum<'court_status_enum'>;
export type MatchVisibilityEnum = DbEnum<'match_visibility_enum'>;
export type MatchJoinModeEnum = DbEnum<'match_join_mode_enum'>;
export type CostSplitTypeEnum = DbEnum<'cost_split_type_enum'>;
export type LocationTypeEnum = DbEnum<'location_type_enum'>;

// Match Feedback (enums for feedback wizard)
export type MatchOutcomeEnum = DbEnum<'match_outcome_enum'>;
// Note: cancellation_reason_enum will be available after running migration and regenerating types
// Until then, use this manual type definition:
export type CancellationReasonEnum = 'weather' | 'court_unavailable' | 'emergency' | 'other';

// Match Report (enums for moderation)
export type MatchReportReasonEnum = DbEnum<'match_report_reason_enum'>;
export type MatchReportPriorityEnum = DbEnum<'match_report_priority_enum'>;
export type MatchReportStatusEnum = DbEnum<'match_report_status_enum'>;

// Organization & Facility
export type OrganizationTypeEnum = DbEnum<'organization_type_enum'>;
export type OrganizationNatureEnum = DbEnum<'organization_nature_enum'>;
export type FacilityTypeEnum = DbEnum<'facility_type_enum'>;
export type FacilityContactTypeEnum = DbEnum<'facility_contact_type_enum'>;

// Court
export type SurfaceTypeEnum = DbEnum<'surface_type_enum'>;
export type AvailabilityEnum = DbEnum<'availability_enum'>;

// Time & Schedule
export type DayEnum = DbEnum<'day_enum'>;
export type PeriodEnum = DbEnum<'period_enum'>;

// Rating
export type RatingCertificationMethodEnum = DbEnum<'rating_certification_method_enum'>;
export type RatingRequestStatusEnum = DbEnum<'rating_request_status_enum'>;

// Rating System Code
export type RatingSystemCodeEnum = DbEnum<'rating_system_code_enum'>;

// Files & Proofs
export type FileTypeEnum = DbEnum<'file_type_enum'>;
export type ProofTypeEnum = DbEnum<'proof_type_enum'>;
export type ProofStatusEnum = DbEnum<'proof_status_enum'>;

// Notification & Delivery
export type NotificationTypeEnum = DbEnum<'notification_type_enum'>;
export type DeliveryChannelEnum = DbEnum<'delivery_channel_enum'>;
export type DeliveryStatusEnum = DbEnum<'delivery_status_enum'>;

// Extended notification types (added by migration, available after supabase types regeneration)
// These are the full set of notification types supported by the system
export type ExtendedNotificationTypeEnum =
  | NotificationTypeEnum
  | 'match_join_request'
  | 'match_join_accepted'
  | 'match_join_rejected'
  | 'match_player_joined'
  | 'match_cancelled'
  | 'match_updated'
  | 'match_starting_soon'
  | 'match_completed'
  | 'match_new_available'
  | 'player_kicked'
  | 'player_left'
  | 'new_message'
  | 'friend_request'
  | 'rating_verified'
  | 'feedback_request'
  | 'feedback_reminder'
  | 'score_confirmation'
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
  // Program notifications
  | 'program_registration_confirmed'
  | 'program_registration_cancelled'
  | 'program_session_reminder'
  | 'program_session_cancelled'
  | 'program_waitlist_promoted'
  | 'program_payment_due'
  | 'program_payment_received';

// Organization notification types (subset for org-specific features)
export type OrgNotificationTypeEnum =
  // Staff notifications
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
  // Member notifications
  | 'booking_confirmed'
  | 'booking_reminder'
  | 'booking_cancelled_by_org'
  | 'membership_approved'
  | 'org_announcement'
  // Program notifications (staff)
  | 'program_registration_confirmed'
  | 'program_registration_cancelled'
  | 'program_session_reminder'
  | 'program_session_cancelled'
  | 'program_waitlist_promoted'
  | 'program_payment_due'
  | 'program_payment_received';

// Extended delivery status (added by migration)
export type ExtendedDeliveryStatusEnum =
  | DeliveryStatusEnum
  | 'skipped_preference'
  | 'skipped_missing_contact';

// Notification priority (added by migration)
export type NotificationPriorityEnum = 'low' | 'normal' | 'high' | 'urgent';

// Invitations
export type InviteSourceEnum = DbEnum<'invite_source_enum'>;
export type InviteStatusEnum = DbEnum<'invite_status_enum'>;

// Location
export type CountryEnum = DbEnum<'country_enum'>;

// Play Style & Attributes
export type PlayStyleEnum = DbEnum<'play_style_enum'>;
export type PlayAttributeEnum = DbEnum<'play_attribute_enum'>;

// Skill Level
export type SkillLevel = DbEnum<'skill_level'>;

// Programs & Lessons (added by migration, available after supabase types regeneration)
// Manual type definitions until types are regenerated
export type ProgramTypeEnum = 'program' | 'lesson';
export type ProgramStatusEnum = 'draft' | 'published' | 'cancelled' | 'completed';
export type RegistrationStatusEnum = 'pending' | 'confirmed' | 'cancelled' | 'refunded';
export type PaymentPlanEnum = 'full' | 'installment';
export type RegistrationPaymentStatusEnum =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'cancelled';
export type BookingTypeEnum = 'player' | 'program_session' | 'maintenance';

// Match (non-suffixed variants)
export type MatchType = DbEnum<'match_type_enum'>;
export type MatchDuration = DbEnum<'match_duration_enum'>;

// Time & Schedule (non-suffixed variants)
export type DayOfWeek = DbEnum<'day_of_week'>;
export type TimePeriod = DbEnum<'time_period'>;

// Court (non-suffixed variants)
export type CourtSurface = DbEnum<'court_surface'>;
export type CourtType = DbEnum<'court_type'>;

// ============================================
// TABLE ROW TYPES (All Singular)
// ============================================

// User & Profile
export type Profile = TableRow<'profile'>;
export type Player = TableRow<'player'>;
export type Admin = TableRow<'admin'>;

// Sport
export type Sport = TableRow<'sport'>;
export type PlayStyle = TableRow<'play_style'>;
export type PlayAttribute = TableRow<'play_attribute'>;

// Player Sport (links players to sports with preferences)
export type PlayerSport = TableRow<'player_sport'>;

// Rating System (replaces rating)
export type RatingSystem = TableRow<'rating_system'>;
export type RatingScore = TableRow<'rating_score'>;
export type PlayerRatingScore = TableRow<'player_rating_score'>;
export type RatingProof = TableRow<'rating_proof'>;
export type RatingReferenceRequest = TableRow<'rating_reference_request'>;
export type PeerRatingRequest = TableRow<'peer_rating_request'>;

// Availability
export type PlayerAvailability = TableRow<'player_availability'>;

// Organization & Facility
export type Organization = TableRow<'organization'>;
export type OrganizationMember = TableRow<'organization_member'>;
export type Facility = TableRow<'facility'>;
export type FacilityContact = TableRow<'facility_contact'>;
export type FacilityImage = TableRow<'facility_image'>;
export type FacilitySport = TableRow<'facility_sport'>;
export type FacilityFile = TableRow<'facility_file'>;

// Court
export type Court = TableRow<'court'>;
export type CourtSport = TableRow<'court_sport'>;

// Programs & Lessons (manual definitions until supabase types regenerated)
export interface InstructorProfile {
  id: string;
  organization_id: string;
  organization_member_id: string | null;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  hourly_rate_cents: number | null;
  currency: string;
  certifications: Record<string, unknown>[];
  specializations: string[];
  is_external: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Program {
  id: string;
  organization_id: string;
  facility_id: string | null;
  sport_id: string | null;
  type: ProgramTypeEnum;
  status: ProgramStatusEnum;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  registration_opens_at: string | null;
  registration_deadline: string | null;
  min_participants: number;
  max_participants: number | null;
  current_participants: number;
  price_cents: number;
  currency: string;
  allow_installments: boolean;
  installment_count: number;
  deposit_cents: number | null;
  auto_block_courts: boolean;
  waitlist_enabled: boolean;
  waitlist_limit: number | null;
  age_min: number | null;
  age_max: number | null;
  skill_level_min: string | null;
  skill_level_max: string | null;
  cancellation_policy: ProgramCancellationPolicy;
  cover_image_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  cancelled_at: string | null;
}

export interface ProgramCancellationPolicy {
  full_refund_days_before_start: number;
  partial_refund_days_before_start: number;
  partial_refund_percent: number;
  no_refund_after_start: boolean;
  prorate_by_sessions_attended: boolean;
}

export interface ProgramSession {
  id: string;
  program_id: string;
  date: string;
  start_time: string;
  end_time: string;
  location_override: string | null;
  notes: string | null;
  is_cancelled: boolean;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramSessionCourt {
  id: string;
  session_id: string;
  court_id: string;
  booking_id: string | null;
  created_at: string;
}

export interface ProgramInstructor {
  id: string;
  program_id: string;
  instructor_id: string;
  is_primary: boolean;
  created_at: string;
}

export interface ProgramRegistration {
  id: string;
  program_id: string;
  player_id: string;
  registered_by: string;
  status: RegistrationStatusEnum;
  payment_plan: PaymentPlanEnum;
  total_amount_cents: number;
  paid_amount_cents: number;
  refund_amount_cents: number;
  currency: string;
  stripe_customer_id: string | null;
  notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  registered_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegistrationPayment {
  id: string;
  registration_id: string;
  amount_cents: number;
  currency: string;
  installment_number: number;
  total_installments: number;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  stripe_charge_id: string | null;
  status: RegistrationPaymentStatusEnum;
  due_date: string;
  paid_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  refund_amount_cents: number;
  refunded_at: string | null;
  retry_count: number;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramWaitlist {
  id: string;
  program_id: string;
  player_id: string;
  added_by: string;
  position: number;
  promoted_at: string | null;
  promotion_expires_at: string | null;
  registration_id: string | null;
  notification_sent_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionAttendance {
  id: string;
  session_id: string;
  registration_id: string;
  attended: boolean | null;
  marked_at: string | null;
  marked_by: string | null;
  notes: string | null;
  created_at: string;
}

// Match
export type Match = TableRow<'match'>;
export type MatchParticipant = TableRow<'match_participant'>;
export type MatchResult = TableRow<'match_result'>;
export type MatchSet = TableRow<'match_set'>;
export type MatchFeedback = TableRow<'match_feedback'>;
export type MatchReport = TableRow<'match_report'>;

/** Match result with nested set scores (from getMatchWithDetails when result is selected with sets) */
export interface MatchResultWithSets extends MatchResult {
  sets?: MatchSet[];
}

// Notification
export type Notification = TableRow<'notification'>;
export type DeliveryAttempt = TableRow<'delivery_attempt'>;

// Notification Preference (manual definition until supabase types regenerated)
// This table stores user preferences for notification delivery per type/channel
export interface NotificationPreference {
  id: string;
  user_id: string;
  notification_type: ExtendedNotificationTypeEnum;
  channel: DeliveryChannelEnum;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreferenceInsert {
  id?: string;
  user_id: string;
  notification_type: ExtendedNotificationTypeEnum;
  channel: DeliveryChannelEnum;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface NotificationPreferenceUpdate {
  id?: string;
  user_id?: string;
  notification_type?: ExtendedNotificationTypeEnum;
  channel?: DeliveryChannelEnum;
  enabled?: boolean;
  updated_at?: string;
}

// Organization Notification Preference (manual definition until supabase types regenerated)
export interface OrganizationNotificationPreference {
  id: string;
  organization_id: string;
  notification_type: ExtendedNotificationTypeEnum;
  channel: DeliveryChannelEnum;
  enabled: boolean;
  recipient_roles: RoleEnum[] | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationNotificationPreferenceInsert {
  id?: string;
  organization_id: string;
  notification_type: ExtendedNotificationTypeEnum;
  channel: DeliveryChannelEnum;
  enabled?: boolean;
  recipient_roles?: RoleEnum[] | null;
  created_at?: string;
  updated_at?: string;
}

export interface OrganizationNotificationPreferenceUpdate {
  id?: string;
  organization_id?: string;
  notification_type?: ExtendedNotificationTypeEnum;
  channel?: DeliveryChannelEnum;
  enabled?: boolean;
  recipient_roles?: RoleEnum[] | null;
  updated_at?: string;
}

// Organization Notification Recipient (manual definition until supabase types regenerated)
export interface OrganizationNotificationRecipient {
  id: string;
  organization_id: string;
  notification_type: ExtendedNotificationTypeEnum;
  user_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationNotificationRecipientInsert {
  id?: string;
  organization_id: string;
  notification_type: ExtendedNotificationTypeEnum;
  user_id: string;
  enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface OrganizationNotificationRecipientUpdate {
  id?: string;
  organization_id?: string;
  notification_type?: ExtendedNotificationTypeEnum;
  user_id?: string;
  enabled?: boolean;
  updated_at?: string;
}

// Files
export type File = TableRow<'file'>;

// Invitation
export type Invitation = TableRow<'invitation'>;

// Waitlist
export type WaitlistSignup = TableRow<'waitlist_signup'>;

// ============================================
// INSERT TYPES
// ============================================

export type ProfileInsert = TableInsert<'profile'>;
export type PlayerInsert = TableInsert<'player'>;
export type AdminInsert = TableInsert<'admin'>;
export type SportInsert = TableInsert<'sport'>;
export type PlayStyleInsert = TableInsert<'play_style'>;
export type PlayAttributeInsert = TableInsert<'play_attribute'>;
export type PlayerSportInsert = TableInsert<'player_sport'>;
export type RatingSystemInsert = TableInsert<'rating_system'>;
export type RatingScoreInsert = TableInsert<'rating_score'>;
export type PlayerRatingScoreInsert = TableInsert<'player_rating_score'>;
export type RatingProofInsert = TableInsert<'rating_proof'>;
export type RatingReferenceRequestInsert = TableInsert<'rating_reference_request'>;
export type PeerRatingRequestInsert = TableInsert<'peer_rating_request'>;
export type PlayerAvailabilityInsert = TableInsert<'player_availability'>;
export type OrganizationInsert = TableInsert<'organization'>;
export type OrganizationMemberInsert = TableInsert<'organization_member'>;
export type FacilityInsert = TableInsert<'facility'>;
export type FacilityContactInsert = TableInsert<'facility_contact'>;
export type FacilityImageInsert = TableInsert<'facility_image'>;
export type FacilitySportInsert = TableInsert<'facility_sport'>;
export type FacilityFileInsert = TableInsert<'facility_file'>;
export type CourtInsert = TableInsert<'court'>;
export type CourtSportInsert = TableInsert<'court_sport'>;
export type MatchInsert = TableInsert<'match'>;
export type MatchParticipantInsert = TableInsert<'match_participant'>;
export type MatchResultInsert = TableInsert<'match_result'>;
export type MatchFeedbackInsert = TableInsert<'match_feedback'>;
export type MatchReportInsert = TableInsert<'match_report'>;
export type NotificationInsert = TableInsert<'notification'>;
export type DeliveryAttemptInsert = TableInsert<'delivery_attempt'>;
export type FileInsert = TableInsert<'file'>;
export type InvitationInsert = TableInsert<'invitation'>;
export type WaitlistSignupInsert = TableInsert<'waitlist_signup'>;

// ============================================
// UPDATE TYPES
// ============================================

export type ProfileUpdate = TableUpdate<'profile'>;
export type PlayerUpdate = TableUpdate<'player'>;
export type AdminUpdate = TableUpdate<'admin'>;
export type SportUpdate = TableUpdate<'sport'>;
export type PlayStyleUpdate = TableUpdate<'play_style'>;
export type PlayAttributeUpdate = TableUpdate<'play_attribute'>;
export type PlayerSportUpdate = TableUpdate<'player_sport'>;
export type RatingSystemUpdate = TableUpdate<'rating_system'>;
export type RatingScoreUpdate = TableUpdate<'rating_score'>;
export type PlayerRatingScoreUpdate = TableUpdate<'player_rating_score'>;
export type RatingProofUpdate = TableUpdate<'rating_proof'>;
export type RatingReferenceRequestUpdate = TableUpdate<'rating_reference_request'>;
export type PeerRatingRequestUpdate = TableUpdate<'peer_rating_request'>;
export type PlayerAvailabilityUpdate = TableUpdate<'player_availability'>;
export type OrganizationUpdate = TableUpdate<'organization'>;
export type OrganizationMemberUpdate = TableUpdate<'organization_member'>;
export type FacilityUpdate = TableUpdate<'facility'>;
export type FacilityContactUpdate = TableUpdate<'facility_contact'>;
export type FacilityImageUpdate = TableUpdate<'facility_image'>;
export type FacilitySportUpdate = TableUpdate<'facility_sport'>;
export type FacilityFileUpdate = TableUpdate<'facility_file'>;
export type CourtUpdate = TableUpdate<'court'>;
export type CourtSportUpdate = TableUpdate<'court_sport'>;
export type MatchUpdate = TableUpdate<'match'>;
export type MatchParticipantUpdate = TableUpdate<'match_participant'>;
export type MatchResultUpdate = TableUpdate<'match_result'>;
export type MatchFeedbackUpdate = TableUpdate<'match_feedback'>;
export type MatchReportUpdate = TableUpdate<'match_report'>;
export type NotificationUpdate = TableUpdate<'notification'>;
export type DeliveryAttemptUpdate = TableUpdate<'delivery_attempt'>;
export type FileUpdate = TableUpdate<'file'>;
export type InvitationUpdate = TableUpdate<'invitation'>;
export type WaitlistSignupUpdate = TableUpdate<'waitlist_signup'>;

// ============================================
// COMPOSITE TYPES (with FK relationships)
// ============================================

/** Player with their profile information */
export interface PlayerWithProfile extends Player {
  profile: Profile;
  /** Rating label for the match's sport (populated at runtime for match queries) */
  sportRatingLabel?: string;
  /** Rating numeric value for the match's sport (populated at runtime for match queries) */
  sportRatingValue?: number;
  /** Reputation data joined from player_reputation table */
  player_reputation?: { reputation_score: number } | null;
}

/** Player sport with sport details */
export interface PlayerSportWithDetails extends PlayerSport {
  sport: Sport;
}

/** Player rating score with full rating hierarchy */
export interface PlayerRatingWithDetails extends PlayerRatingScore {
  rating_score: RatingScore & {
    rating_system: RatingSystem & {
      sport: Sport;
    };
  };
}

/** Rating proof with file attachment */
export interface RatingProofWithFile extends RatingProof {
  file?: File;
}

/** Rating proof with reviewer profile */
export interface RatingProofWithReviewer extends RatingProof {
  file?: File;
  reviewed_by_profile?: {
    display_name: string | null;
    profile_picture_url: string | null;
  };
}

/** Notification with related entities */
export interface NotificationWithRelations extends Notification {
  target_player?: PlayerWithProfile;
}

/** Facility with organization and images */
export interface FacilityWithDetails extends Facility {
  organization?: Organization;
  images?: FacilityImage[];
  sports?: FacilitySport[];
}

/** Data provider configuration (e.g., Loisir Montreal) */
export interface DataProvider {
  id: string;
  name: string;
  provider_type: string;
  api_base_url: string;
  api_config: Record<string, unknown>;
  booking_url_template: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Facility search result from nearby search */
export interface FacilitySearchResult {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  distance_meters: number | null;
  /** Provider ID (resolved from facility or organization) */
  data_provider_id: string | null;
  /** Provider type for registry lookup */
  data_provider_type: string | null;
  /** Booking URL template with placeholders */
  booking_url_template: string | null;
  /** External ID used by the data provider (e.g., Loisir Montreal siteId) */
  external_provider_id: string | null;
  /** IANA timezone identifier (e.g., America/Toronto) */
  timezone: string | null;
  /** Sport IDs this facility supports (from the requested sport IDs) */
  sport_ids?: string[];
}

/** Paginated facilities response */
export interface FacilitiesPage {
  facilities: FacilitySearchResult[];
  hasMore: boolean;
  nextOffset: number | null;
  totalCount?: number; // Total number of facilities matching the search criteria
}

/** Court with facility info */
export interface CourtWithFacility extends Court {
  facility: Facility;
  sports?: CourtSport[];
}

/** Organization member with profile */
export interface OrganizationMemberWithProfile extends OrganizationMember {
  profile: Profile;
}

/**
 * Match with full details for display.
 */
export interface MatchWithDetails extends Match {
  sport: Sport;
  created_by_player: PlayerWithProfile;
  facility?: Facility;
  court?: Court;
  min_rating_score?: RatingScore;
  participants?: MatchParticipantWithPlayer[];
  result?: MatchResultWithSets;
}

/** Match participant with player and profile info */
export interface MatchParticipantWithPlayer extends MatchParticipant {
  player: PlayerWithProfile;
}

// ============================================
// ONBOARDING TYPES
// ============================================

export interface OnboardingPersonalInfo {
  first_name: string;
  last_name: string;
  display_name?: string;
  birth_date: string;
  gender: GenderEnum;
  phone?: string;
  avatar_url?: string;
  profile_picture_url?: string;
}

export interface OnboardingLocationInfo {
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface OnboardingPlayerPreferences {
  username?: string;
  playing_hand: PlayingHandEnum;
  max_travel_distance: number;
  sports: Array<{
    sport_id: string;
    sport_name: 'tennis' | 'pickleball';
    preferred_match_duration: MatchDuration;
    preferred_match_type: MatchType;
    is_primary?: boolean;
  }>;
}

export interface OnboardingRating {
  sport_id: string;
  sport_name: 'tennis' | 'pickleball';
  rating_system_code: RatingSystemCodeEnum;
  score_value: number;
  display_label: string;
}

export interface OnboardingAvailability {
  /** Day of the week (new column name) */
  day?: DayEnum;
  /** Time period (new column name) */
  period?: PeriodEnum;
  is_active: boolean;
  /** @deprecated Use 'day' instead */
  day_of_week?: DayOfWeek;
  /** @deprecated Use 'period' instead */
  time_period?: TimePeriod;
}

export interface OnboardingData {
  personal_info: OnboardingPersonalInfo;
  selected_sports: string[];
  preferences: OnboardingPlayerPreferences;
  ratings: OnboardingRating[];
  availability: OnboardingAvailability[];
}

// ============================================
// NOTIFICATION SERVICE TYPES
// ============================================

/**
 * Options for fetching paginated notifications
 */
export interface NotificationQueryOptions {
  /** Number of notifications to fetch per page */
  pageSize?: number;
  /** Cursor for pagination (created_at of last item) */
  cursor?: string;
  /** Filter by read status */
  unreadOnly?: boolean;
  /** Filter by notification type */
  type?: NotificationTypeEnum;
}

/**
 * Paginated notifications response
 */
export interface NotificationsPage {
  /** List of notifications */
  notifications: Notification[];
  /** Cursor for next page (created_at of last item) */
  nextCursor: string | null;
  /** Whether there are more notifications */
  hasMore: boolean;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

/** Request payload for creating a new rating proof */
export interface CreateRatingProofRequest {
  player_rating_score_id: string;
  proof_type: ProofTypeEnum;
  file_id?: string;
  external_url?: string;
  title: string;
  description?: string;
}

/** Request payload for updating a rating proof */
export interface UpdateRatingProofRequest {
  title?: string;
  description?: string;
  external_url?: string;
}

/** Request payload for admin review of a proof */
export interface ReviewRatingProofRequest {
  status: ProofStatusEnum;
  review_notes?: string;
}

// ============================================
// UTILITY TYPES
// ============================================

export interface DatabaseError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface DatabaseResponse<T> {
  data: T | null;
  error: DatabaseError | null;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error: DatabaseError | null;
}

// ============================================
// RE-EXPORT DATABASE TYPE FOR SUPABASE CLIENT
// ============================================

export type { Database } from './supabase';

// ============================================
// BACKWARDS COMPATIBILITY ALIASES
// (Use these during migration, then remove)
// ============================================

/** @deprecated Use PlayerSportWithDetails instead */
export type PlayerSportProfileWithDetails = PlayerSportWithDetails;
