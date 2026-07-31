/**
 * Domain Constants - Display Labels and Mappings
 *
 * This file contains constants for display labels and human-readable
 * mappings for enum values. These are UI presentation concerns.
 */

import type {
  PlayStyleEnum,
  PlayAttributeEnum,
  SkillLevel,
  MatchType,
  MatchDuration,
  DayOfWeek,
  GenderEnum,
  CourtSurface,
  CourtType,
  ExtendedNotificationTypeEnum,
  DeliveryChannelEnum,
  NotificationPriorityEnum,
  // Match Creation enums
  MatchFormatEnum,
  CourtStatusEnum,
  MatchVisibilityEnum,
  MatchJoinModeEnum,
  CostSplitTypeEnum,
  LocationTypeEnum,
  MatchDurationEnum,
  MatchTypeEnum,
} from './database';

// ============================================
// PLAY STYLE
// ============================================

/**
 * Human-readable labels for play styles
 */
export const PLAY_STYLE_LABELS: Record<PlayStyleEnum, string> = {
  counterpuncher: 'Counterpuncher',
  aggressive_baseliner: 'Aggressive Baseliner',
  serve_and_volley: 'Serve and Volley',
  all_court: 'All Court',
};

/**
 * Descriptions for play styles
 */
export const PLAY_STYLE_DESCRIPTIONS: Record<PlayStyleEnum, string> = {
  counterpuncher: 'Defensive player who retrieves and waits for opponent errors',
  aggressive_baseliner: 'Plays from the baseline with powerful groundstrokes',
  serve_and_volley: 'Rushes the net after serving to finish points quickly',
  all_court: 'Versatile player comfortable in all areas of the court',
};

// ============================================
// PLAY ATTRIBUTES
// ============================================

/**
 * Human-readable labels for play attributes
 */
export const PLAY_ATTRIBUTE_LABELS: Record<PlayAttributeEnum, string> = {
  serve_speed_and_placement: 'Serve Speed & Placement',
  net_play: 'Net Play',
  court_coverage: 'Court Coverage',
  forehand_power: 'Forehand Power',
  shot_selection: 'Shot Selection',
  spin_control: 'Spin Control',
};

// ============================================
// SKILL LEVEL
// ============================================

/**
 * Human-readable labels for skill levels
 */
export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  professional: 'Professional',
};

/**
 * Descriptions for skill levels
 */
export const SKILL_LEVEL_DESCRIPTIONS: Record<SkillLevel, string> = {
  beginner: 'New to the sport or learning fundamentals',
  intermediate: 'Comfortable with basic strokes and strategy',
  advanced: 'Strong all-around game with competitive experience',
  professional: 'Tournament-level player with elite skills',
};

// ============================================
// MATCH TYPE
// ============================================

/**
 * Human-readable labels for match types
 */
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  casual: 'Casual',
  competitive: 'Competitive',
  both: 'Both',
};

/**
 * Descriptions for match types
 */
export const MATCH_TYPE_DESCRIPTIONS: Record<MatchType, string> = {
  casual: 'Relaxed play for fun and exercise',
  competitive: 'Serious play with score keeping',
  both: 'Open to either casual or competitive play',
};

// ============================================
// MATCH DURATION
// ============================================

/**
 * Human-readable labels for match durations (using match_duration_enum)
 * @deprecated Use MATCH_DURATION_ENUM_LABELS instead
 */
export const MATCH_DURATION_LABELS: Record<MatchDuration, string> = {
  '30': '30 Minutes',
  '60': '1 Hour',
  '90': '1.5 Hours',
  '120': '2 Hours',
  custom: 'Custom',
};

// ============================================
// DAYS OF WEEK
// ============================================

/**
 * Human-readable labels for days of week
 */
export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/**
 * Short labels for days of week
 */
export const DAY_OF_WEEK_SHORT_LABELS: Record<DayOfWeek, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

/**
 * Ordered list of days for iteration
 */
export const DAYS_OF_WEEK_ORDERED: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

// ============================================
// GENDER
// ============================================

/**
 * Ordered list of gender values for iteration (labels come from translations)
 */
export const GENDER_VALUES: GenderEnum[] = ['male', 'female', 'other'];

// ============================================
// COURT
// ============================================

/**
 * Human-readable labels for court surfaces
 */
export const COURT_SURFACE_LABELS: Record<CourtSurface, string> = {
  hard: 'Hard Court',
  clay: 'Clay Court',
  grass: 'Grass Court',
  carpet: 'Carpet',
  synthetic: 'Synthetic',
};

/**
 * Human-readable labels for court types
 */
export const COURT_TYPE_LABELS: Record<CourtType, string> = {
  indoor: 'Indoor',
  outdoor: 'Outdoor',
  covered: 'Covered',
};

// ============================================
// SPORT NAMES
// ============================================

