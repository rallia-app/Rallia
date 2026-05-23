/**
 * Builds a Universal Link URL with attribution context appended.
 *
 * `ph_did` is the PostHog distinct_id captured on the web (via the ph_did
 * cookie). The mobile app parses it out of the incoming URL in
 * `handleDeepLink` and aliases the visitor's anonymous web profile to the
 * authenticated user before calling `identify()`. UTM params come along for
 * the same ride so PostHog person properties stay coherent.
 *
 * Pass a path like `/match/abc` or a full URL like `https://rallia.app/games`;
 * relative paths return relative URLs, absolute paths preserve their origin.
 */

import type { UtmParams } from '@rallia/shared-utils';

export interface UniversalLinkContext {
  did?: string | null;
  utm?: UtmParams | null;
  /** Extra query params (e.g. `?type=...&id=...` already on the URL). */
  extra?: Record<string, string | undefined> | null;
}

export function buildUniversalLink(path: string, ctx: UniversalLinkContext = {}): string {
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
  const url = new URL(path, isAbsolute ? undefined : 'https://placeholder.invalid');

  // Preserve any existing query, then layer attribution on top.
  if (ctx.did) url.searchParams.set('ph_did', ctx.did);
  if (ctx.utm) {
    for (const [key, value] of Object.entries(ctx.utm)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  if (ctx.extra) {
    for (const [key, value] of Object.entries(ctx.extra)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  if (isAbsolute) return url.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}
