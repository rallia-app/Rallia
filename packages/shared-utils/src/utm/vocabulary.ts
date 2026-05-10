/**
 * Canonical UTM vocabulary. Keep this list closed — typos and variants split
 * funnels in PostHog. To add a channel, edit this file and `docs/utm-conventions.md`
 * together so the analytics convention stays the source of truth.
 */

export const UTM_SOURCES = [
  // Social
  'instagram',
  'facebook',
  'tiktok',
  'youtube',
  'twitter',
  'linkedin',
  'reddit',
  // Messaging
  'whatsapp',
  'imessage',
  'sms',
  'email',
  // Owned
  'newsletter',
  'blog',
  'website',
  // Paid
  'google_ads',
  'meta_ads',
  // Partner / event
  'partner',
  'event',
  // App-internal share (user shared a link from inside the app)
  'app_share',
  // Catch-all
  'direct',
  'other',
] as const;

export type UtmSource = (typeof UTM_SOURCES)[number];

export const UTM_MEDIUMS = [
  'social',
  'paid_social',
  'cpc',
  'email',
  'referral',
  'organic',
  'qr',
  'push',
  'in_app',
  'other',
] as const;

export type UtmMedium = (typeof UTM_MEDIUMS)[number];

/**
 * Campaigns are open-ended (one per growth initiative) but should follow
 * `<topic>_<year>[_<variant>]` snake_case, e.g. `friends_family_2026`,
 * `pickleball_launch_2026_q2`. Validate at write time, not at read time.
 */
export type UtmCampaign = string;