/**
 * Supported sports in the app
 */
export type SportName = 'tennis' | 'pickleball';

/**
 * Display names for sports
 */
export const SPORT_DISPLAY_NAMES: Record<SportName, string> = {
  tennis: 'Tennis',
  pickleball: 'Pickleball',
};

// ============================================
// RATING SYSTEMS
// ============================================

/**
 * Rating system display names
 */
export const RATING_SYSTEM_NAMES = {
  ntrp: 'NTRP',
  utr: 'UTR',
  dupr: 'DUPR',
  self_assessment: 'Self Assessment',
} as const;

/**
 * Rating system full names
 */
export const RATING_SYSTEM_FULL_NAMES = {
  ntrp: 'National Tennis Rating Program',
  utr: 'Universal Tennis Rating',
  dupr: 'Dynamic Universal Pickleball Rating',
  self_assessment: 'Self Assessment',
} as const;

// ============================================
// NOTIFICATIONS
// ============================================

/**
 * Icon mapping for notification types (Ionicons names)
 */
export const NOTIFICATION_TYPE_ICONS: Record<ExtendedNotificationTypeEnum, string> = {
  // Original types
  match_invitation: 'calendar-outline',
  reminder: 'alarm-outline',
  payment: 'card-outline',
  support: 'help-circle-outline',
  chat: 'chatbubble-outline',
  system: 'information-circle-outline',
  // Match lifecycle types
  match_join_request: 'person-add-outline',
  match_join_accepted: 'checkmark-circle-outline',
  match_join_rejected: 'close-circle-outline',
  match_player_joined: 'person-add-outline',
  match_cancelled: 'calendar-clear-outline',
  match_updated: 'create-outline',
  match_starting_soon: 'time-outline',
  match_check_in_available: 'checkmark-circle-outline',
  match_new_available: 'add-circle-outline',
  match_spot_opened: 'enter-outline',
  nearby_match_available: 'location-outline',
  match_completed: 'trophy-outline',
  player_kicked: 'remove-circle-outline',
  player_left: 'exit-outline',
  // Social types
  new_message: 'chatbubble-ellipses-outline',
  friend_request: 'person-add-outline',
  rating_verified: 'ribbon-outline',
  // Community types
  community_join_request: 'people-outline',
  community_join_accepted: 'checkmark-circle-outline',
  community_join_rejected: 'close-circle-outline',
  network_deleted: 'trash-outline',
  // Reference request types
  reference_request_received: 'person-circle-outline',
  reference_request_accepted: 'checkmark-circle-outline',
  reference_request_declined: 'close-circle-outline',
  // Feedback types
  feedback_request: 'star-outline',
  feedback_reminder: 'notifications-outline',
  score_confirmation: 'checkmark-done-outline',
  // Organization staff notifications
  booking_created: 'calendar-outline',
  booking_cancelled_by_player: 'calendar-clear-outline',
  booking_modified: 'create-outline',
  new_member_joined: 'person-add-outline',
  member_left: 'exit-outline',
  member_role_changed: 'people-outline',
  payment_received: 'card-outline',
  payment_failed: 'alert-circle-outline',
  refund_processed: 'cash-outline',
  daily_summary: 'document-text-outline',
  weekly_report: 'bar-chart-outline',
  // Organization member notifications
  booking_confirmed: 'checkmark-circle-outline',
  booking_reminder: 'alarm-outline',
  booking_cancelled_by_org: 'calendar-clear-outline',
  membership_approved: 'checkmark-done-outline',
  org_announcement: 'megaphone-outline',
  admin_broadcast: 'megaphone-outline',
  // Program notifications
  program_registration_confirmed: 'checkmark-circle-outline',
  program_registration_cancelled: 'close-circle-outline',
  program_session_reminder: 'alarm-outline',
  program_session_cancelled: 'calendar-clear-outline',
  program_waitlist_promoted: 'arrow-up-circle-outline',
  program_payment_due: 'card-outline',
  program_payment_received: 'checkmark-done-circle-outline',
  // Morning digest email
  morning_digest: 'mail-outline',
  // Weekly availability refresh nudge
  availability_refresh_reminder: 'time-outline',
  // Stripe JIT reimbursement notifications
  payouts_setup_required: 'card-outline',
  payouts_released: 'send-outline',
  payouts_expired_refunded: 'alert-circle-outline',
  reimbursement_received: 'cash-outline',
  reimbursement_all_received: 'checkmark-done-circle-outline',
  // Match time suggestion
  match_time_suggested: 'time-outline',
  match_time_suggestion_accepted: 'checkmark-circle-outline',
  match_time_suggestion_declined: 'close-circle-outline',
  tournament_partner_registered: 'people-outline',
  tournament_partner_withdrew: 'exit-outline',
  // Tournament lifecycle
  tournament_registration_received: 'person-add-outline',
  tournament_invitation: 'mail-outline',
  tournament_registration_approved: 'checkmark-circle-outline',
  tournament_registration_removed: 'remove-circle-outline',
  tournament_bracket_published: 'git-network-outline',
  tournament_match_completed: 'podium-outline',
  tournament_match_ready: 'flash-outline',
  tournament_updated: 'create-outline',
  tournament_cancelled: 'close-circle-outline',
  tournament_completed: 'trophy-outline',
  session_published: 'calendar-outline',
  session_confirm_reminder: 'alarm-outline',
  season_closed: 'flag-outline',
  session_cancelled: 'close-circle-outline',
  season_cancelled: 'close-circle-outline',
  league_invitation: 'mail-outline',
  league_member_request: 'person-add-outline',
  league_member_approved: 'checkmark-circle-outline',
};

