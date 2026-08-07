import { NextResponse, type NextRequest } from 'next/server';
import type { UtmParams } from '@rallia/shared-utils';

import { logReferralClick } from '@/lib/referral-tracking';
import type { InvitationType } from '@/lib/store-urls';

const INVITATION_TYPES: ReadonlySet<InvitationType> = new Set([
  'referral',
  'match',
  'group',
  'community',
  'tournament',
  'flyer',
  'poster',
  'social',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

function pickUtm(raw: unknown): (UtmParams & { referrer_host?: string }) | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const out: UtmParams & { referrer_host?: string } = {};
  for (const key of [...UTM_KEYS, 'referrer_host'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) out[key] = value.slice(0, 200);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Client-side landing-click logger. Landing pages used to log the click
 * during SSR, which forced them into dynamic rendering — they are now
 * ISR-cached, so the browser reports the click here instead. Bots that
 * don't run JS (link-preview crawlers) no longer inflate click counts.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const invitationType = body.invitationType as InvitationType;
  if (!INVITATION_TYPES.has(invitationType)) {
    return NextResponse.json({ error: 'invalid invitationType' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.slice(0, 40) : '';
  const targetId =
    typeof body.targetId === 'string' && UUID_RE.test(body.targetId) ? body.targetId : undefined;
  const webDistinctId =
    typeof body.webDistinctId === 'string' ? body.webDistinctId.slice(0, 100) : undefined;

  const userAgent = request.headers.get('user-agent') ?? '';
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';

  try {
    await logReferralClick(
      code,
      ip,
      userAgent,
      invitationType,
      targetId,
      webDistinctId,
      pickUtm(body.utm)
    );
  } catch {
    // Click logging is best-effort — never surface an error to the landing page.
  }

  return new NextResponse(null, { status: 204 });
}
