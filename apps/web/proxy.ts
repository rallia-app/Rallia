import { createServerClient } from '@supabase/ssr';
import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
  // Refresh Supabase auth session by updating cookies
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the auth token if expired. getClaims() verifies the JWT locally
  // (WebCrypto + cached JWKS) and only hits the network when a refresh is
  // actually needed — Supabase's recommended SSR proxy method, far cheaper
  // than getUser()'s per-request network call. Best-effort: a transient blip
  // shouldn't crash the render, and route handlers re-validate with getUser().
  try {
    await supabase.auth.getClaims();
  } catch (err) {
    console.warn('[proxy] supabase.auth.getClaims() failed:', err);
  }

  // For API routes, Sentry tunnel, and the PostHog ingest proxy, return the
  // response with refreshed cookies only — bypass next-intl so it doesn't
  // prepend `/en-US/` and break the rewrite rules in next.config.ts.
  if (
    request.nextUrl.pathname.startsWith('/api') ||
    request.nextUrl.pathname.startsWith('/monitoring') ||
    request.nextUrl.pathname.startsWith('/ingest')
  ) {
    return supabaseResponse;
  }

  // For non-API routes, apply intl middleware
  const pathname = request.nextUrl.pathname;
  const intlResponse = intlMiddleware(request);

  // Copy Supabase auth cookies to the intl response
  supabaseResponse.cookies.getAll().forEach(cookie => {
    intlResponse.cookies.set(cookie.name, cookie.value, cookie);
  });

  // Add pathname to response headers so server components can access it
  intlResponse.headers.set('x-pathname', pathname);

  return intlResponse;
}

export const config = {
  matcher: [
    // Match page routes only. Everything below handles its own concerns and
    // doesn't need the session-refresh pass here — running it on these was
    // spawning a Fluid invocation (+ Supabase auth call) per request:
    // - api        → route handlers validate auth themselves
    // - ingest     → PostHog proxy rewrite (served at the routing layer, no fn)
    // - monitoring → Sentry browser tunnel
    // - _next / _vercel → framework internals
    // - anything with a file extension (favicon.ico, etc.)
    '/((?!api|_next|_vercel|monitoring|ingest|.*\\..*).*)',
  ],
};