/**
 * Color mapping for notification types
 */
export const NOTIFICATION_TYPE_COLORS: Record<ExtendedNotificationTypeEnum, string> = {
  // Original types
  match_invitation: '#4DB8A8', // Teal
  reminder: '#FF9800', // Orange
  payment: '#4CAF50', // Green
  support: '#2196F3', // Blue
  chat: '#9C27B0', // Purple
  system: '#607D8B', // Blue Grey
  // Match lifecycle types
  match_join_request: '#4DB8A8', // Teal
  match_join_accepted: '#4CAF50', // Green
  match_join_rejected: '#F44336', // Red
  match_player_joined: '#4CAF50', // Green
  match_cancelled: '#F44336', // Red
  match_updated: '#2196F3', // Blue
  match_starting_soon: '#FF9800', // Orange
  match_check_in_available: '#4CAF50', // Green
  match_new_available: '#4DB8A8', // Teal
  match_spot_opened: '#4CAF50', // Green
  nearby_match_available: '#2196F3', // Blue
  match_completed: '#4CAF50', // Green
  player_kicked: '#F44336', // Red
  player_left: '#FF9800', // Orange
  // Social types
  new_message: '#9C27B0', // Purple
  friend_request: '#9C27B0', // Purple
  rating_verified: '#4CAF50', // Green
  // Community types
  community_join_request: '#4DB8A8', // Teal
  community_join_accepted: '#4CAF50', // Green
  community_join_rejected: '#F44336', // Red
  network_deleted: '#F44336', // Red
  // Reference request types
  reference_request_received: '#4DB8A8', // Teal - incoming request
  reference_request_accepted: '#4CAF50', // Green - positive outcome
  reference_request_declined: '#F44336', // Red - declined
  // Feedback types
  feedback_request: '#FFC107', // Amber
  feedback_reminder: '#FF9800', // Orange
  score_confirmation: '#4CAF50', // Green
  // Organization staff notifications
  booking_created: '#4DB8A8', // Teal
  booking_cancelled_by_player: '#F44336', // Red
  booking_modified: '#2196F3', // Blue
  new_member_joined: '#4CAF50', // Green
  member_left: '#FF9800', // Orange
  member_role_changed: '#2196F3', // Blue
  payment_received: '#4CAF50', // Green
  payment_failed: '#F44336', // Red
  refund_processed: '#FF9800', // Orange
  daily_summary: '#607D8B', // Blue Grey
  weekly_report: '#607D8B', // Blue Grey
  // Organization member notifications
  booking_confirmed: '#4CAF50', // Green
  booking_reminder: '#FF9800', // Orange
  booking_cancelled_by_org: '#F44336', // Red
  membership_approved: '#4CAF50', // Green
  org_announcement: '#2196F3', // Blue
  admin_broadcast: '#2196F3', // Blue
  // Program notifications
  program_registration_confirmed: '#4CAF50', // Green
  program_registration_cancelled: '#F44336', // Red
  program_session_reminder: '#FF9800', // Orange
  program_session_cancelled: '#F44336', // Red
  program_waitlist_promoted: '#4DB8A8', // Teal
  program_payment_due: '#FF9800', // Orange
  program_payment_received: '#4CAF50', // Green
  // Morning digest email
  morning_digest: '#4DB8A8', // Teal — matches the email primary
  // Weekly availability refresh nudge
  availability_refresh_reminder: '#4DB8A8', // Teal — same family as morning digest
  // Stripe JIT reimbursement notifications
  payouts_setup_required: '#FF9800', // Orange — action required
  payouts_released: '#4CAF50', // Green — money on the way
  payouts_expired_refunded: '#F44336', // Red — failure / refund
  reimbursement_received: '#4CAF50', // Green — money received
  reimbursement_all_received: '#4CAF50', // Green — fully done
  // Match time suggestion
  match_time_suggested: '#FF9800', // Orange — action required from the host
  match_time_suggestion_accepted: '#4CAF50', // Green
  match_time_suggestion_declined: '#F44336', // Red
  tournament_partner_registered: '#4DB8A8', // Teal
  tournament_partner_withdrew: '#FF9800', // Orange
  // Tournament lifecycle
  tournament_registration_received: '#FF9800', // Orange — action required from organizer
  tournament_invitation: '#4DB8A8', // Teal — invite
  tournament_registration_approved: '#4CAF50', // Green
  tournament_registration_removed: '#F44336', // Red
  tournament_bracket_published: '#4DB8A8', // Teal
  tournament_match_completed: '#4DB8A8', // Teal
  tournament_match_ready: '#4DB8A8', // Teal
  tournament_updated: '#FF9800', // Orange — details changed
  tournament_cancelled: '#F44336', // Red
  tournament_completed: '#4CAF50', // Green — celebration
  session_published: '#4DB8A8', // Teal — info
  session_confirm_reminder: '#FF9800', // Amber — action needed
  season_closed: '#4CAF50', // Green — completion
  session_cancelled: '#F44336', // Red — cancellation
  season_cancelled: '#F44336', // Red — cancellation
  league_invitation: '#4DB8A8', // Teal — info
  league_member_request: '#FF9800', // Amber — action needed
  league_member_approved: '#4CAF50', // Green — accepted
};

