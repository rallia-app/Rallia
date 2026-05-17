/**
 * Signed attribution tokens for the Layer-2 clipboard handoff.
 *
 * Flow:
 *   1. Web (in App Store badge onClick) POSTs {did, utm} to /api/attribution/sign.
 *   2. Server returns a base64url-encoded `payload.signature` string.
 *   3. Web synchronously writes `rallia_attrib_v1:<token>` to the clipboard.
 *   4. Mobile (on iOS first launch) detects a clipboard URL pattern silently,
 *      reads the string, and POSTs the token to /api/attribution/verify.
 *   5. Server checks HMAC + expiry, returns the decoded {did, utm} or 401.
 *
 * The HMAC secret is server-only (ATTRIBUTION_SIGNING_KEY env var). Even if
 * the clipboard is hijacked by another app, only Rallia-signed tokens
 * verify. The 15-min expiry prevents replay from stale clipboards.
 */

import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_VERSION = 'v1';
const TOKEN_PREFIX = 'rallia_attrib_';
const MAX_AGE_MS = 15 * 60 * 1000;

export interface AttributionTokenPayload {
  /** PostHog distinct_id from the web visitor. */
  did: string;
  /** UTM/inbound attribution captured on the web at click time. */
  utm: Record<string, string>;
  /** Unix ms when the token was minted. */
  ts: number;
}

function getSecret(): string {
  const key = process.env.ATTRIBUTION_SIGNING_KEY;
  if (!key) {
    throw new Error('ATTRIBUTION_SIGNING_KEY is not configured');
  }
  return key;
}

// Node's native 'base64url' encoding (≥16.0.0) avoids the regex-based
// '+/=' rewriting and removes the ReDoS surface CodeQL flags on `=+$`.
function base64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

export function signAttributionToken(payload: AttributionTokenPayload): string {
  const body = base64urlEncode(JSON.stringify(payload));
  const sig = base64urlEncode(createHmac('sha256', getSecret()).update(body).digest());
  return `${TOKEN_PREFIX}${TOKEN_VERSION}:${body}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: AttributionTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_version' };

export function verifyAttributionToken(raw: string): VerifyResult {
  if (!raw.startsWith(TOKEN_PREFIX)) return { ok: false, reason: 'malformed' };
  const versionAndBody = raw.slice(TOKEN_PREFIX.length);
  const colonIdx = versionAndBody.indexOf(':');
  if (colonIdx === -1) return { ok: false, reason: 'malformed' };
  const version = versionAndBody.slice(0, colonIdx);
  if (version !== TOKEN_VERSION) return { ok: false, reason: 'wrong_version' };

  const rest = versionAndBody.slice(colonIdx + 1);
  const dotIdx = rest.lastIndexOf('.');
  if (dotIdx === -1) return { ok: false, reason: 'malformed' };
  const body = rest.slice(0, dotIdx);
  const sig = rest.slice(dotIdx + 1);

  const expected = createHmac('sha256', getSecret()).update(body).digest();
  let provided: Buffer;
  try {
    provided = base64urlDecode(sig);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: AttributionTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(body).toString('utf8')) as AttributionTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.ts !== 'number' || Date.now() - payload.ts > MAX_AGE_MS) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}
