import { NextResponse } from 'next/server';

import { signAttributionToken, type ReferralContext } from '@/lib/attribution-token';

/**
 * Mints a signed attribution token from the visitor's PostHog distinct_id
 * and inbound UTM context. The token is written to the clipboard
 * synchronously inside the App Store click handler so that, post-install,
 * the iOS app can read it on first launch and merge the visitor's
 * pre-install web events into their new mobile profile.
 *
 * Signed server-side so the HMAC secret never ships to the browser.
 * 15-minute expiry is enforced at verify time.
 */
export const dynamic = 'force-dynamic';

interface SignRequest {
  did?: string;
  utm?: Record<string, string>;
  referral?: ReferralContext;
}

export async function POST(request: Request) {
  let body: SignRequest;
  try {
    body = (await request.json()) as SignRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.did || typeof body.did !== 'string') {
    return NextResponse.json({ error: 'did is required' }, { status: 400 });
  }

  try {
    const referral =
      body.referral && typeof body.referral === 'object' && Object.keys(body.referral).length > 0
        ? body.referral
        : undefined;
    const token = signAttributionToken({
      did: body.did,
      utm: body.utm && typeof body.utm === 'object' ? body.utm : {},
      ts: Date.now(),
      ...(referral ? { referral } : {}),
    });
    return NextResponse.json({ token, expires_in_ms: 15 * 60 * 1000 });
  } catch (err) {
    console.error('[attribution/sign] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to sign token' },
      { status: 500 }
    );
  }
}