/**
 * Human-readable labels for notification types
 */
export const NOTIFICATION_TYPE_LABELS: Record<ExtendedNotificationTypeEnum, string> = {
  match_invitation: 'Match Invitation',
  reminder: 'Reminder',
  payment: 'Payment',
  support: 'Support',
  chat: 'Chat',
  system: 'System',
  match_join_request: 'Join Request',
  match_join_accepted: 'Request Accepted',
  match_join_rejected: 'Request Rejected',
  match_player_joined: 'Player Joined',
  match_cancelled: 'Match Cancelled',
  match_updated: 'Match Updated',
  match_starting_soon: 'Match Starting Soon',
  match_check_in_available: 'Check-in Available',
  match_new_available: 'New Game in Group',
  match_spot_opened: 'Spot Opened',
  nearby_match_available: 'Nearby Match',
  match_completed: 'Match Completed',
  player_kicked: 'Removed from Match',
  player_left: 'Player Left',
  new_message: 'New Message',
  friend_request: 'Friend Request',
  rating_verified: 'Rating Verified',
  // Community types
  community_join_request: 'Community Join Request',
  community_join_accepted: 'Community Join Accepted',
  community_join_rejected: 'Community Join Rejected',
  network_deleted: 'Network Deleted',
  // Reference request types
  reference_request_received: 'Reference Request Received',
  reference_request_accepted: 'Reference Request Accepted',
  reference_request_declined: 'Reference Request Declined',
  feedback_request: 'Feedback Request',
  feedback_reminder: 'Feedback Reminder',
  score_confirmation: 'Score Confirmation',
  // Organization staff notifications
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
  // Organization member notifications
  booking_confirmed: 'Booking Confirmed',
  booking_reminder: 'Booking Reminder',
  booking_cancelled_by_org: 'Booking Cancelled',
  membership_approved: 'Membership Approved',
  org_announcement: 'Announcement',
  admin_broadcast: 'Announcement',
  // Program notifications
  program_registration_confirmed: 'Registration Confirmed',
  program_registration_cancelled: 'Registration Cancelled',
  program_session_reminder: 'Session Reminder',
  program_session_cancelled: 'Session Cancelled',
  program_waitlist_promoted: 'Waitlist Promoted',
  program_payment_due: 'Payment Due',
  program_payment_received: 'Payment Received',
  // Morning digest email
  morning_digest: 'Morning Digest',
  // Weekly availability refresh nudge
  availability_refresh_reminder: 'Availability Refresh',
  // Stripe JIT reimbursement notifications
  payouts_setup_required: 'Payouts Setup Required',
  payouts_released: 'Payouts Released',
  payouts_expired_refunded: 'Reimbursement Expired',
  reimbursement_received: 'Reimbursement Received',
  reimbursement_all_received: 'All Reimbursements Received',
  // Match time suggestion
  match_time_suggested: 'Time Change Suggested',
  match_time_suggestion_accepted: 'Time Change Accepted',
  match_time_suggestion_declined: 'Time Change Declined',
  tournament_partner_registered: 'Tournament Partner',
  tournament_partner_withdrew: 'Team Withdrawn',
  // Tournament lifecycle
  tournament_registration_received: 'Registration Request',
  tournament_invitation: 'Tournament invitation',
  tournament_registration_approved: 'Registration Approved',
  tournament_registration_removed: 'Removed from Tournament',
  tournament_bracket_published: 'Bracket Published',
  tournament_match_completed: 'Tournament Result',
  tournament_match_ready: 'Next Match',
  tournament_updated: 'Tournament Updated',
  tournament_cancelled: 'Tournament Cancelled',
  tournament_completed: 'Tournament Complete',
  session_published: 'Session Schedule Published',
  session_confirm_reminder: 'Confirm Your Spot',
  season_closed: 'Season Closed',
  session_cancelled: 'Session Cancelled',
  season_cancelled: 'Season Cancelled',
  league_invitation: 'League Invitation',
  league_member_request: 'New Join Request',
  league_member_approved: 'Membership Approved',
};

