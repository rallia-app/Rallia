import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';
const DB_TIMEOUT_MS = 5000;
const HEALTHY_CACHE_CONTROL = 's-maxage=30, stale-while-revalidate=60';

export async function GET() {
  const timestamp = new Date().toISOString();
  const components: Record<string, { status: string; latency_ms: number; error?: string }> = {};

  // Check Supabase DB connectivity with timeout
  const dbStart = Date.now();
  try {
    const supabase = createServiceRoleClient();

    const { error } = await Promise.race([
      supabase.from('sport').select('id').limit(1),
      new Promise<{ error: { message: string } }>((_, reject) =>
        setTimeout(() => reject(new Error('Database health check timed out')), DB_TIMEOUT_MS)
      ),
    ]);

    if (error) {
      components.database = {
        status: 'unhealthy',
        latency_ms: Date.now() - dbStart,
        error: error.message,
      };
    } else {
      components.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
    }
  } catch (err) {
    components.database = {
      status: 'unhealthy',
      latency_ms: Date.now() - dbStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  const overallStatus = Object.values(components).every(c => c.status === 'healthy')
    ? 'healthy'
    : 'unhealthy';

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp,
      commit: COMMIT_SHA,
      components,
    },
    {
      status: overallStatus === 'healthy' ? 200 : 503,
      headers: {
        'Cache-Control': overallStatus === 'healthy' ? HEALTHY_CACHE_CONTROL : 'no-store',
      },
    }
  );
}
