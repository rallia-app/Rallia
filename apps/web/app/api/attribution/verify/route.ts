import { NextResponse } from 'next/server';

import { verifyAttributionToken } from '@/lib/attribution-token';

/**
 * Mobile-side counterpart to /api/attribution/sign. The iOS app POSTs the
 * clipboard token here on first launch; we verify HMAC + expiry and return
 * the decoded {did, utm} payload. Mobile uses `did` to call
 * `posthog.alias(did)` so the post-install user inherits the visitor's
 * web-side attribution.
 *
 * No auth required — the HMAC is the auth. Anyone with a valid signed
 * token may exchange it for its payload (the payload contains no secrets;
 * it's the same data the visitor's browser already had).
 */
export const dynamic = 'force-dynamic';

interface VerifyRequest {
  token?: string;
}

export async function POST(request: Request) {
  let body: VerifyRequest;
  try {
    body = (await request.json()) as VerifyRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.token || typeof body.token !== 'string') {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  try {
    const result = verifyAttributionToken(body.token);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 401 });
    }
    return NextResponse.json({
      did: result.payload.did,
      utm: result.payload.utm,
      ts: result.payload.ts,
    });
  } catch (err) {
    console.error('[attribution/verify] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to verify token' },
      { status: 500 }
    );
  }
}
