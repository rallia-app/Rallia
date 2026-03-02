/**
 * Shared PostHog analytics event name constants.
 * Use these across web and mobile to ensure consistent naming.
 */
export const ANALYTICS_EVENTS = {
  // Auth
  SIGN_UP_COMPLETED: 'sign_up_completed',
  SIGN_IN_COMPLETED: 'sign_in_completed',
  SIGN_OUT: 'sign_out',

  // Organization
  ORGANIZATION_CREATED: 'organization_created',
  ORGANIZATION_SWITCHED: 'organization_switched',

  // Facility
  FACILITY_CREATED: 'facility_created',
  FACILITY_UPDATED: 'facility_updated',
  FACILITY_DELETED: 'facility_deleted',

  // Court
  COURT_CREATED: 'court_created',
  COURT_UPDATED: 'court_updated',
  COURT_DELETED: 'court_deleted',

  // Match
  MATCH_CREATED: 'match_created',
  MATCH_JOINED: 'match_joined',
  MATCH_LEFT: 'match_left',
  MATCH_CANCELLED: 'match_cancelled',
  MATCH_COMPLETED: 'match_completed',
  MATCH_SCORE_SUBMITTED: 'match_score_submitted',

  // Feedback
  FEEDBACK_SUBMITTED: 'feedback_submitted',
  FEEDBACK_SKIPPED: 'feedback_skipped',

  // Player
  PLAYER_PROFILE_UPDATED: 'player_profile_updated',
  PLAYER_INVITED: 'player_invited',

  // Onboarding
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_COMPLETED: 'onboarding_completed',
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
