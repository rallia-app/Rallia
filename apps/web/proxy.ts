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

  // This refreshes the auth token if expired
  await supabase.auth.getUser();

  // For API routes, return the response with refreshed cookies only
  if (request.nextUrl.pathname.startsWith('/api')) {
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
    // Match all pathnames except for:
    // - _next (Next.js internals)
    // - _vercel (Vercel internals)
    // - Files with extensions (like favicon.ico)
    '/((?!_next|_vercel|.*\\..*).*)',
  ],
};
