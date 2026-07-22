import type { NextRequest } from 'next/server';

/**
 * Origin to build absolute URLs against (Stripe `return_url`, post-action
 * redirects). Production pins the canonical domain so links never leak a raw
 * deployment URL; preview and local follow the origin actually being browsed,
 * otherwise a flow started on a preview finishes on production.
 */
export function getSiteOrigin(req: NextRequest | Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_ENV === 'production' && configured) return configured;

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const proto =
      req.headers.get('x-forwarded-proto') ??
      (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
    return `${proto}://${host}`;
  }

  return new URL(req.url).origin;
}
