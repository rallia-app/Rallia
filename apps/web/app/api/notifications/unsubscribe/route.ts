import { createServiceRoleClient } from '@/lib/supabase/server';
import { jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const JWT_AUDIENCE = 'notification_email_unsub';

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

/**
 * Disable the email channel for every notification type — a true "stop emailing
 * me" unsubscribe. Delegates to the disable_all_email_notifications RPC, which
 * enumerates notification_type_enum so new types are covered automatically.
 */
async function unsubscribe(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.rpc('disable_all_email_notifications', { p_user_id: userId });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function getSiteOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
}

/**
 * GET click flow — user clicks the unsubscribe link in the email footer.
 * Verifies the token, disables email notifications, then redirects to a
 * confirmation page.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = new URL(req.url).searchParams.get('token');
  const secret = process.env.SUPABASE_JWT_SECRET;
  const origin = getSiteOrigin(req);

  if (!secret) {
    return NextResponse.redirect(`${origin}/notifications/unsubscribe?status=error`);
  }
  if (!token) {
    return NextResponse.redirect(`${origin}/notifications/unsubscribe?status=error`);
  }

  const verified = await verifyToken(token, secret);
  if (!verified) {
    return NextResponse.redirect(`${origin}/notifications/unsubscribe?status=error`);
  }

  const result = await unsubscribe(verified.userId);
  return NextResponse.redirect(
    `${origin}/notifications/unsubscribe?status=${result.ok ? 'success' : 'error'}`
  );
}

/**
 * RFC 8058 one-click unsubscribe — Gmail / Apple Mail trigger this via the
 * `List-Unsubscribe-Post` header. Returns 200 on success without a redirect.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = new URL(req.url).searchParams.get('token');
  const secret = process.env.SUPABASE_JWT_SECRET;

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
