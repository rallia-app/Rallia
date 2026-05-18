'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { readDistinctIdCookie, readUtmCookie } from '@/lib/utm-cookie';

const APP_ID = '6760482014';
const BASE_HOST = 'https://rallia.app';

/**
 * Renders Safari's native Smart App Banner with attribution-rich
 * `app-argument`. When an installed-app user taps the banner, iOS opens
 * the Rallia app and hands it the `app-argument` URL via Universal Link;
 * the app's `handleDeepLink` parses `ph_did` and merges the web visitor's
 * pre-install events into the post-auth user via `posthog.alias`.
 *
 * Client-rendered because the cookies (ph_did, rallia_utm) live in the
 * browser and the current pathname is most reliably available via Next's
 * `usePathname`. React 19 hoists the `<meta>` tag into `<head>` from
 * anywhere in the tree.
 *
 * Smart App Banner only shows in mobile Safari with a verified
 * apple-app-site-association. On desktop Safari or other browsers it's a
 * no-op (the meta tag is rendered but ignored).
 */
export function SmartAppBanner() {
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const [appArgument, setAppArgument] = useState<string>('');

  useEffect(() => {
    const did = readDistinctIdCookie();
    const utm = readUtmCookie();
    const url = new URL(`${BASE_HOST}${pathname}`);

    // Preserve incoming query params (utm_*, etc.) so the post-install app
    // gets the exact context the user was viewing.
    if (searchParams) {
      for (const [key, value] of searchParams.entries()) {
        url.searchParams.set(key, value);
      }
    }
    if (did) url.searchParams.set('ph_did', did);
    if (utm) {
      for (const [key, value] of Object.entries(utm)) {
        if (value && !url.searchParams.has(key)) {
          url.searchParams.set(key, value);
        }
      }
    }

    setAppArgument(url.toString());
  }, [pathname, searchParams]);

  const content = appArgument
    ? `app-id=${APP_ID}, app-argument=${appArgument}`
    : `app-id=${APP_ID}`;

  return <meta name="apple-itunes-app" content={content} />;
}
