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
  | 'player_page'
  | 'invite_page'
  | 'join_dialog'
  | 'web_book';

export function appStoreClicked(props: {
  store: 'app_store' | 'play_store';
  placement: AppStorePlacement;
  match_id?: string;
  facility_id?: string;
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

// ---- Deep-link landings ----

export type InvitationLandingType =
  | 'referral'
  | 'match'
  | 'group'
  | 'community'
  | 'tournament'
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

// ---- /courts public facility discovery ----

export function courtsBookClicked(props: { facility_id: string; has_slot: boolean }): void {
  capture('courts_book_clicked', props);
}

/** Visitor changed which time slot they're booking, from the gate page. */
export function courtsSlotSwitched(props: { facility_id: string; court_count: number }): void {
  capture('courts_slot_switched', props);
}

/** Visitor toggled sports on a facility that offers more than one. */
export function courtsSportSwitched(props: { facility_id: string; sport_slug: string }): void {
  capture('courts_sport_switched', props);
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

// ---- Web booking onboarding funnel ----
//
// Mirrors the web_join_* funnel so both gated surfaces are comparable:
// started (gate opened) → completed (signup finished or already onboarded) →
// redirected (the visitor actually left for the provider's booking page).

export function webBookStarted(props: { facility_id: string; has_slot: boolean }): void {
  capture('web_book_started', props);
}

export function webBookCompleted(props: {
  facility_id: string;
  existing_user: boolean;
  has_slot: boolean;
}): void {
  capture('web_book_completed', props);
}

export function webBookRedirected(props: { facility_id: string; has_slot: boolean }): void {
  capture('web_book_redirected', props);
}
