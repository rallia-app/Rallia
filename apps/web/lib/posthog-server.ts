/**
 * Server-side PostHog capture over plain HTTP. posthog-js is browser-only and
 * the web app has no posthog-node, so route handlers that answer with a
 * redirect (no page, no JS) report through here.
 *
 * Anonymous by construction: a fresh random distinct id per event and no person
 * profile, so nothing here identifies or follows a visitor. Best-effort: a
 * failed capture must never affect the response.
 */
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_INGEST_HOST = (
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'
).replace(/\/$/, '');

// Link-preview fetchers and crawlers request URLs nobody tapped.
const BOT_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|embedly|headless|lighthouse|curl|wget|python-requests|node-fetch|axios|go-http-client/i;

export function isLikelyBot(userAgent: string): boolean {
  return userAgent.length === 0 || BOT_RE.test(userAgent);
}

export async function captureServerEvent(
  event: string,
  properties: Record<string, string | number | boolean | null>
): Promise<void> {
  if (!POSTHOG_KEY || !POSTHOG_INGEST_HOST.startsWith('http')) return;
  try {
    await fetch(`${POSTHOG_INGEST_HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: crypto.randomUUID(),
        properties: { ...properties, $process_person_profile: false },
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Best-effort.
  }
}
