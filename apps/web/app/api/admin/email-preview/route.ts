import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { allowed } = await requireApiRole(user.id, ['super_admin', 'moderator']);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const template = searchParams.get('template') || '';
    const locale = searchParams.get('locale') || 'en-US';
    const mode = searchParams.get('mode') || 'light';

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey =
      process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 });
    }

    const url = new URL(`${supabaseUrl}/functions/v1/email-preview`);
    url.searchParams.set('template', template);
    url.searchParams.set('locale', locale);
    url.searchParams.set('mode', mode);
    url.searchParams.set('raw', '1');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${anonKey}`,
      },
    });

    if (!response.ok) {
      return new NextResponse('Failed to fetch email preview', {
        status: response.status,
      });
    }

    const html = await response.text();

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Email preview error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
