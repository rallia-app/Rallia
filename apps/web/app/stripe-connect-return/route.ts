import { NextResponse } from 'next/server';

/**
 * Stripe Connect onboarding return page.
 *
 * Stripe requires an https `return_url`, but the mobile app opens onboarding in
 * an `ASWebAuthenticationSession` (expo-web-browser) that only auto-dismisses
 * when the browser navigates to the app's custom scheme. So this page — hit
 * when Stripe finishes — immediately bounces to `rallia://stripe-connect-return`,
 * which the session intercepts to close the modal and hand control back to the
 * app (TournamentDetail then refetches to clear the payout gate).
 *
 * Rendered only inside the in-app browser, so the app is always installed —
 * no store fallback needed.
 */
const APP_URL = 'rallia://stripe-connect-return';

export function GET(): NextResponse {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rallia</title>
  </head>
  <body style="margin:0;padding:48px 24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#171717;background:#f0fdfa;">
    <p style="font-size:16px;">Opening Rallia… · Ouverture de Rallia…</p>
    <p style="font-size:14px;"><a href="${APP_URL}" style="color:#0d9488;font-weight:600;text-decoration:none;">Return to the app · Retourner à l'application</a></p>
    <script>
      (function () {
        window.location.href = ${JSON.stringify(APP_URL)};
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
