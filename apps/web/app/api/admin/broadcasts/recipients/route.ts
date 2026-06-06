import {
  countSegmentRecipients,
  getAuthedAdminBroadcastDb,
  parseSegmentFromQuery,
} from '@/lib/admin/broadcasts';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/admin/broadcasts/recipients?sportId=&city=&locale=&activeWithinDays=&onlySubscribers=
 * Returns the eligible recipient count for the given segment filters so the
 * compose UI can show a live "this reaches N people" estimate before sending.
 */
export async function GET(request: NextRequest) {
  try {
    const { adminDb, error } = await getAuthedAdminBroadcastDb();
    if (error || !adminDb) {
      return NextResponse.json({ error }, { status: error === 'Unauthorized' ? 401 : 403 });
    }

    const filters = parseSegmentFromQuery(new URL(request.url).searchParams);
    const count = await countSegmentRecipients(adminDb, filters);
    return NextResponse.json({ count });
  } catch (err) {
    console.error('[Admin Broadcasts Recipients GET]', err);
    return NextResponse.json({ error: 'Failed to count recipients' }, { status: 500 });
  }
}
