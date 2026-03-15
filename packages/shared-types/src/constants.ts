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
  TimePeriod,
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
// TIME PERIOD
// ============================================

/**
 * Human-readable labels for time periods
 */
export const TIME_PERIOD_LABELS: Record<TimePeriod, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

/**
 * Time ranges for each period
 */
export const TIME_PERIOD_RANGES: Record<TimePeriod, string> = {
  morning: '6am - 12pm',
  afternoon: '12pm - 5pm',
  evening: '5pm - 9pm',
  night: '9pm - 12am',
};

/**
 * Ordered list of time periods for iteration
 */
export const TIME_PERIODS_ORDERED: TimePeriod[] = ['morning', 'afternoon', 'evening', 'night'];

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
  player_kicked: 'remove-circle-outline',
  player_left: 'exit-outline',
  // Social types
  new_message: 'chatbubble-ellipses-outline',
  rating_verified: 'ribbon-outline',
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
  // Program notifications
  program_registration_confirmed: 'checkmark-circle-outline',
  program_registration_cancelled: 'close-circle-outline',
  program_session_reminder: 'alarm-outline',
  program_session_cancelled: 'calendar-clear-outline',
  program_waitlist_promoted: 'arrow-up-circle-outline',
  program_payment_due: 'card-outline',
  program_payment_received: 'checkmark-done-circle-outline',
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
  player_kicked: '#F44336', // Red
  player_left: '#FF9800', // Orange
  // Social types
  new_message: '#9C27B0', // Purple
  rating_verified: '#4CAF50', // Green
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
  // Program notifications
  program_registration_confirmed: '#4CAF50', // Green
  program_registration_cancelled: '#F44336', // Red
  program_session_reminder: '#FF9800', // Orange
  program_session_cancelled: '#F44336', // Red
  program_waitlist_promoted: '#4DB8A8', // Teal
  program_payment_due: '#FF9800', // Orange
  program_payment_received: '#4CAF50', // Green
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
  player_kicked: 'Removed from Match',
  player_left: 'Player Left',
  new_message: 'New Message',
  rating_verified: 'Rating Verified',
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
 * Notification type categories for grouping in preferences UI
 */
export type NotificationCategory = 'match' | 'social' | 'system' | 'organization';

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
  player_kicked: 'match',
  player_left: 'match',
  // Social category
  chat: 'social',
  new_message: 'social',
  rating_verified: 'social',
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
};

/**
 * Labels for notification categories
 */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  match: 'Match Notifications',
  social: 'Social Notifications',
  system: 'System Notifications',
  organization: 'Organization Notifications',
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
  // Social types - push only by default
  chat: { email: false, push: true, sms: false },
  new_message: { email: false, push: true, sms: false },
  rating_verified: { email: true, push: true, sms: false },
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
  // Program notifications
  program_registration_confirmed: { email: true, push: true, sms: false },
  program_registration_cancelled: { email: true, push: true, sms: true }, // SMS for cancellations
  program_session_reminder: { email: false, push: true, sms: true }, // SMS for reminders
  program_session_cancelled: { email: true, push: true, sms: true }, // SMS for cancellations
  program_waitlist_promoted: { email: true, push: true, sms: false },
  program_payment_due: { email: true, push: true, sms: false },
  program_payment_received: { email: true, push: false, sms: false },
};

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
