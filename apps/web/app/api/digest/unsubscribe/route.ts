import { createServiceRoleClient } from '@/lib/supabase/server';
import { getUnsubscribeTokenSecret } from '@/lib/unsubscribe-token';
import { jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const JWT_AUDIENCE = 'morning_digest_unsub';

async function verifyToken(token: string, secret: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      audience: JWT_AUDIENCE,
    });
    if (typeof payload.sub !== 'string') return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

async function unsubscribe(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('notification_preference').upsert(
    {
      user_id: userId,
      notification_type: 'morning_digest',
      channel: 'email',
      enabled: false,
    },
    { onConflict: 'user_id,notification_type,channel' }
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function getSiteOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
}

/**
 * Handles the GET click flow — typical "user clicks the link in the email
 * footer". Verifies the token, flips the preference, then redirects to a
 * confirmation page.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = new URL(req.url).searchParams.get('token');
  const secret = getUnsubscribeTokenSecret();
  const origin = getSiteOrigin(req);

  if (!secret) {
    return NextResponse.redirect(`${origin}/digest/unsubscribe?status=error`);
  }
  if (!token) {
    return NextResponse.redirect(`${origin}/digest/unsubscribe?status=error`);
  }

  const verified = await verifyToken(token, secret);
  if (!verified) {
    return NextResponse.redirect(`${origin}/digest/unsubscribe?status=error`);
  }

  const result = await unsubscribe(verified.userId);
  return NextResponse.redirect(
    `${origin}/digest/unsubscribe?status=${result.ok ? 'success' : 'error'}`
  );
}

/**
 * Handles RFC 8058 one-click unsubscribe — Gmail / Apple Mail trigger this
 * via the `List-Unsubscribe-Post` header. Returns 200 on success without a
 * redirect (the mail client doesn't render the body).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = new URL(req.url).searchParams.get('token');
  const secret = getUnsubscribeTokenSecret();

  if (!secret || !token) {
    return NextResponse.json({ ok: false, error: 'Missing token or secret' }, { status: 400 });
  }

  const verified = await verifyToken(token, secret);
  if (!verified) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
  }

  const result = await unsubscribe(verified.userId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
