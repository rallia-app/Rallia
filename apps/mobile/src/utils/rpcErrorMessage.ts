/**
 * One place to turn a thrown RPC/service error into user-facing copy.
 *
 * Newer RPCs raise SCREAMING_SNAKE business codes (ALREADY_LINKED); older ones
 * and the client services raise English sentences; Postgres adds its own noise
 * ("duplicate key value…"). Resolution order:
 *   1. the call site's override table (insertion order — list longer codes
 *      before their substrings, e.g. MATCH_ALREADY_LINKED before ALREADY_LINKED)
 *   2. codes every feature shares (auth, organizer gate, stale write, rate limit)
 *   3. anything that still looks like a raw code or database noise → fallback
 *   4. a human-readable sentence passes through unchanged (legacy RPCs raise
 *      real copy; hiding it would lose information)
 */

import type { TranslationKey } from '#/hooks';

type Translator = (key: TranslationKey) => string;

export type RpcErrorOverrides = Record<string, TranslationKey>;

const SHARED_CODE_KEYS: RpcErrorOverrides = {
  NOT_AUTHENTICATED: 'common.rpcErrors.notAuthenticated',
  NOT_ORGANIZER: 'common.rpcErrors.notOrganizer',
  OPTIMISTIC_LOCK_CONFLICT: 'common.rpcErrors.staleWrite',
  RATE_LIMITED: 'common.rpcErrors.rateLimited',
};

// A message that starts with a SCREAMING_SNAKE token is a raw code.
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{3,}/;

// Postgres/PostgREST/transport internals that must never reach a toast.
const DB_NOISE =
  /duplicate key|violates|constraint|deadlock|statement timeout|permission denied|syntax error|PGRST\d|JSON object requested|rows returned|structure of query|Network request failed|Failed to fetch|AbortError|TypeError/i;

export function rpcErrorMessage(
  error: unknown,
  t: Translator,
  fallback: TranslationKey,
  overrides?: RpcErrorOverrides
): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (overrides) {
    for (const [code, key] of Object.entries(overrides)) {
      if (message.includes(code)) return t(key);
    }
  }
  for (const [code, key] of Object.entries(SHARED_CODE_KEYS)) {
    if (message.includes(code)) return t(key);
  }

  if (!message || CODE_SHAPE.test(message) || DB_NOISE.test(message)) return t(fallback);
  return message;
}
