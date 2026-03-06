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

// Match Participant
export type MatchParticipantStatusEnum = DbEnum<'match_participant_status_enum'>;

// Match Feedback (enums for feedback wizard)
export type MatchOutcomeEnum = DbEnum<'match_outcome_enum'>;
export type CancellationReasonEnum = DbEnum<'cancellation_reason_enum'>;

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
export type BadgeStatusEnum = DbEnum<'badge_status_enum'>;

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

// All notification types are now in the DB enum — keep alias for backwards compat
/** @deprecated Use NotificationTypeEnum directly — all values are now in the DB enum */
export type ExtendedNotificationTypeEnum = NotificationTypeEnum;

// Organization notification types (subset for org-specific features)
export type OrgNotificationTypeEnum = Extract<
  NotificationTypeEnum,
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
  | 'org_announcement'
  | 'program_registration_confirmed'
  | 'program_registration_cancelled'
  | 'program_session_reminder'
  | 'program_session_cancelled'
  | 'program_waitlist_promoted'
  | 'program_payment_due'
  | 'program_payment_received'
>;

// Delivery status — all values now in DB enum
/** @deprecated Use DeliveryStatusEnum directly */
export type ExtendedDeliveryStatusEnum = DeliveryStatusEnum;

// Notification priority
export type NotificationPriorityEnum = DbEnum<'notification_priority_enum'>;

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

// Programs & Lessons
export type ProgramTypeEnum = DbEnum<'program_type_enum'>;
export type ProgramStatusEnum = DbEnum<'program_status_enum'>;
export type RegistrationStatusEnum = DbEnum<'registration_status_enum'>;
export type PaymentPlanEnum = DbEnum<'payment_plan_enum'>;
export type RegistrationPaymentStatusEnum = DbEnum<'registration_payment_status_enum'>;
export type BookingTypeEnum = DbEnum<'booking_type_enum'>;

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

// Programs & Lessons
export type InstructorProfile = TableRow<'instructor_profile'>;
export type Program = TableRow<'program'>;
export type ProgramSession = TableRow<'program_session'>;
export type ProgramSessionCourt = TableRow<'program_session_court'>;
export type ProgramInstructor = TableRow<'program_instructor'>;
export type ProgramRegistration = TableRow<'program_registration'>;
export type RegistrationPayment = TableRow<'registration_payment'>;
export type ProgramWaitlist = TableRow<'program_waitlist'>;
export type SessionAttendance = TableRow<'session_attendance'>;

/** Typed JSON shape for Program.cancellation_policy */
export interface ProgramCancellationPolicy {
  full_refund_days_before_start: number;
  partial_refund_days_before_start: number;
  partial_refund_percent: number;
  no_refund_after_start: boolean;
  prorate_by_sessions_attended: boolean;
}

// Match
export type Match = TableRow<'match'>;
export type MatchParticipant = TableRow<'match_participant'>;
export type MatchResult = TableRow<'match_result'>;
export type MatchSet = TableRow<'match_set'>;
export type MatchFeedback = TableRow<'match_feedback'>;
export type MatchReport = TableRow<'match_report'>;

/** Match result with nested set scores and confirmations (from getMatchWithDetails) */
export interface MatchResultWithSets extends MatchResult {
  sets?: MatchSet[];
  confirmations?: Array<{ player_id: string; action: 'confirmed' | 'disputed' }>;
}

// Notification
export type Notification = TableRow<'notification'>;
export type DeliveryAttempt = TableRow<'delivery_attempt'>;

// Notification Preference
export type NotificationPreference = TableRow<'notification_preference'>;
export type NotificationPreferenceInsert = TableInsert<'notification_preference'>;
export type NotificationPreferenceUpdate = TableUpdate<'notification_preference'>;

// Organization Notification Preference
export type OrganizationNotificationPreference = TableRow<'organization_notification_preference'>;
export type OrganizationNotificationPreferenceInsert =
  TableInsert<'organization_notification_preference'>;
export type OrganizationNotificationPreferenceUpdate =
  TableUpdate<'organization_notification_preference'>;

// Organization Notification Recipient
export type OrganizationNotificationRecipient = TableRow<'organization_notification_recipient'>;
export type OrganizationNotificationRecipientInsert =
  TableInsert<'organization_notification_recipient'>;
export type OrganizationNotificationRecipientUpdate =
  TableUpdate<'organization_notification_recipient'>;

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
export type InstructorProfileInsert = TableInsert<'instructor_profile'>;
export type ProgramInsert = TableInsert<'program'>;
export type ProgramSessionInsert = TableInsert<'program_session'>;
export type ProgramSessionCourtInsert = TableInsert<'program_session_court'>;
export type ProgramInstructorInsert = TableInsert<'program_instructor'>;
export type ProgramRegistrationInsert = TableInsert<'program_registration'>;
export type RegistrationPaymentInsert = TableInsert<'registration_payment'>;
export type ProgramWaitlistInsert = TableInsert<'program_waitlist'>;
export type SessionAttendanceInsert = TableInsert<'session_attendance'>;

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
export type InstructorProfileUpdate = TableUpdate<'instructor_profile'>;
export type ProgramUpdate = TableUpdate<'program'>;
export type ProgramSessionUpdate = TableUpdate<'program_session'>;
export type ProgramSessionCourtUpdate = TableUpdate<'program_session_court'>;
export type ProgramInstructorUpdate = TableUpdate<'program_instructor'>;
export type ProgramRegistrationUpdate = TableUpdate<'program_registration'>;
export type RegistrationPaymentUpdate = TableUpdate<'registration_payment'>;
export type ProgramWaitlistUpdate = TableUpdate<'program_waitlist'>;
export type SessionAttendanceUpdate = TableUpdate<'session_attendance'>;

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
  /** Certification status for the match's sport rating (populated at runtime for match queries) */
  sportCertificationStatus?: BadgeStatusEnum;
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
export type DataProvider = TableRow<'data_provider'>;

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
  /** Whether this facility is first-come-first-serve (no reservation needed) */
  is_first_come_first_serve?: boolean;
  /** Whether this facility requires a membership to access */
  membership_required?: boolean;
  /** Number of active courts for the requested sport(s) */
  court_count?: number;
  /** Number of upcoming public matches at this facility for the requested sport(s) */
  upcoming_match_count?: number;
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
