/**
 * Web analytics — thin typed wrapper around posthog-js.
 *
 * Convention: event names are snake_case, verb-past-tense, prefixed by domain
 * (`download_dialog_opened`, `donate_amount_selected`). Property names are
 * snake_case. Keeps the vocabulary aligned with mobile's services/analytics.ts
 * so HogQL queries can join events across platforms.
 *
 * SSR-safe: capture() is a no-op on the server (posthog-js is browser-only).
 * Autocapture handles pageviews, link clicks, button clicks, and scroll
 * depth — only call these helpers when there's a property autocapture can't
 * infer from the DOM (placement, amount, channel, etc).
 */

import posthog from 'posthog-js';

import type { RatingOption } from '@/lib/match-smoke-test/constants';

type Properties = Record<string, unknown>;

function capture(event: string, properties?: Properties): void {
  if (typeof window === 'undefined') return;
  posthog.capture(event, properties);
}

// ---- Download funnel ----

export type DownloadDialogPlacement = 'hero' | 'header';

export function downloadDialogOpened(props: { placement: DownloadDialogPlacement }): void {
  capture('download_dialog_opened', props);
}

export function downloadDialogViewed(props: { placement: DownloadDialogPlacement }): void {
  capture('download_dialog_viewed', props);
}

export type AppStorePlacement =
  | 'hero'
  | 'download_dialog'
  | 'match_page'
  | 'invite_page'
  | 'join_dialog';

export function appStoreClicked(props: {
  store: 'app_store' | 'play_store';
  placement: AppStorePlacement;
  match_id?: string;
  invitation_code?: string;
}): void {
  capture('app_store_clicked', props);
}

// ---- /donate revenue funnel ----

export function donateAmountSelected(props: {
  amount_cents: number;
  currency: string;
  is_custom: boolean;
}): void {
  capture('donate_amount_selected', props);
}

export function donateIntentCreated(props: { amount_cents: number; currency: string }): void {
  capture('donate_intent_created', props);
}

export function donateCompleted(props: { amount_cents: number; currency: string }): void {
  capture('donate_completed', props);
}

export function donateFailed(props: {
  amount_cents: number;
  currency: string;
  stage: 'intent_create' | 'payment_confirm';
}): void {
  capture('donate_failed', props);
}

// ---- /find-a-match smoke test funnel ----

export type MatchSmokeTestRating = RatingOption;
export type MatchSmokeTestTimeSlot = string;
export type MatchSmokeTestLocationType = 'address';
export type MatchSmokeTestFormat = 'singles' | 'doubles';
export type MatchSmokeTestNature = 'casual' | 'competitive';
export type MatchSmokeTestPlanTier = 'single' | 'pack_3' | 'sub_monthly';

type MatchSmokeTestPaymentProps = {
  rating: MatchSmokeTestRating;
  plan_tier: MatchSmokeTestPlanTier;
  amount_cents: number;
  currency: string;
  credits: number | null;
};

export function matchSmokeTestViewed(): void {
  capture('match_smoke_test_viewed');
}

export function matchSmokeTestFormSubmitted(props: {
  rating: MatchSmokeTestRating;
  match_format: MatchSmokeTestFormat;
  match_nature: MatchSmokeTestNature;
  time_slot: MatchSmokeTestTimeSlot;
  location_type: MatchSmokeTestLocationType;
  has_postal_code: boolean;
  geolocation_granted: boolean;
}): void {
  capture('match_smoke_test_form_submitted', props);
}

export function matchSmokeTestSearchStarted(props: {
  rating: MatchSmokeTestRating;
  time_slot: MatchSmokeTestTimeSlot;
}): void {
  capture('match_smoke_test_search_started', props);
}

export function matchSmokeTestMatchFound(props: {
  rating: MatchSmokeTestRating;
  time_slot: MatchSmokeTestTimeSlot;
  player_template_id: string;
  distance_km: number;
}): void {
  capture('match_smoke_test_match_found', props);
}

export function matchSmokeTestPromiseViewed(props: { rating: MatchSmokeTestRating }): void {
  capture('match_smoke_test_promise_viewed', props);
}

export function matchSmokeTestPromiseContinued(props: { rating: MatchSmokeTestRating }): void {
  capture('match_smoke_test_promise_continued', props);
}

export function matchSmokeTestUnlockClicked(props: { rating: MatchSmokeTestRating }): void {
  capture('match_smoke_test_unlock_clicked', props);
}

export function matchSmokeTestPlanPickerViewed(props: { rating: MatchSmokeTestRating }): void {
  capture('match_smoke_test_plan_picker_viewed', props);
}

export function matchSmokeTestPlanSelected(props: MatchSmokeTestPaymentProps): void {
  capture('match_smoke_test_plan_selected', props);
}

export function matchSmokeTestSubscriptionInterest(props: { rating: MatchSmokeTestRating }): void {
  capture('match_smoke_test_subscription_interest', props);
}

export function matchSmokeTestCheckoutStarted(props: MatchSmokeTestPaymentProps): void {
  capture('match_smoke_test_checkout_started', props);
}

export function matchSmokeTestCheckoutViewed(props: MatchSmokeTestPaymentProps): void {
  capture('match_smoke_test_checkout_viewed', props);
}

export function matchSmokeTestCompleted(props: MatchSmokeTestPaymentProps): void {
  capture('match_smoke_test_completed', props);
}

export function matchSmokeTestFailed(
  props: MatchSmokeTestPaymentProps & {
    stage: 'intent_create' | 'payment_confirm';
  }
): void {
  capture('match_smoke_test_failed', props);
}

export function matchSmokeTestPhoneStepViewed(props: {
  rating: MatchSmokeTestRating;
  payment_intent_id: string;
}): void {
  capture('match_smoke_test_phone_step_viewed', props);
}

export function matchSmokeTestPhoneCodeSent(props: {
  rating: MatchSmokeTestRating;
  payment_intent_id: string;
}): void {
  capture('match_smoke_test_phone_code_sent', props);
}

export function matchSmokeTestPhoneVerified(props: {
  rating: MatchSmokeTestRating;
  payment_intent_id: string;
}): void {
  capture('match_smoke_test_phone_verified', props);
}

export function matchSmokeTestDone(props: {
  rating: MatchSmokeTestRating;
  payment_intent_id: string;
}): void {
  capture('match_smoke_test_done', props);
}

// ---- Deep-link landings ----

export type InvitationLandingType =
  | 'referral'
  | 'match'
  | 'group'
  | 'community'
  | 'flyer'
  | 'poster'
  | 'social';

export type InvitationLandingSurface = 'invite' | 'match' | 'community_join';
export type InvitationLandingPlatform = 'ios' | 'android' | 'desktop';

export function inviteLandingViewed(props: {
  surface: InvitationLandingSurface;
  invitation_type: InvitationLandingType;
  platform: InvitationLandingPlatform;
  code?: string;
  target_id?: string;
}): void {
  capture('invite_landing_viewed', props);
}

// ---- /games public match discovery ----

export function publicMatchShareClicked(props: {
  match_id: string;
  share_channel: 'native_share' | 'clipboard';
}): void {
  capture('public_match_share_clicked', props);
}

export function joinMatchDialogViewed(props: { match_id: string }): void {
  capture('join_match_dialog_viewed', props);
}

// ---- Web join onboarding funnel ----

export function webJoinStarted(props: { match_id: string; sport_slug?: string }): void {
  capture('web_join_started', props);
}

export function webJoinCompleted(props: {
  match_id: string;
  join_status: string;
  existing_user?: boolean;
}): void {
  capture('web_join_completed', props);
}
