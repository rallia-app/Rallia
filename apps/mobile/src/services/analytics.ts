import type { JsonType } from '@posthog/core';
import { Platform } from 'react-native';
import type { SlotSuggestion } from '@rallia/shared-services';

import { posthogClient } from '#/providers/PostHogProvider';
import { logMetaEvent } from '#/lib/meta';

function capture(event: string, properties?: Record<string, JsonType>): void {
  if (__DEV__) {
    console.log(`[Analytics] ${event}`, properties ?? '');
  }
  posthogClient?.capture(event, properties);
}

// ---- Auth ----

export type SessionEndReason =
  | 'user_initiated'
  | 'account_suspended'
  | 'invalid_session'
  | 'unexpected_signed_out'
  | 'session_missing_at_launch';

/**
 * Fired whenever a session ends, with why. Splits the residual logout
 * mechanisms apart in prod: 'unexpected_signed_out' = refresh failure or
 * server-side revocation while running; 'session_missing_at_launch' =
 * the stored session vanished between launches (storage loss).
 */
export function sessionEnded(props: {
  reason: SessionEndReason;
  trigger?: string;
  error_name?: string;
  error_status?: number;
  last_seen_at?: string;
}): void {
  capture('session_ended', props);
}

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

export function phoneCodeSent(props: { source: 'onboarding' | 'settings' }): void {
  capture('phone_code_sent', props);
}

export function phoneVerified(props: { source: 'onboarding' | 'settings' }): void {
  capture('phone_verified', props);
}

export function phoneCaptureSkipped(props: { source: 'onboarding'; had_number: boolean }): void {
  capture('phone_capture_skipped', props);
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
  /** True for weekly-checkin auto-generated matches — lets us compare the
   *  auto vs organic conversion funnel (created → joined → filled → played). */
  is_auto_generated: boolean;
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
  is_auto_generated: boolean;
  discovery_source?: string;
}): void {
  capture('match_filled', props);
}

export function matchJoinRequested(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
  is_auto_generated: boolean;
  discovery_source?: string;
}): void {
  capture('match_join_requested', props);
}

export function matchViewed(props: {
  match_id: string;
  source: string;
  is_auto_generated: boolean;
}): void {
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

export function matchCancelled(props: {
  sport_id: string;
  sport_name: string;
  is_auto_generated: boolean;
}): void {
  capture('match_cancelled', props);
}

export function matchFeedbackSubmitted(props: { sport_id: string; sport_name: string }): void {
  capture('match_feedback_submitted', props);
}

export type MatchOutcomeKind = 'played' | 'mutual_cancel' | 'opponent_no_show';
/** Mirrors cancellation_reason_enum (outcome + invitee-decline values). */
export type CancellationReasonKind =
  | 'weather'
  | 'court_unavailable'
  | 'emergency'
  | 'bad_timing'
  | 'too_far'
  | 'skill_mismatch'
  | 'dont_know_player'
  | 'cost'
  | 'changed_mind'
  | 'other';

export function matchOutcomeSubmitted(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
  outcome: MatchOutcomeKind;
  cancellation_reason?: CancellationReasonKind;
  no_show_count?: number;
  opponent_count: number;
  /** The key conversion signal: outcome='played' on an auto-generated match
   *  means the wizard turned an open match into a real game. */
  is_auto_generated: boolean;
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
  /** 'below' | 'at' | 'above' — how they played vs their rating (null if unanswered) */
  level_assessment: string | null;
}): void {
  capture('opponent_feedback_submitted', props);
}