/**
 * Notification type categories for grouping in preferences UI
 */
export type NotificationCategory = 'match' | 'social' | 'system' | 'organization' | 'leagues';

export const NOTIFICATION_TYPE_CATEGORIES: Record<
  ExtendedNotificationTypeEnum,
  NotificationCategory
> = {
  // Match category
  match_invitation: 'match',
  match_join_request: 'match',
  match_join_accepted: 'match',
  match_join_rejected: 'match',
  match_player_joined: 'match',
  match_cancelled: 'match',
  match_updated: 'match',
  match_starting_soon: 'match',
  match_check_in_available: 'match',
  match_new_available: 'match',
  match_spot_opened: 'match',
  nearby_match_available: 'match',
  match_completed: 'match',
  player_kicked: 'match',
  player_left: 'match',
  // Social category
  chat: 'social',
  new_message: 'social',
  friend_request: 'social',
  rating_verified: 'social',
  // Community types (social)
  community_join_request: 'social',
  community_join_accepted: 'social',
  community_join_rejected: 'social',
  network_deleted: 'social',
  // Reference request types (social)
  reference_request_received: 'social',
  reference_request_accepted: 'social',
  reference_request_declined: 'social',
  // System category
  reminder: 'system',
  payment: 'system',
  support: 'system',
  system: 'system',
  // Feedback (match-related)
  feedback_request: 'match',
  feedback_reminder: 'match',
  score_confirmation: 'match',
  // Organization category
  booking_created: 'organization',
  booking_cancelled_by_player: 'organization',
  booking_modified: 'organization',
  new_member_joined: 'organization',
  member_left: 'organization',
  member_role_changed: 'organization',
  payment_received: 'organization',
  payment_failed: 'organization',
  refund_processed: 'organization',
  daily_summary: 'organization',
  weekly_report: 'organization',
  booking_confirmed: 'organization',
  booking_reminder: 'organization',
  booking_cancelled_by_org: 'organization',
  membership_approved: 'organization',
  org_announcement: 'organization',
  // Program notifications
  program_registration_confirmed: 'organization',
  program_registration_cancelled: 'organization',
  program_session_reminder: 'organization',
  program_session_cancelled: 'organization',
  program_waitlist_promoted: 'organization',
  program_payment_due: 'organization',
  program_payment_received: 'organization',
  // Morning digest email — system category since it's a generated daily summary
  morning_digest: 'system',
  // Weekly availability refresh — also a system-generated nudge
  availability_refresh_reminder: 'system',
  admin_broadcast: 'system',
  // Stripe JIT reimbursement notifications — system category (money/admin)
  payouts_setup_required: 'system',
  payouts_released: 'system',
  payouts_expired_refunded: 'system',
  reimbursement_received: 'system',
  reimbursement_all_received: 'system',
  // Match time suggestion
  match_time_suggested: 'match',
  match_time_suggestion_accepted: 'match',
  match_time_suggestion_declined: 'match',
  // Leagues & Tournaments — player-facing competition notifications. Grouped
  // under the 'leagues' category so they surface in the mobile preferences
  // screen (which intentionally hides true 'organization'/staff notifications).
  tournament_partner_registered: 'leagues',
  tournament_partner_withdrew: 'leagues',
  tournament_registration_received: 'leagues',
  tournament_invitation: 'leagues',
  tournament_registration_approved: 'leagues',
  tournament_registration_removed: 'leagues',
  tournament_bracket_published: 'leagues',
  tournament_match_completed: 'leagues',
  tournament_match_ready: 'leagues',
  tournament_updated: 'leagues',
  tournament_cancelled: 'leagues',
  tournament_completed: 'leagues',
  session_published: 'leagues',
  session_confirm_reminder: 'leagues',
  season_closed: 'leagues',
  session_cancelled: 'leagues',
  season_cancelled: 'leagues',
  league_invitation: 'leagues',
  league_member_request: 'leagues',
  league_member_approved: 'leagues',
};

/**
 * Labels for notification categories
 */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  match: 'Match Notifications',
  social: 'Social Notifications',
  system: 'System Notifications',
  organization: 'Organization Notifications',
  leagues: 'Leagues & Tournaments',
};

/**
 * Labels for delivery channels
 */
