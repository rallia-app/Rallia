/**
 * First-touch inbound attribution.
 *
 * Wraps `parseUtmParams` (which only knows the 5 UTM keys) and extends it
 * with paid-ad click IDs (gclid/fbclid/msclkid/ttclid) and a document.referrer
 * fallback for organic-social and organic-search visits that arrive without
 * any explicit UTM tag.
 *
 * Inference order (lowest precedence wins):
 *   1. Raw `utm_*` query params (canonical — used as-is when present)
 *   2. Paid-ad click ID present → infer source+medium
 *   3. Offline channel `?type` tag (flyer/poster/social) → infer source+medium
 *   4. `document.referrer` host matches a known network → infer source+medium
 *   5. `document.referrer` is any other external host → source='referral',
 *      medium='referral', hostname captured as `referrer_host`
 *
 * Returns `null` only when there's literally nothing to record (no UTM, no
 * click ID, no usable referrer).
 */
import { parseUtmParams } from '@rallia/shared-utils';

export interface InboundAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  utm_id?: string;
  gclid?: string;
  fbclid?: string;
  msclkid?: string;
  ttclid?: string;
  referrer_host?: string;
}

// Hostname patterns → canonical source/medium. Order matters: more specific
// subdomains (l.facebook.com, m.facebook.com) are matched by the broader
// `facebook.com` rule via the `(^|\.)` prefix.
const KNOWN_REFERRERS: ReadonlyArray<readonly [RegExp, { source: string; medium: string }]> = [
  [/(^|\.)instagram\.com$/i, { source: 'instagram', medium: 'social' }],
  [/(^|\.)facebook\.com$/i, { source: 'facebook', medium: 'social' }],
  [/(^|\.)t\.co$/i, { source: 'twitter', medium: 'social' }],
  [/(^|\.)twitter\.com$/i, { source: 'twitter', medium: 'social' }],
  [/(^|\.)x\.com$/i, { source: 'twitter', medium: 'social' }],
  [/(^|\.)tiktok\.com$/i, { source: 'tiktok', medium: 'social' }],
  [/(^|\.)youtube\.com$/i, { source: 'youtube', medium: 'social' }],
  [/(^|\.)linkedin\.com$/i, { source: 'linkedin', medium: 'social' }],
  [/(^|\.)reddit\.com$/i, { source: 'reddit', medium: 'social' }],
  [/(^|\.)google\.[a-z.]+$/i, { source: 'google', medium: 'organic' }],
  [/(^|\.)bing\.com$/i, { source: 'bing', medium: 'organic' }],
  [/(^|\.)duckduckgo\.com$/i, { source: 'duckduckgo', medium: 'organic' }],
] as const;

const INTERNAL_HOST = /(^|\.)rallia\.app$/i;

export function inferInboundAttribution(
  search: string,
  referrer: string,
  currentHost: string
): InboundAttribution | null {
  const utm = parseUtmParams(search);
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  const gclid = params.get('gclid') ?? undefined;
  const fbclid = params.get('fbclid') ?? undefined;
  const msclkid = params.get('msclkid') ?? undefined;
  const ttclid = params.get('ttclid') ?? undefined;
  const utm_id = params.get('utm_id') ?? undefined;

  const result: InboundAttribution = { ...(utm ?? {}) };
  if (gclid) result.gclid = gclid;
  if (fbclid) result.fbclid = fbclid;
  if (msclkid) result.msclkid = msclkid;
  if (ttclid) result.ttclid = ttclid;
  if (utm_id) result.utm_id = utm_id;

  // Tier 2: infer from paid-ad click ID when no explicit utm_source.
  if (!result.utm_source) {
    if (gclid) {
      result.utm_source = 'google_ads';
      result.utm_medium = result.utm_medium ?? 'cpc';
    } else if (fbclid) {
      result.utm_source = 'meta_ads';
      result.utm_medium = result.utm_medium ?? 'paid_social';
    } else if (msclkid) {
      result.utm_source = 'bing_ads';
      result.utm_medium = result.utm_medium ?? 'cpc';
    } else if (ttclid) {
      result.utm_source = 'tiktok';
      result.utm_medium = result.utm_medium ?? 'paid_social';
    }
  }

  // Tier 3: offline channels self-tag via ?type on the QR (flyer/poster/social).
  // They land with no UTM, no click ID, and no referrer, so synthesize a
  // canonical source/medium from the type param.
  if (!result.utm_source) {
    const type = params.get('type');
    if (type === 'flyer' || type === 'poster') {
      result.utm_source = type;
      result.utm_medium = 'qr';
    } else if (type === 'social') {
      result.utm_source = 'social';
      result.utm_medium = 'social';
    }
  }

  // Tier 4 + 5: referrer-based inference.
  if (!result.utm_source && referrer) {
    try {
      const refUrl = new URL(referrer);
      const isInternal =
        INTERNAL_HOST.test(refUrl.hostname) ||
        refUrl.hostname.toLowerCase() === currentHost.toLowerCase();
      if (!isInternal) {
        for (const [pattern, attribution] of KNOWN_REFERRERS) {
          if (pattern.test(refUrl.hostname)) {
            result.utm_source = attribution.source;
            result.utm_medium = attribution.medium;
            result.referrer_host = refUrl.hostname;
            break;
          }
        }
        if (!result.utm_source) {
          result.utm_source = 'referral';
          result.utm_medium = 'referral';
          result.referrer_host = refUrl.hostname;
        }
      }
    } catch {
      // Malformed referrer URL — skip.
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
