import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import type { NextRequest } from 'next/server';

const intlMiddleware = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
  // Add pathname to headers for server components to access
  const pathname = request.nextUrl.pathname;
  const response = intlMiddleware(request);

  // Add pathname to response headers so server components can access it
  response.headers.set('x-pathname', pathname);

  return response;
}

export const config = {
  // Match all pathnames except for
  // - API routes, _next, _vercel
  // - Files with extensions (like favicon.ico)
  matcher: ['/((?!ingest|api|_next|_vercel|.*\\..*).*)'],
};
