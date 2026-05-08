/**
 * Edge Function auth helper for server-to-server callers (pg_cron, DB triggers).
 *
 * Mirrors `withSupabase({ auth: 'secret:default' })` from `@supabase/server`
 * (https://supabase.com/docs/guides/functions/auth):
 *   - Reads the auto-injected `SUPABASE_SECRET_KEYS` JSON env var.
 *   - Picks the `default` named secret key.
 *   - Validates the request's `apikey` header against it.
 *   - **Fails closed**: returns 500 if the env var isn't provisioned, 401 if
 *     the header is missing or doesn't match. Never silently allows.
 *
 * Caller (cron / trigger) must send `apikey: sb_secret_…` (NOT
 * `Authorization: Bearer …` — that header is reserved for user JWTs per
 * https://supabase.com/docs/guides/getting-started/api-keys).
 */
export function requireSecretApikey(req: Request): Response | null {
  let expectedKey: string | undefined;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    // Prefer the documented `default` named key; fall back to whatever
    // single key is present (some projects don't have the `default` alias).
    expectedKey = keys['default'] ?? Object.values(keys)[0];
  } catch {
    /* Malformed JSON: leave expectedKey undefined → fail closed below. */
  }

  if (!expectedKey) {
    return new Response(
      JSON.stringify({
        error: 'Server misconfigured: SUPABASE_SECRET_KEYS["default"] not available',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const provided = req.headers.get('apikey');
  if (!provided || provided !== expectedKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}
