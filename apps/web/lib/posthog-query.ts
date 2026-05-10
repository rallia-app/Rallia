/**
 * Server-only HogQL client. Used by admin analytics routes to run aggregate
 * queries against PostHog's `events` table without bundling the analytics
 * SDK on the server or shipping a personal API key to the client.
 *
 * Auth: requires POSTHOG_API_KEY (personal API key, read scope) and
 * POSTHOG_PROJECT_ID. Both are server-only env vars; never expose them.
 */

import 'server-only';

const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST?.replace(/\/$/, '') ?? 'https://us.posthog.com';
const POSTHOG_API_KEY = process.env.POSTHOG_PERSONAL_KEY;
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID;

const REQUEST_TIMEOUT_MS = 15_000;

export class PostHogQueryError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PostHogQueryError';
  }
}

/**
 * Run a HogQL query and return rows mapped from PostHog's `{columns, results}`
 * response into typed objects keyed by column name.
 */
export async function runHogQL<TRow extends Record<string, unknown>>(
  query: string
): Promise<TRow[]> {
  if (!POSTHOG_API_KEY || !POSTHOG_PROJECT_ID) {
    throw new PostHogQueryError(
      'PostHog query not configured: POSTHOG_PERSONAL_KEY and POSTHOG_PROJECT_ID must be set'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${POSTHOG_API_KEY}`,
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new PostHogQueryError(`PostHog query failed (${res.status}): ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as { columns?: string[]; results?: unknown[][] };
    const columns = json.columns ?? [];
    const rows = json.results ?? [];
    return rows.map(row => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = row[i];
      }
      return obj as TRow;
    });
  } catch (err) {
    if (err instanceof PostHogQueryError) throw err;
    throw new PostHogQueryError('PostHog query request failed', err);
  } finally {
    clearTimeout(timeout);
  }
}

export type WindowParam = '24h' | '7d' | '30d' | '90d';

const WINDOW_TO_HOURS: Record<WindowParam, number> = {
  '24h': 24,
  '7d': 7 * 24,
  '30d': 30 * 24,
  '90d': 90 * 24,
};

export function windowToHours(window: WindowParam): number {
  return WINDOW_TO_HOURS[window];
}

export function isWindowParam(value: string): value is WindowParam {
  return value === '24h' || value === '7d' || value === '30d' || value === '90d';
}
