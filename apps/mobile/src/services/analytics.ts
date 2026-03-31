import type { PostHog } from 'posthog-react-native';
import type { JsonType } from '@posthog/core';

let client: PostHog | null = null;

export function setAnalyticsClient(posthog: PostHog): void {
  client = posthog;
}

function capture(event: string, properties?: Record<string, JsonType>): void {
  if (__DEV__) {
    console.log(`[Analytics] ${event}`, properties ?? '');
  }
  client?.capture(event, properties);
}

// ---- Auth ----

export function signInStarted(props: { method: 'email' | 'google' | 'apple' | 'facebook' }): void {
  capture('sign_in_started', props);
}

export function signInCompleted(props: {
  method: 'email' | 'google' | 'apple' | 'facebook';
  is_new_user: boolean;
}): void {
  capture('sign_in_completed', props);
}

// ---- Onboarding Funnel ----

export function onboardingStarted(props: { auth_provider: string }): void {
  capture('onboarding_started', props);
}

export function onboardingStepCompleted(props: { step_name: string; step_index: number }): void {
  capture('onboarding_step_completed', props);
}

export function onboardingCompleted(props: { sports: string[]; duration_seconds: number }): void {
  capture('onboarding_completed', props);
}

export function onboardingAbandoned(props: {
  last_step: string;
  step_index: number;
  duration_seconds: number;
}): void {
  capture('onboarding_abandoned', props);
}

// ---- Core Loop ----

export function matchCreated(props: {
  sport: string;
  format: string;
  is_public: boolean;
  player_count: string;
}): void {
  capture('match_created', props);
}

export function matchJoined(props: { sport: string; discovery_source?: string }): void {
  capture('match_joined', props);
}

export function matchJoinRequested(props: { sport: string }): void {
  capture('match_join_requested', props);
}

export function matchViewed(props: { match_id: string; source: string }): void {
  capture('match_viewed', props);
}

export function messageSent(props: { conversation_type: string }): void {
  capture('message_sent', props);
}

export function courtBooked(props: { facility_id: string; sport: string }): void {
  capture('court_booked', props);
}

export function matchCancelled(props: { sport: string }): void {
  capture('match_cancelled', props);
}

export function matchFeedbackSubmitted(props: { sport: string }): void {
  capture('match_feedback_submitted', props);
}

export function matchCreationAbandoned(props: {
  last_step: number;
  duration_seconds: number;
}): void {
  capture('match_creation_abandoned', props);
}

// ---- Onboarding (Pre) ----

export function preOnboardingCompleted(props: { sport_count: number }): void {
  capture('pre_onboarding_completed', props);
}

export function matchShared(props: { sport: string }): void {
  capture('match_shared', props);
}

export function matchDeclined(props: { sport: string }): void {
  capture('match_declined', props);
}

export function matchCreationStarted(): void {
  capture('match_creation_started');
}

export function matchCheckInCompleted(props: { sport: string }): void {
  capture('match_check_in_completed', props);
}

export function feedbackAbandoned(): void {
  capture('feedback_abandoned');
}

// ---- Player Relations ----

export function playerFavorited(): void {
  capture('player_favorited');
}

export function playerBlocked(): void {
  capture('player_blocked');
}

// ---- Sport ----

export function sportModeSwitched(props: { sport_name: string }): void {
  capture('sport_mode_switched', props);
}

// ---- Growth (Inbound) ----

export function referralCodeUsed(): void {
  capture('referral_code_used');
}

// ---- Settings ----

export function availabilityScheduleUpdated(): void {
  capture('availability_schedule_updated');
}

export function notificationPreferenceChanged(props: {
  notification_type: string;
  channel: string;
  enabled: boolean;
}): void {
  capture('notification_preference_changed', props);
}

export function ratingProofSubmitted(props: { sport: string }): void {
  capture('rating_proof_submitted', props);
}

// ---- Discovery ----

export function playerProfileViewed(props: { source: string }): void {
  capture('player_profile_viewed', props);
}

export function searchPerformed(props: {
  query: string;
  result_count: number;
  context: string;
}): void {
  capture('search_performed', props);
}

export function filterApplied(props: { filter_type: string; value: string }): void {
  capture('filter_applied', props);
}

// ---- Growth ----

export function referralInviteShared(props: { channel: string }): void {
  capture('referral_invite_shared', props);
}

export function deepLinkOpened(props: { link_type: string }): void {
  capture('deep_link_opened', props);
}

export function inviteToMatchSent(props: { invite_count: number }): void {
  capture('invite_to_match_sent', props);
}

// ---- Community & Social ----

export function groupCreated(props: { sport?: string }): void {
  capture('group_created', props);
}

export function groupJoined(props: { source: string }): void {
  capture('group_joined', props);
}

export function communityJoined(props: { source: string }): void {
  capture('community_joined', props);
}

// ---- Notifications ----

export function pushNotificationOpened(props: { type: string }): void {
  capture('push_notification_opened', props);
}

// ---- Monetization ----

export function bookingInitiated(props: { facility_id: string; sport: string }): void {
  capture('booking_initiated', props);
}

export function bookingCancelled(props: { reason?: string }): void {
  capture('booking_cancelled', props);
}

// ---- App Health ----

export function appOpened(props: { cold_start: boolean }): void {
  capture('app_opened', props);
}
