import { NextResponse, type NextRequest } from 'next/server';

import { detectPlatform } from '@/lib/referral-tracking';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-urls';

// Maps an email CTA `?to=` value to an in-app screen path (React Navigation
// linking config in apps/mobile) used to build the `rallia://` deep link.
const SCREEN_BY_TARGET: Record<string, string> = {
  profile: 'profile',
  courts: 'courts',
  games: 'home/public-matches',
};

const LOCALES = ['en-US', 'fr-CA'];
const DEFAULT_LOCALE = 'en-US';

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

  const screen = SCREEN_BY_TARGET[searchParams.get('to') ?? ''];
  const platform = detectPlatform(request.headers.get('user-agent') ?? '');

  // Unknown target or desktop visitor: send them to the website home page.
  if (!screen || platform === null) {
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }

  const appUrl = `rallia://${screen}?src=welcome_email`;
  const storeUrl = platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
  const isFr = locale.startsWith('fr');

  const html = `<!doctype html>
<html lang="${isFr ? 'fr' : 'en'}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rallia</title>
  </head>
  <body style="margin:0;padding:48px 24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#171717;background:#f0fdfa;">
    <p style="font-size:16px;">${isFr ? 'Ouverture de Rallia…' : 'Opening Rallia…'}</p>
    <p style="font-size:14px;"><a href="${appUrl}" style="color:#0d9488;font-weight:600;text-decoration:none;">${isFr ? "Ouvrir l'application" : 'Open the app'}</a></p>
    <script>
      (function () {
        var app = ${JSON.stringify(appUrl)};
        var store = ${JSON.stringify(storeUrl)};
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