export const DELIVERY_CHANNEL_LABELS: Record<DeliveryChannelEnum, string> = {
  email: 'Email',
  push: 'Push',
  sms: 'SMS',
};

/**
 * Icons for delivery channels (Ionicons names)
 */
export const DELIVERY_CHANNEL_ICONS: Record<DeliveryChannelEnum, string> = {
  email: 'mail-outline',
  push: 'notifications-outline',
  sms: 'chatbox-outline',
};

/**
 * Labels for notification priority
 */
export const NOTIFICATION_PRIORITY_LABELS: Record<NotificationPriorityEnum, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/**
 * Default notification preferences matrix
 * Used when user has no explicit preference set
 * Key: notification type, Value: { channel: enabled }
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Record<
  ExtendedNotificationTypeEnum,
  Record<DeliveryChannelEnum, boolean>
> = {
  // Match types - email and push on, sms off by default
  match_invitation: { email: true, push: true, sms: false },
  match_join_request: { email: true, push: true, sms: false },
  match_join_accepted: { email: true, push: true, sms: false },
  match_join_rejected: { email: true, push: true, sms: false },
  match_player_joined: { email: false, push: true, sms: false }, // Push only for player joins
  match_cancelled: { email: true, push: true, sms: true }, // SMS for cancellations
  match_updated: { email: false, push: true, sms: false },
  match_starting_soon: { email: false, push: true, sms: true }, // SMS for reminders
  match_check_in_available: { email: true, push: true, sms: false },
  match_new_available: { email: false, push: true, sms: false },
  match_spot_opened: { email: false, push: true, sms: false },
  nearby_match_available: { email: false, push: true, sms: false },
  player_kicked: { email: true, push: true, sms: false },
  player_left: { email: false, push: true, sms: false }, // Push only for player leaves
  match_completed: { email: true, push: true, sms: false },
  // Social types - push only by default
  chat: { email: false, push: true, sms: false },
  new_message: { email: false, push: true, sms: false },
  friend_request: { email: true, push: true, sms: false },
  rating_verified: { email: true, push: true, sms: false },
  // Community types
  community_join_request: { email: true, push: true, sms: false },
  community_join_accepted: { email: true, push: true, sms: false },
  community_join_rejected: { email: true, push: true, sms: false },
  network_deleted: { email: true, push: true, sms: false },
  // Reference request types
  reference_request_received: { email: true, push: true, sms: false },
  reference_request_accepted: { email: true, push: true, sms: false },
  reference_request_declined: { email: true, push: true, sms: false },
  // System types - email only by default
  reminder: { email: false, push: true, sms: false },
  payment: { email: true, push: true, sms: false },
  support: { email: true, push: false, sms: false },
  system: { email: true, push: false, sms: false },
  // Feedback types - both email and push for feedback reminders
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
  payment_failed: { email: true, push: false, sms: true }, // SMS for payment failures
  refund_processed: { email: true, push: false, sms: false },
  daily_summary: { email: false, push: false, sms: false }, // Opt-in
  weekly_report: { email: true, push: false, sms: false },
  // Organization member notifications - email only by default
  booking_confirmed: { email: true, push: false, sms: false },
  booking_reminder: { email: true, push: false, sms: true }, // SMS for reminders
  booking_cancelled_by_org: { email: true, push: false, sms: true }, // SMS for cancellations
  membership_approved: { email: true, push: false, sms: false },
  org_announcement: { email: true, push: false, sms: false },
  admin_broadcast: { email: true, push: false, sms: false }, // broadcasts are email-only
  // Program notifications
  program_registration_confirmed: { email: true, push: true, sms: false },
  program_registration_cancelled: { email: true, push: true, sms: true }, // SMS for cancellations
  program_session_reminder: { email: false, push: true, sms: true }, // SMS for reminders
  program_session_cancelled: { email: true, push: true, sms: true }, // SMS for cancellations
  program_waitlist_promoted: { email: true, push: true, sms: false },
  program_payment_due: { email: true, push: true, sms: false },
  program_payment_received: { email: true, push: false, sms: false },
  // Morning digest email — opt-in by default; user can disable via the
  // unsubscribe link in the footer or the in-app notification preferences.
  morning_digest: { email: true, push: false, sms: false },
  // Weekly availability refresh — push-only weekly nudge; quiet enough that
  // email would be overkill but the push closes the loop on stale data.
  availability_refresh_reminder: { email: false, push: true, sms: false },
  // Stripe JIT reimbursement notifications — money matters, push always on,
  // email for the high-priority "set up payouts" prompt so it's not missed.
  payouts_setup_required: { email: true, push: true, sms: false },
  payouts_released: { email: false, push: true, sms: false },
  payouts_expired_refunded: { email: true, push: true, sms: false },
  reimbursement_received: { email: false, push: true, sms: false },
  reimbursement_all_received: { email: false, push: true, sms: false },
  // Match time suggestion — push always on; email matches the high-signal
  // match_invitation / match_join_request defaults so it lands beside them.
  match_time_suggested: { email: true, push: true, sms: false },
  match_time_suggestion_accepted: { email: true, push: true, sms: false },
  match_time_suggestion_declined: { email: false, push: true, sms: false },
  tournament_partner_registered: { email: false, push: true, sms: false },
  tournament_partner_withdrew: { email: false, push: true, sms: false },
  // Tournament lifecycle — mirror the edge function DEFAULT_PREFERENCES
  tournament_registration_received: { email: false, push: true, sms: false },
  tournament_invitation: { email: true, push: true, sms: false },
  tournament_registration_approved: { email: false, push: true, sms: false },
  tournament_registration_removed: { email: false, push: true, sms: false },
  tournament_bracket_published: { email: false, push: true, sms: false },
  tournament_match_completed: { email: false, push: true, sms: false },
  tournament_match_ready: { email: false, push: true, sms: false },
  tournament_updated: { email: false, push: true, sms: false },
  tournament_cancelled: { email: true, push: true, sms: false },
  tournament_completed: { email: false, push: true, sms: false },
  session_published: { email: true, push: true, sms: false },
  session_confirm_reminder: { email: false, push: true, sms: false },
  season_closed: { email: true, push: true, sms: false },
  session_cancelled: { email: true, push: true, sms: false },
  season_cancelled: { email: true, push: true, sms: false },
  league_invitation: { email: true, push: true, sms: false },
  league_member_request: { email: false, push: true, sms: false },
  league_member_approved: { email: true, push: true, sms: false },
};

// ============================================
// NOTIFICATION ROUTING GROUPS
// ============================================

/**
 * Notification-type groupings used to deep-link a tapped notification to the
 * right screen. Single source of truth shared by the in-app Notifications
 * screen and the push-notification tap handler so the two can never drift.
 *
 * Typed as `readonly ExtendedNotificationTypeEnum[]` so a typo or a stale value
 * fails to compile, and `.includes(notification.type)` needs no cast.
 */
