import { NextResponse, type NextRequest } from 'next/server';

import { detectPlatform } from '@/lib/referral-tracking';
import { APP_STORE_URL, buildPlayStoreUrl } from '@/lib/store-urls';

// Maps an email CTA `?to=` value to an in-app screen path (React Navigation
// linking config in apps/mobile) used to build the `rallia://` deep link.
const SCREEN_BY_TARGET: Record<string, string> = {
  profile: 'profile',
  courts: 'courts',
  games: 'home/public-matches',
  tournament: 'tournament',
};

/** Targets whose screen path takes a trailing entity id (`?id=<uuid>`). */
const TARGETS_TAKING_ID = new Set(['tournament']);

const LOCALES = ['en-US', 'fr-CA'];
const DEFAULT_LOCALE = 'en-US';

/**
 * Escape for interpolation into HTML. The values reaching the markup below are
 * already allowlisted, but this response is assembled by hand, so both sinks
 * escape at the point of use rather than trusting a guard further up to stay
 * correct through future edits.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serialize for an inline <script>; `<` prevents a `</script>` breakout. */
function toScriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Attribution tag; kept as the default for the welcome email that predates it. */
const DEFAULT_SRC = 'welcome_email';
const SRC_RE = /^[a-z0-9_]{1,40}$/;

/**
 * Deep-link bouncer for transactional emails (e.g. the welcome email CTAs).
 * Mobile recipients have just onboarded in the app, so open it via the
 * `rallia://` scheme (with a store fallback). Desktop has no app, so the user
 * lands on the website home page.
 */
export function GET(request: NextRequest): NextResponse {
  const { searchParams } = request.nextUrl;

  const localeParam = searchParams.get('locale') ?? '';
  const locale = LOCALES.includes(localeParam) ? localeParam : DEFAULT_LOCALE;

  const target = searchParams.get('to') ?? '';
  const screen = SCREEN_BY_TARGET[target];
  const platform = detectPlatform(request.headers.get('user-agent') ?? '');

  // Entity id is required for targets that route to a specific record, and is
  // uuid-checked so nothing arbitrary can be spliced into the deep link.
  const id = searchParams.get('id') ?? '';
  const needsId = TARGETS_TAKING_ID.has(target);
  const hasValidId = UUID_RE.test(id);

  // Unknown target, missing/invalid id, or desktop visitor: website home page.
  if (!screen || (needsId && !hasValidId) || platform === null) {
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }

  const srcParam = searchParams.get('src') ?? '';
  const src = SRC_RE.test(srcParam) ? srcParam : DEFAULT_SRC;
  const path = needsId ? `${screen}/${id}` : screen;
  const appUrl = `rallia://${path}?src=${src}`;
  // Store fallback fires when the recipient no longer has the app. The
  // Android leg carries the email context in the install referrer so the
  // reinstall still attributes; iOS has no store-URL equivalent.
  const storeUrl =
    platform === 'ios'
      ? APP_STORE_URL
      : buildPlayStoreUrl(undefined, 'referral', undefined, {
          utm: { utm_source: 'email', utm_medium: 'email', utm_campaign: src },
        });
  const isFr = locale.startsWith('fr');

  const html = `<!doctype html>
<html lang="${isFr ? 'fr' : 'en'}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rallia</title>
  </head>
  <body style="margin:0;padding:48px 24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#15211f;background:#f0faf7;">
    <p style="font-size:16px;">${isFr ? 'Ouverture de Rallia…' : 'Opening Rallia…'}</p>
    <p style="font-size:14px;"><a href="${escapeHtml(appUrl)}" style="color:#007a6e;font-weight:600;text-decoration:none;">${isFr ? "Ouvrir l'application" : 'Open the app'}</a></p>
    <script>
      (function () {
        var app = ${toScriptLiteral(appUrl)};
        var store = ${toScriptLiteral(storeUrl)};
        window.location.href = app;
        setTimeout(function () { window.location.href = store; }, 1500);
      })();
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
