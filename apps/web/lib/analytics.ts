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

// ---- /play lead capture ----

export type PlayerInterestSport = 'tennis' | 'pickleball';

export function playerInterestSportToggled(props: {
  sport: PlayerInterestSport;
  enabled: boolean;
}): void {
  capture('player_interest_sport_toggled', props);
}

export type PlayerInterestValidationError =
  | 'atLeastOneSport'
  | 'tennisRatingRequired'
  | 'tennisFacilityRequired'
  | 'pickleballRatingRequired'
  | 'pickleballFacilityRequired'
  | 'postalCodeInvalid'
  | 'availabilityMinimum';

export function playerInterestFormValidationError(props: {
  error_key: PlayerInterestValidationError;
}): void {
  capture('player_interest_form_validation_error', props);
}

export function playerInterestFormSubmitted(props: {
  plays_tennis: boolean;
  plays_pickleball: boolean;
  tennis_facility_matched: boolean;
  pickleball_facility_matched: boolean;
  availability_slot_count: number;
}): void {
  capture('player_interest_form_submitted', props);
}

export function playerInterestFormDuplicate(): void {
  capture('player_interest_form_duplicate');
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
