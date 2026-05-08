/**
 * PostHog server-side capture helper for Supabase Edge Functions.
 *
 * Fires events to PostHog's HTTP capture API directly (no SDK required —
 * keeps the Deno bundle lean). Failures are swallowed: analytics must never
 * break the calling function's primary work.
 *
 * Required env: POSTHOG_API_KEY (PostHog project API key).
 * Optional env: POSTHOG_HOST (defaults to https://us.i.posthog.com).
 */

const POSTHOG_HOST = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
const POSTHOG_API_KEY = Deno.env.get('POSTHOG_API_KEY');

export interface CaptureProps {
  /** The user's PostHog distinct_id — usually the Supabase user.id. */
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

/**
 * Fire a single event to PostHog. Returns silently on any failure so analytics
 * issues never bubble into the caller's success path. Set POSTHOG_API_KEY in
 * the function env to enable; with no key, the call is a no-op.
 */
export async function captureEvent({ distinctId, event, properties }: CaptureProps): Promise<void> {
  if (!POSTHOG_API_KEY) return;
  if (!distinctId) return;

  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_API_KEY,
        event,
        distinct_id: distinctId,
        properties: {
          ...properties,
          $lib: 'supabase-edge-function',
        },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn(
      `[posthog] capture failed for event "${event}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
