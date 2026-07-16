/**
 * Resolves the HMAC secret used to verify one-click email unsubscribe tokens.
 *
 * Must match the resolution order used by the edge senders that SIGN the tokens
 * (send-morning-digest / send-broadcast / send-notification): they prefer
 * JWT_SECRET because Supabase reserves the `SUPABASE_` prefix — SUPABASE_JWT_SECRET
 * cannot be set as (nor is auto-injected into) an edge function, so the signers
 * always fall through to JWT_SECRET. Set JWT_SECRET to the same value in both the
 * Vercel web env and the Supabase function secrets. SUPABASE_JWT_SECRET stays as a
 * legacy fallback for environments where the two were already aligned.
 */
export function getUnsubscribeTokenSecret(): string | undefined {
  return process.env.JWT_SECRET ?? process.env.SUPABASE_JWT_SECRET;
}