export const MATCH_NOTIFICATION_TYPES: readonly ExtendedNotificationTypeEnum[] = [
  'match_invitation',
  'match_join_request',
  'match_join_accepted',
  'match_join_rejected',
  'match_player_joined',
  'match_cancelled',
  'match_updated',
  'match_starting_soon',
  'match_check_in_available',
  'match_new_available',
  'match_spot_opened',
  'nearby_match_available',
  'player_kicked',
  'player_left',
  'score_confirmation',
  'feedback_request',
  'feedback_reminder',
  'match_time_suggested',
  'match_time_suggestion_accepted',
  'match_time_suggestion_declined',
];

export const COMMUNITY_NOTIFICATION_TYPES: readonly ExtendedNotificationTypeEnum[] = [
  'community_join_request',
  'community_join_accepted',
  'community_join_rejected',
];

/** All reference-request types (target is the request/sport profile). */
export const REFERENCE_NOTIFICATION_TYPES: readonly ExtendedNotificationTypeEnum[] = [
  'reference_request_received',
  'reference_request_accepted',
  'reference_request_declined',
];

/** Reference responses that deep-link to the sport profile. */
export const REFERENCE_RESPONSE_NOTIFICATION_TYPES: readonly ExtendedNotificationTypeEnum[] = [
  'reference_request_accepted',
  'reference_request_declined',
];

/** Tournament notifications — target_id is always the tournament id. */
export const TOURNAMENT_NOTIFICATION_TYPES: readonly ExtendedNotificationTypeEnum[] = [
  'tournament_partner_registered',
  'tournament_partner_withdrew',
  'tournament_registration_received',
  'tournament_invitation',
  'tournament_registration_approved',
  'tournament_registration_removed',
  'tournament_bracket_published',
  'tournament_match_completed',
  'tournament_match_ready',
  'tournament_updated',
  'tournament_cancelled',
  'tournament_completed',
];

/** League notifications — league id arrives as payload.leagueId or target_id. */
export const LEAGUE_NOTIFICATION_TYPES: readonly ExtendedNotificationTypeEnum[] = [
  'league_invitation',
  'league_member_request',
  'league_member_approved',
  'season_closed',
  'season_cancelled',
];

/** Session notifications — need both payload.sessionId and payload.leagueId. */
export const SESSION_NOTIFICATION_TYPES: readonly ExtendedNotificationTypeEnum[] = [
  'session_published',
  'session_confirm_reminder',
  'session_cancelled',
];

// ============================================
// MATCH CREATION - NEW ENUMS
// ============================================

/**
 * Human-readable labels for match format (singles/doubles)
 */
export const MATCH_FORMAT_LABELS: Record<MatchFormatEnum, string> = {
  singles: 'Singles',
  doubles: 'Doubles',
};

