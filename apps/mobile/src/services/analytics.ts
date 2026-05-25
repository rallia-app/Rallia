import type { JsonType } from '@posthog/core';
import { Platform } from 'react-native';
import { posthogClient } from '../providers/PostHogProvider';
import { logMetaEvent } from '../lib/meta';

function capture(event: string, properties?: Record<string, JsonType>): void {
  if (__DEV__) {
    console.log(`[Analytics] ${event}`, properties ?? '');
  }
  posthogClient?.capture(event, properties);
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
  // Meta uses Complete Registration for lookalikes and new-user optimization.
  // Only fire for genuine new sign-ups — returning sign-ins should not inflate
  // Meta's registration count or attribution data.
  if (props.is_new_user) {
    logMetaEvent('fb_mobile_complete_registration', { fb_registration_method: props.method });
  }
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
  // Meta's "tutorial completion" — activation signal for the optimizer once
  // we graduate from install-only optimization.
  logMetaEvent('fb_mobile_tutorial_completion', {
    fb_num_items: props.sports.length,
  });
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
  match_id: string;
  sport_id: string;
  sport_name: string;
  format: string;
  is_public: boolean;
  player_count: string;
}): void {
  capture('match_created', props);
  // Core activation moment — the user has created a real match. Mapped to
  // Meta's Achievement Unlocked so it's eligible for AEO optimization later.
  logMetaEvent('fb_mobile_achievement_unlocked', {
    fb_description: 'Match Created',
    fb_content_type: props.sport_name,
  });
}

export function matchJoined(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
  discovery_source?: string;
}): void {
  capture('match_joined', props);
  // Custom engagement event — not in Meta's standard catalog but useful as a
  // secondary signal alongside Match Created. Custom event names are
  // arbitrary but must stay stable for Meta to model them.
  logMetaEvent('Match Joined', { fb_content_type: props.sport_name });
}

export function matchFilled(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
  format: string;
}): void {
  capture('match_filled', props);
}

export function matchJoinRequested(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
}): void {
  capture('match_join_requested', props);
}

export function matchViewed(props: { match_id: string; source: string }): void {
  capture('match_viewed', props);
}

export function messageSent(props: { conversation_type: string }): void {
  capture('message_sent', props);
}

export function courtBooked(props: {
  facility_id: string;
  sport_id: string;
  sport_name: string;
}): void {
  capture('court_booked', props);
}

export function matchCancelled(props: { sport_id: string; sport_name: string }): void {
  capture('match_cancelled', props);
}

export function matchFeedbackSubmitted(props: { sport_id: string; sport_name: string }): void {
  capture('match_feedback_submitted', props);
}

export type MatchOutcomeKind = 'played' | 'mutual_cancel' | 'opponent_no_show';
export type CancellationReasonKind = 'weather' | 'court_unavailable' | 'emergency' | 'other';

export function matchOutcomeSubmitted(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
  outcome: MatchOutcomeKind;
  cancellation_reason?: CancellationReasonKind;
  no_show_count?: number;
  opponent_count: number;
}): void {
  capture('match_outcome_submitted', props);
}

export function opponentFeedbackSubmitted(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
  showed_up: boolean;
  was_late: boolean | null;
  star_rating: number | null;
}): void {
  capture('opponent_feedback_submitted', props);
}