export function matchFeedbackCompleted(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
  opponent_count: number;
  is_auto_generated: boolean;
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

export function matchDeclined(props: {
  match_id?: string;
  sport_id: string;
  sport_name: string;
  is_auto_generated: boolean;
  /** Optional invitee-decline reason (cancellation_reason_enum subset). */
  decline_reason?: string;
}): void {
  capture('match_declined', props);
}

export type MatchCreationSource =
  | 'plus_menu'
  | 'empty_feed'
  | 'feed_footer'
  | 'home_nearby_empty'
  | 'post_feedback'
  | 'direct';

export function matchCreationStarted(props?: { source?: MatchCreationSource }): void {
  capture('match_creation_started', props);
}

/** Fired when a "create your own game" CTA is pressed on a browse surface. */
export function createGameCtaPressed(props: {
  placement: 'empty_state' | 'feed_footer' | 'feed_header' | 'home_nearby_empty';
  has_active_filters: boolean;
}): void {
  capture('create_game_cta_pressed', props);
}

/** Fired when the post-feedback "what's next" prompt is answered. */
export function postFeedbackPromptAction(props: {
  /** `co_player_game`: tapped an upcoming game belonging to someone they just played with. */
  action: 'create' | 'join' | 'dismiss' | 'co_player_game';
  match_id: string;
  sport_id: string;
  /** Set for `co_player_game`: the game they opened. */
  target_match_id?: string;
  /** Set for `co_player_game`: whether that game is part of a recurring series. */
  target_is_recurring?: boolean;
}): void {
  capture('post_feedback_prompt_action', props);
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

export type SuggestionSource = 'home_carousel' | 'public_matches_feed' | 'sheet' | 'onboarding';

/** The two browsable feed surfaces (subset of SuggestionSource). */
export type FeedSurface = 'home_carousel' | 'public_matches_feed';

/** Canonical property payload shared by the three match_suggestion_* events. */
export function buildSuggestionEventProps(
  suggestion: SlotSuggestion,
  source: SuggestionSource,
  sportId?: string,
  sportName?: string
) {
  const dt = suggestion.slot.datetime;
  return {
    source,
    opponent_id: suggestion.opponentId,
    facility_id: suggestion.facility.facilityId,
    slot_start: (dt instanceof Date ? dt : new Date(dt)).toISOString(),
    sport_id: sportId,
    sport_name: sportName,
    score: suggestion.score,
    player_compatibility: suggestion.playerCompatibility,
    facility_affinity: suggestion.facility.facilityAffinity,
    score_history: suggestion.scoreHistory,
    rank: suggestion.rank,
    match_type: suggestion.matchType,
    match_duration: suggestion.matchDuration,
  };
}

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

// ---- Feed Surfaces (Just For You carousel / Public Matches) ----

/** Viewability-gated impression of a real match card (counterpart of
 *  match_suggestion_shown for concrete matches in the two feed surfaces). */
export function matchCardShown(props: {
  match_id: string;
  sport_id: string;
  sport_name: string;
  is_auto_generated: boolean;
  surface: FeedSurface;
  /** 1-indexed position among feed items at impression time. */
  rank?: number;
}): void {
  capture('match_card_shown', props);
}

/** Feed composition the user actually faced, fired once per load signature
 *  (sport/location/filters/search/refresh) after matches AND suggestion
 *  padding settle. */
export function publicMatchesFeedLoaded(props: {
  real_match_count: number;
  suggestion_count: number;
  /** Server-side total for the current filters (all pages). */
  total_match_count?: number;
  has_next_page: boolean;
  active_filter_count: number;
  has_search_query: boolean;
  padded_with_suggestions: boolean;
}): void {
  capture('public_matches_feed_loaded', props);
}

export function feedEmptyStateShown(props: {
  screen: 'public_matches';
  has_active_filters: boolean;
  has_search: boolean;
}): void {
  capture('feed_empty_state_shown', props);
}

export function feedRefreshed(props: { screen: 'home' | 'public_matches' }): void {
  capture('feed_refreshed', props);
}

export function feedPageFetched(props: { screen: 'public_matches'; page_number: number }): void {
  capture('feed_page_fetched', props);
}

/** Scroll-depth summary, fired on each blur of PublicMatches — one screen
 *  visit can emit several rows if the user pushes profiles and comes back
 *  (focus-session semantics). */
export function publicMatchesBrowsed(props: {
  max_index_viewed: number;
  items_total: number;
  pages_fetched: number;
  duration_seconds: number;
}): void {
  capture('public_matches_browsed', props);
}

/** "Home focused with the Just-for-you section settled" — not strict
 *  scrolled-into-view; per-card visibility lives in the impression events. */
export function jfySectionViewed(props: {
  item_count: number;
  match_count: number;
  suggestion_count: number;
  is_empty: boolean;
}): void {
  capture('jfy_section_viewed', props);
}

export function publicMatchesOpened(props: { cta: 'view_all' | 'find_game' | 'deep_link' }): void {
  capture('public_matches_opened', props);
}

export function matchCheckInCompleted(props: {
  sport_id: string;
  sport_name: string;
  is_auto_generated: boolean;
}): void {
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

export function filterApplied(props: {
  filter_type: string;
  value: string;
  screen?: string;
}): void {
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

export function referralInviteOpened(props: {
  source: 'profile_header' | 'actions_sheet' | 'auto_popup';
}): void {
  capture('referral_invite_opened', props);
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
 * Why a device ended up without a stored Expo push token.
 *
 * - `not_physical_device` — simulator/emulator, dev only, never fires in prod
 * - `permission_denied`   — OS notification permission refused (or previously
 *                           refused, so the prompt returns denied immediately)
 * - `token_fetch_failed`  — Expo's token endpoint failed after retries
 * - `missing_player_row`  — the token write matched no player row, because
 *                           onboarding had not created it yet
 * - `write_failed`        — the database write itself errored
 */
export type PushTokenFailureReason =
  | 'not_physical_device'
  | 'permission_denied'
  | 'token_fetch_failed'
  | 'missing_player_row'
  | 'write_failed';

/**
 * Emitted on every completed registration attempt. Paired with
 * `push_token_registered` these give a measurable success rate — the previous
 * Logger.warn paths reached only Sentry breadcrumbs, so silent token loss was
 * invisible in product analytics.
 */
export function pushTokenRegistrationFailed(props: {
  reason: PushTokenFailureReason;
  /** Attempt index within this session, 0 for the first try. */
  attempt: number;
  /** Present for token_fetch_failed and write_failed. */
  message?: string;
}): void {
  capture('push_token_registration_failed', props);
}

export function pushTokenRegistered(props: { attempt: number }): void {
  capture('push_token_registered', props);
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

export function inviteToMatchSent(props: { invite_count: number; match_id?: string }): void {
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

export function pushNotificationOpened(props: {
  type: string;
  notification_id?: string;
  /** Recipient-funnel join key (+ person). Present for match notifications. */
  match_id?: string;
}): void {
  capture('push_notification_opened', props);
}

export function notificationReceived(props: {
  type: string;
  channel: 'push' | 'in_app';
  /** Recipient-funnel join key (+ person). Present for match notifications. */
  match_id?: string;
}): void {
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
    | 'home_favorite_availability'
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

// ---- 1000-player milestone ----

/** The takeover was presented (step 1). */
export function milestoneViewed(): void {
  capture('milestone_1000_viewed');
}

/** The player advanced to a later step. Step 1 -> 2 is the emotion-to-ask rate. */
export function milestoneStepViewed(step: number): void {
  capture('milestone_1000_step_viewed', { step });
}

/** The player completed a share from the takeover. */
export function milestoneShared(props: {
  channel: 'share_sheet' | 'copy_link' | 'copy_code';
}): void {
  capture('milestone_1000_shared', props);
}

/** The player closed the takeover without sharing. `step` is where they left. */
export function milestoneDismissed(props: { step: number }): void {
  capture('milestone_1000_dismissed', props);
}

/** The player opened one of Rallia's social profiles from the final step. */
export function milestoneSocialFollowed(props: { network: string }): void {
  capture('milestone_1000_social_followed', props);
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

// ---- Weekly Check-In Wizard ----
// Funnel: opened → step_completed (×3) → submitted → completed; abandoned on
// exit. All timestamped, so weekly behaviour is sliceable by event time.

export function weeklyCheckinOpened(props: {
  source: string; // 'auto_opener' | 'banner' | 'manual' | 'unknown'
  current_streak: number;
  recap_variant: string; // 'hit' | 'met' | 'miss' | 'frozen' | 'back' | 'first'
  sport: string; // sport mode the wizard is scoped to; 'unknown' if unresolved
}): void {
  capture('weekly_checkin_opened', props);
}

export function weeklyCheckinStepCompleted(props: {
  step_name: string; // 'recap_goal' | 'availability' | 'match_opportunities' | 'match_plan'
  step_index: number;
  availability_cells?: number;
  frequency_goal?: number;
  opportunities_count?: number;
  // match_plan step
  proposals_included?: number;
  proposals_excluded?: number;
  invitees_excluded?: number;
  opted_out?: boolean;
  auto_invite?: boolean;
}): void {
  capture('weekly_checkin_step_completed', props);
}

/**
 * Fired once when the "Games for you" step is presented with ≥ 1 real match —
 * the top of the join funnel for check-in-surfaced public games.
 */
export function weeklyCheckinOpportunitiesViewed(props: {
  opportunities_count: number;
  /** Distinct sports represented in the surfaced matches. */
  sports_count: number;
}): void {
  capture('weekly_checkin_opportunities_viewed', props);
}

/**
 * Fired once when the match-plan step first renders with a settled preview —
 * the top of the confirm funnel for auto-created games + invites.
 */
export function weeklyCheckinPlanViewed(props: {
  proposals_count: number;
  invitees_total: number;
  goal: number;
  committed_count: number;
}): void {
  capture('weekly_checkin_plan_viewed', props);
}

/** A whole proposed game was removed or restored on the plan step. */
export function weeklyCheckinPlanProposalToggled(props: {
  action: 'exclude' | 'restore';
  sport: string;
  match_date: string;
  remaining_included: number;
}): void {
  capture('weekly_checkin_plan_proposal_toggled', props);
}

/** A single invitee was removed or restored on the plan step. */
export function weeklyCheckinPlanInviteeToggled(props: {
  action: 'exclude' | 'restore';
  sport: string;
}): void {
  capture('weekly_checkin_plan_invitee_toggled', props);
}

/** The "don't propose games for me" opt-out was toggled on the plan step. */
export function weeklyCheckinPlanOptOutToggled(props: { enabled: boolean }): void {
  capture('weekly_checkin_plan_opt_out_toggled', props);
}

/** The auto-invite preference was toggled on the plan step. */
export function weeklyCheckinPlanAutoInviteToggled(props: { enabled: boolean }): void {
  capture('weekly_checkin_plan_auto_invite_toggled', props);
}

export function weeklyCheckinSubmitted(props: {
  frequency_goal: number;
  availability_cells: number;
  plan_proposals_included: number;
  plan_invitees_excluded: number;
  opted_out: boolean;
  auto_invite: boolean;
  matches_created: number;
  new_streak: number;
  milestone_reached: boolean;
  freeze_earned: boolean;
}): void {
  capture('weekly_checkin_submitted', props);
}

export function weeklyCheckinSubmitFailed(props: { error: string }): void {
  capture('weekly_checkin_submit_failed', props);
}

export function weeklyCheckinCompleted(props: {
  duration_seconds: number;
  new_streak: number;
}): void {
  capture('weekly_checkin_completed', props);
}

export function weeklyCheckinAbandoned(props: {
  last_step: string;
  step_index: number;
  duration_seconds: number;
}): void {
  capture('weekly_checkin_abandoned', props);
}

// ---- Leagues & Tournaments ----
// Event names follow the lt.<entity>.<verb> taxonomy from
// specs/17-leagues-tournaments/analytics.md (camelCase props per spec).

export function tournamentCreationStarted(props: { sportId: string; sportName: string }): void {
  capture('lt.tournament.creation_started', props);
}

export function tournamentCreationStepCompleted(props: {
  stepIndex: number;
  stepName: 'basics' | 'format' | 'schedule' | 'rules_visibility' | 'payments';
  sportName: string;
}): void {
  capture('lt.tournament.creation_step_completed', props);
}

export function tournamentCreationAbandoned(props: {
  lastStep: number;
  durationSeconds: number;
  sportName: string;
}): void {
  capture('lt.tournament.creation_abandoned', props);
}

export function tournamentCreated(props: {
  tournamentId: string;
  sportId: string;
  sportName: string;
  maxParticipants: number;
  matchFormat: string;
  visibility: string;
}): void {
  capture('lt.tournament.created', props);
}

export function leagueCreated(props: {
  leagueId: string;
  sportId: string;
  joinMode: string;
  visibility: string;
}): void {
  capture('lt.league.created', props);
}

export function leagueViewed(props: {
  leagueId: string;
  userRole: 'organizer' | 'member' | 'pending' | 'visitor';
}): void {
  capture('lt.league.viewed', { tab: 'overview', ...props });
}

export function seasonCreatedAnalytics(props: {
  leagueId: string;
  seasonId: string;
  hasOverride: boolean;
  /** Whether the organizer priced this season — the paid-league pilot's signal. */
  isPaid?: boolean;
  entryFeeCents?: number;
  feePayer?: string;
}): void {
  capture('lt.season.created', props);
}

export function seasonOpenedAnalytics(props: { leagueId: string; seasonId: string }): void {
  capture('lt.season.opened', props);
}

export function seasonClosedAnalytics(props: {
  leagueId: string;
  seasonId: string;
  topRankUserId?: string;
}): void {
  capture('lt.season.closed', props);
}

export function leagueMemberJoinedAnalytics(props: { leagueId: string; viaInvite: boolean }): void {
  capture('lt.league.member_joined', props);
}

export function leagueMemberPendingAnalytics(props: { leagueId: string }): void {
  capture('lt.league.member_pending', props);
}

export function sessionSheetGeneratedAnalytics(props: {
  sessionId: string;
  regenerated: boolean;
}): void {
  capture(props.regenerated ? 'lt.session.sheet_regenerated' : 'lt.session.sheet_generated', props);
}

export function sessionCreatedAnalytics(props: {
  leagueId: string;
  seasonId: string;
  sessionId: string;
}): void {
  capture('lt.session.created', props);
}

export function sessionPublishedAnalytics(props: {
  leagueId: string;
  sessionId: string;
  memberCount: number;
}): void {
  capture('lt.session.published', props);
}

export function sessionConfirmedAnalytics(props: {
  sessionId: string;
  partnerProvided: boolean;
}): void {
  capture('lt.session.confirmed', props);
}

export function sessionDeclinedAnalytics(props: { sessionId: string }): void {
  capture('lt.session.declined', props);
}

export function sessionCancelledAnalytics(props: {
  sessionId: string;
  confirmedCount: number;
}): void {
  capture('lt.session.cancelled', props);
}

export function sessionScoreSubmittedAnalytics(props: { sessionId: string }): void {
  capture('lt.session.match_score_submitted', props);
}

export function tournamentShared(props: {
  tournamentId: string;
  medium: 'link' | 'native' | 'qr' | 'story';
}): void {
  capture('lt.tournament.shared', props);
}

export function tournamentInviteRedeemed(props: {
  tournamentId: string;
  result: 'registered' | 'error';
  errorCode?: string;
}): void {
  capture('lt.tournament.invite_redeemed', props);
}

export function leagueShared(props: {
  leagueId: string;
  medium: 'link' | 'native' | 'qr';
  /** Present when the share was initiated from a session's share action. */
  sessionId?: string;
}): void {
  capture('lt.league.shared', props);
}

export function leagueInviteRedeemed(props: {
  leagueId: string;
  result: 'joined' | 'error';
  errorCode?: string;
}): void {
  capture('lt.league.invite_redeemed', props);
}

// ---- Chat Match Organizer ----
// Funnel: opened → card_posted → vote_cast (×N) → match_created. The card lives
// in small DM/group chats and tournament round chats; opened/card_posted carry
// conversation_type + is_round_chat so the tournament vs casual paths split.
// match_created is the conversion and is keyed on match_id, joining the regular
// match-lifecycle events (organizer games use create_casual_match, so the
// generic match_created does NOT fire — no double counting).

/** Organizer setup opened from a chat (top of funnel / intent). */
export function matchOrganizerOpened(props: {
  conversation_type: string;
  is_round_chat: boolean;
  participant_count: number;
}): void {
  capture('match_organizer_opened', props);
}

/** A votable organizer card was posted into the conversation. */
export function matchOrganizerCardPosted(props: {
  conversation_type: string;
  is_round_chat: boolean;
  sport_id: string;
  format: 'singles' | 'doubles';
  participant_count: number;
  /** Options the organizer actually posted (after deselecting some). */
  options_posted: number;
  /** Options the engine surfaced in the preview. */
  options_available: number;
  /** Posted options backed by a confirmed bookable court (vs usually-free). */
  bookable_count: number;
}): void {
  capture('match_organizer_card_posted', props);
}

/** A participant thumbs-up'd (or removed a vote on) an option. */
export function matchOrganizerVoteCast(props: {
  sport_id: string;
  format: 'singles' | 'doubles';
  participant_count: number;
  option_index: number;
  option_tier: 'bookable' | 'usually_free' | 'custom';
  /** True when the tap removed an existing vote rather than adding one. */
  removed: boolean;
}): void {
  capture('match_organizer_vote_cast', props);
}

/** The conversion: a mutually-agreed option was turned into a real game. */
export function matchOrganizerMatchCreated(props: {
  match_id: string;
  sport_id: string;
  format: 'singles' | 'doubles';
  participant_count: number;
  option_index: number;
  option_tier: 'bookable' | 'usually_free' | 'custom';
  /** Court price of the agreed slot in cents (null when not court-confirmed). */
  price_cents: number | null;
}): void {
  capture('match_organizer_match_created', props);
}

// ---- Store review prompt ----

/**
 * The native store review dialog was requested. Note this is "we asked", not
 * "they saw", and never "they rated": neither store reports the outcome, so
 * conversion is only ever inferable by lining these up against the weekly
 * ratings delta in App Store Connect.
 */
export function reviewPromptRequested(props: {
  trigger: string;
  feedbacks_submitted: number | null;
  prompts_in_window: number | null;
  /**
   * Star rating the player just gave their opponent, when the prompt rode on the
   * feedback flow. Recorded but NEVER gated on: it is sentiment, and selecting
   * who to ask by expected positivity is what both stores prohibit. Here purely
   * so "do happier submitters convert better" can be answered with data.
   */
  opponent_star_rating?: number | null;
}): void {
  capture('review_prompt_requested', props);
}

/**
 * A trigger fired but no prompt was shown. `reason` carries both server rules
 * (throttled_year, not_enough_feedback, open_feedback, recent_bad_experience) and
 * client ones (unsupported, backgrounded), so the two together are the whole
 * funnel: every check emits exactly one of requested or suppressed.
 */
export function reviewPromptSuppressed(props: { trigger: string; reason: string }): void {
  capture('review_prompt_suppressed', props);
}