/**
 * Descriptions for match formats
 */
export const MATCH_FORMAT_DESCRIPTIONS: Record<MatchFormatEnum, string> = {
  singles: '1 vs 1 match',
  doubles: '2 vs 2 match with teams',
};

/**
 * Human-readable labels for court reservation status
 */
export const COURT_STATUS_LABELS: Record<CourtStatusEnum, string> = {
  reserved: 'Court Reserved',
  to_reserve: 'Court To Reserve',
};

/**
 * Descriptions for court status
 */
export const COURT_STATUS_DESCRIPTIONS: Record<CourtStatusEnum, string> = {
  reserved: 'The court has already been booked',
  to_reserve: 'The court still needs to be reserved',
};

/**
 * Human-readable labels for match visibility
 */
export const MATCH_VISIBILITY_LABELS: Record<MatchVisibilityEnum, string> = {
  public: 'Public',
  private: 'Private',
};

/**
 * Descriptions for match visibility
 */
export const MATCH_VISIBILITY_DESCRIPTIONS: Record<MatchVisibilityEnum, string> = {
  public: 'Anyone can discover and join this match',
  private: 'Only invited players can see this match',
};

/**
 * Human-readable labels for match join mode
 */
export const MATCH_JOIN_MODE_LABELS: Record<MatchJoinModeEnum, string> = {
  direct: 'Join Directly',
  request: 'Request to Join',
};

/**
 * Descriptions for match join mode
 */
export const MATCH_JOIN_MODE_DESCRIPTIONS: Record<MatchJoinModeEnum, string> = {
  direct: 'Players can join immediately without approval',
  request: 'Players must request to join and wait for approval',
};

/**
 * Human-readable labels for cost split type
 */
export const COST_SPLIT_TYPE_LABELS: Record<CostSplitTypeEnum, string> = {
  host_pays: 'Host Pays',
  split_equal: 'Split Equally',
  custom: 'Custom Split',
};

/**
 * Descriptions for cost split types
 */
export const COST_SPLIT_TYPE_DESCRIPTIONS: Record<CostSplitTypeEnum, string> = {
  host_pays: 'The match host covers all court costs',
  split_equal: 'Court costs are split equally between all players',
  custom: 'Custom arrangement for splitting costs',
};

/**
 * Human-readable labels for location type
 */
export const LOCATION_TYPE_LABELS: Record<LocationTypeEnum, string> = {
  facility: 'Select Facility',
  custom: 'Custom Location',
  tbd: 'To Be Determined',
};

/**
 * Descriptions for location types
 */
export const LOCATION_TYPE_DESCRIPTIONS: Record<LocationTypeEnum, string> = {
  facility: 'Choose from available facilities and courts',
  custom: 'Enter a custom location address',
  tbd: 'Location will be decided later',
};

/**
 * Human-readable labels for match duration (using match_duration_enum)
 */
export const MATCH_DURATION_ENUM_LABELS: Record<MatchDurationEnum, string> = {
  '30': '30 Minutes',
  '60': '1 Hour',
  '90': '1.5 Hours',
  '120': '2 Hours',
  custom: 'Custom Duration',
};

/**
 * Human-readable labels for match type enum (practice/competitive/both)
 * Used for player expectation in match creation
 */
export const MATCH_TYPE_ENUM_LABELS: Record<MatchTypeEnum, string> = {
  casual: 'Casual',
  competitive: 'Competitive',
  both: 'Either',
};

/**
 * Descriptions for match type enum (player expectation)
 */
export const MATCH_TYPE_ENUM_DESCRIPTIONS: Record<MatchTypeEnum, string> = {
  casual: 'Casual hitting, rallying, or practice session',
  competitive: 'A real match with scoring and competition',
  both: 'Open to either practice or competitive play',
};

/**
 * Derived match status type (not stored in DB, computed from cancelled_at and match_result)
 * This is a UI-only type for displaying match status
 */
export type MatchStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

/**
 * Human-readable labels for match status
 * Note: Match status is now derived from cancelled_at and match_result, not stored as an enum
 */
export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
};

/**
 * Icon mapping for match status (Ionicons names)
 */
export const MATCH_STATUS_ICONS: Record<MatchStatus, string> = {
  scheduled: 'calendar-outline',
  in_progress: 'play-circle-outline',
  completed: 'checkmark-circle-outline',
  cancelled: 'close-circle-outline',
  no_show: 'alert-circle-outline',
};

/**
 * Color mapping for match status
 */
export const MATCH_STATUS_COLORS: Record<MatchStatus, string> = {
  scheduled: '#2196F3', // Blue
  in_progress: '#FF9800', // Orange
  completed: '#4CAF50', // Green
  cancelled: '#F44336', // Red
  no_show: '#9E9E9E', // Grey
};