export function matchFeedbackCompleted(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
  opponent_count: number;
}): void {
  capture('match_feedback_completed', props);
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

export function matchShared(props: { sport_id: string; sport_name: string }): void {
  capture('match_shared', props);
}

export function matchDeclined(props: { sport_id: string; sport_name: string }): void {
  capture('match_declined', props);
}

export function matchCreationStarted(): void {
  capture('match_creation_started');
}

export type MatchCreationSuccessAction =
  | 'share'
  | 'share_facebook'
  | 'invite_players'
  | 'view_match'
  | 'create_another'
  | 'close';

export function matchCreationSuccessAction(props: {
  match_id: string;
  action: MatchCreationSuccessAction;
  is_edit_mode: boolean;
}): void {
  capture('match_creation_success_action', props);
}

export function matchCreationSuccessViewed(props: {
  match_id: string;
  is_edit_mode: boolean;
}): void {
  capture('match_creation_success_viewed', props);
}

// ---- In-App Match Suggestions ----

export type SuggestionSource = 'feed' | 'sheet' | 'onboarding';

export function matchSuggestionShown(props: {
  source: SuggestionSource;
  opponent_id: string;
  facility_id: string;
  slot_start: string;
  sport_id?: string;
  sport_name?: string;
  /** Final ranking score the algorithm assigned. */
  score?: number;
  /** Per-opponent compat score (RPC output, before per-slot boosts). */
  player_compatibility?: number;
  /** Facility-affinity score from the RPC. */
  facility_affinity?: number;
  /** Caller↔opponent history score (RPC-provided). */
  score_history?: number;
  /** 1-indexed position in the surface's list at the moment of impression. */
  rank?: number;
  match_type?: string;
  match_duration?: string;
}): void {
  capture('match_suggestion_shown', props);
}

export function matchSuggestionInviteSent(props: {
  source: SuggestionSource;
  opponent_id: string;
  facility_id: string;
  slot_start: string;
  match_id: string;
  sport_id?: string;
  sport_name?: string;
  /** Final ranking score the algorithm assigned at impression time. */
  score?: number;
  player_compatibility?: number;
  facility_affinity?: number;
  score_history?: number;
  rank?: number;
  match_type?: string;
  match_duration?: string;
}): void {
  capture('match_suggestion_invite_sent', props);
}

/**
 * Fires when a user taps the opponent avatar on a suggestion card, opening
 * the player profile. Strongest available engagement signal between
 * impression and invite — the user is investigating the opponent enough to
 * leave the suggestion surface. Dimensions mirror the shown/invite events
 * so the engagement funnel joins cleanly in PostHog.
 */
export function matchSuggestionAvatarTapped(props: {
  source: SuggestionSource;
  opponent_id: string;
  facility_id: string;
  slot_start: string;
  sport_id?: string;
  sport_name?: string;
  score?: number;
  player_compatibility?: number;
  facility_affinity?: number;
  score_history?: number;
  rank?: number;
  match_type?: string;
  match_duration?: string;
}): void {
  capture('match_suggestion_avatar_tapped', props);
}

export function matchCheckInCompleted(props: { sport_id: string; sport_name: string }): void {
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

/** @deprecated Use referralAttributed instead */
export function referralCodeUsed(): void {
  capture('referral_code_used');
}

export function referralAttributed(props: {
  invitation_type: string;
  referral_code: string;
  target_id?: string;
}): void {
  capture('referral_attributed', props);
}

export type AcquisitionSource =
  | 'referral_link'
  | 'referral_code'
  | 'discovery_friend'
  | 'discovery_social'
  | 'discovery_app_store'
  | 'discovery_event'
  | 'discovery_search'
  | 'discovery_other'
  | 'unknown';

export function userAcquired(props: {
  source: AcquisitionSource;
  has_referral: boolean;
  referral_invitation_type?: string;
}): void {
  capture('user_acquired', props);
}

// ---- Settings ----

export function availabilityScheduleUpdated(props?: {
  /** True when the user tapped Save without toggling any cell — i.e. just
   *  refreshing last_confirmed_at in response to the weekly nudge. */
  was_refresh_only?: boolean;
}): void {
  capture('availability_schedule_updated', props);
}

export function notificationPreferenceChanged(props: {
  notification_type: string;
  channel: string;
  enabled: boolean;
}): void {
  capture('notification_preference_changed', props);
}

export function ratingProofSubmitted(props: { sport_id: string; sport_name: string }): void {
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
  // Map to Meta's Search standard event. We deliberately omit fb_search_string
  // — Meta's docs flag it as PII-sensitive and our queries can include
  // partial postal codes / player names.
  logMetaEvent('fb_mobile_search', { fb_content_type: props.context });
}

export function filterApplied(props: { filter_type: string; value: string }): void {
  capture('filter_applied', props);
}

// ---- Growth ----

/** @deprecated Use invitationLinkGenerated instead */
export function referralInviteShared(props: { channel: string }): void {
  capture('referral_invite_shared', props);
}

export function invitationLinkGenerated(props: { invitation_type: string; channel: string }): void {
  capture('invitation_link_generated', props);
}

export function onboardingShareSkipped(): void {
  capture('onboarding_share_skipped', {});
}

export function acquisitionChannelSelected(props: { channel: string }): void {
  capture('acquisition_channel_selected', props);
}

export function notificationPermissionResult(props: {
  granted: boolean;
  source: 'pre_onboarding';
}): void {
  capture('notification_permission_result', props);
}

/**
 * Fires after the user resolves Apple's ATT (App Tracking Transparency)
 * prompt — or skips the pre-prompt screen without triggering the system
 * dialog. `skipped: true` means the user dismissed the pre-prompt, so the
 * one-shot system ATT prompt was deliberately NOT fired and remains
 * available for a future moment.
 */
export function trackingPermissionResult(props: {
  granted: boolean;
  skipped: boolean;
  source: 'pre_onboarding';
}): void {
  capture('tracking_permission_result', props);
}

export function deepLinkOpened(props: {
  link_type: string;
  /** Where the URL came from: 'os' = standard OS deep link (Universal Link,
   *  custom scheme, push tap); 'meta_deferred' = Meta SDK's
   *  AppLink.fetchDeferredAppLink() — set when the user tapped a Meta ad
   *  with a deep destination, before installing. Lets us distinguish
   *  ad-driven cold starts from organic ones in PostHog. */
  source?: 'os' | 'meta_deferred';
  invitation_type?: string;
  has_referral?: boolean;
  referral_code?: string;
  target_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
}): void {
  capture('deep_link_opened', props);
}

export function inviteToMatchSent(props: { invite_count: number }): void {
  capture('invite_to_match_sent', props);
}

// ---- Community & Social ----

export function groupCreated(props: { sport_id?: string; sport_name?: string }): void {
  capture('group_created', props);
}

export function groupJoined(props: { source: string }): void {
  capture('group_joined', props);
}

export function communityJoined(props: { source: string }): void {
  capture('community_joined', props);
}

export function matchOpenedFromQR(): void {
  capture('match_opened_from_qr', {});
}

// ---- Notifications ----

export function pushNotificationOpened(props: { type: string }): void {
  capture('push_notification_opened', props);
}

export function notificationReceived(props: { type: string; channel: 'push' | 'in_app' }): void {
  capture('notification_received', props);
}

export function notificationMarkedRead(props: {
  type: string;
  source: 'tap' | 'mark_all' | 'auto';
}): void {
  capture('notification_marked_read', props);
}

// ---- Monetization ----

export function bookingInitiated(props: {
  facility_id: string;
  sport_id: string;
  sport_name: string;
}): void {
  capture('booking_initiated', props);
  // Court-booking handoff is the marketplace equivalent of "initiated
  // checkout". Distinct from in-app subscription purchase — those fire
  // automatically via the iOS Shared Secret / Android Play Billing auto-log.
  logMetaEvent('fb_mobile_initiated_checkout', { fb_content_type: props.sport_name });
}

export function bookingRedirected(props: {
  facility_id: string;
  sport_id: string;
  sport_name: string;
  is_match_linked?: boolean;
  source:
    | 'match_creation'
    | 'facility_directory'
    | 'facility_card'
    | 'match_courts'
    | 'map'
    | 'external_sheet'
    | 'unknown';
}): void {
  capture('booking_redirected', props);
}

export function bookingConfirmed(props: {
  facility_id: string;
  sport_id: string;
  sport_name: string;
  is_match_linked?: boolean;
}): void {
  capture('booking_confirmed', props);
}

export function bookingCancelled(props: { reason?: string }): void {
  capture('booking_cancelled', props);
}

// ---- Waitlist ----

export function waitlistJoined(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
}): void {
  capture('waitlist_joined', props);
}

// ---- Satisfaction ----

export function satisfactionScoreSubmitted(props: { score: number; context: string }): void {
  capture('satisfaction_score_submitted', props);
}

// ---- Pre-signin ----

export function preSigninScreenViewed(): void {
  capture('pre_signin_screen_viewed');
}

// ---- App Health ----

export function appOpened(props: { cold_start: boolean }): void {
  capture('app_opened', props);
}

// ---- Subscription ----

export function paywallViewed(): void {
  capture('paywall_viewed');
  // Meta's Content View — useful for retargeting audiences ("saw paywall but
  // didn't subscribe") and as an intent signal upstream of fb_mobile_subscribe.
  logMetaEvent('fb_mobile_content_view', { fb_content_type: 'paywall' });
}

export function paywallDismissed(): void {
  capture('paywall_dismissed');
}

export function subscriptionStarted(props: {
  product_id: string;
  /** Local price as a number (e.g. 9.99). Passed straight through to Meta's
   *  valueToSum on Android. RevenueCat exposes this as `product.price`. */
  price?: number;
  /** ISO 4217 code (e.g. 'CAD', 'USD'). Required for Meta valuation on
   *  Android — without it Meta can't normalize across geos. */
  currency?: string;
}): void {
  capture('subscription_started', props);
  // iOS auto-logs subscriptions from App Store receipts via the App-Specific
  // Shared Secret configured in Meta dashboard, so firing here would cause
  // duplicate fb_mobile_subscribe events. Android purchases auto-log only
  // covers non-subscription IAPs (Google Play Billing limitation without a
  // Play API service account), so we fire fb_mobile_subscribe manually on
  // Android. If/when GCP service account is added in Meta dashboard, remove
  // this branch — auto-log will take over and duplicates will appear.
  if (Platform.OS === 'android' && props.price && props.currency) {
    logMetaEvent('fb_mobile_subscribe', { fb_currency: props.currency }, props.price);
  }
}

export function subscriptionRenewed(props: { product_id: string }): void {
  capture('subscription_renewed', props);
}

export function subscriptionCancelled(): void {
  capture('subscription_cancelled');
}

export function subscriptionExpired(): void {
  capture('subscription_expired');
}

export function restorePurchasesAttempted(): void {
  capture('restore_purchases_attempted');
}

export function restorePurchasesSuccess(): void {
  capture('restore_purchases_success');
}

export function restorePurchasesFailed(): void {
  capture('restore_purchases_failed');
}

export function billingIssueEncountered(): void {
  capture('billing_issue_encountered');
}
