import { isAdmin } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Resolve a `next` path to a SAME-ORIGIN redirect URL, or null if it would
 * leave the app. String-prefix checks aren't enough: `new URL('/\\evil.com',
 * base)` normalizes the backslash and resolves to an external origin, so we
 * compare the resolved origin to the request origin.
 */
function resolveSameOriginNext(nextPath: string | null, base: string): URL | null {
  if (!nextPath || !nextPath.startsWith('/')) return null;
  try {
    const dest = new URL(nextPath, base);
    return dest.origin === new URL(base).origin ? dest : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');
  const redirectParam = searchParams.get('redirect');
  const nextPath = searchParams.get('next')?.trim() || null;
  const invitationToken = searchParams.get('invitation_token')?.trim() || null;

  const supabase = await createClient();

  // Determine redirect paths based on redirect parameter
  const isAdminFlow = redirectParam === 'admin';
  const signInPath = isAdminFlow ? '/admin/sign-in' : '/sign-in';

  // Build post-auth path with invitation token if present and non-empty
  let postAuthPath = isAdminFlow ? '/admin/sign-in/post-auth' : '/sign-in/post-auth';
  if (invitationToken && invitationToken.length > 0) {
    postAuthPath += `?token=${encodeURIComponent(invitationToken)}`;
  }

  // Handle OAuth callback (Google/Microsoft)
  if (code) {
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('OAuth callback error:', error);
      return NextResponse.redirect(
        new URL(`${signInPath}?error=${encodeURIComponent(error.message)}`, request.url)
      );
    }

    // If admin flow, verify admin status before redirecting
    if (isAdminFlow && data.user) {
      // A failed lookup redirects with a retryable message, not "Access denied".
      let userIsAdmin: boolean;
      try {
        userIsAdmin = await isAdmin(data.user.id);
      } catch {
        return NextResponse.redirect(
          new URL(
            `${signInPath}?error=${encodeURIComponent('Unable to verify admin access. Please try again.')}`,
            request.url
          )
        );
      }
      if (!userIsAdmin) {
        return NextResponse.redirect(
          new URL(
            `${signInPath}?error=${encodeURIComponent('Access denied. Admin access required.')}`,
            request.url
          )
        );
      }
    }

    const safeNext = resolveSameOriginNext(nextPath, request.url);
    if (safeNext) {
      return NextResponse.redirect(safeNext);
    }

    // Redirect to appropriate post-auth page
    return NextResponse.redirect(new URL(postAuthPath, request.url));
  }

  // Handle email OTP verification
  if (token_hash && type) {
    const { error, data } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (error) {
      console.error('OTP verification error:', error);
      return NextResponse.redirect(
        new URL(`${signInPath}?error=${encodeURIComponent(error.message)}`, request.url)
      );
    }

    // If admin flow, verify admin status before redirecting
    if (isAdminFlow && data.user) {
      // A failed lookup redirects with a retryable message, not "Access denied".
      let userIsAdmin: boolean;
      try {
        userIsAdmin = await isAdmin(data.user.id);
      } catch {
        return NextResponse.redirect(
          new URL(
            `${signInPath}?error=${encodeURIComponent('Unable to verify admin access. Please try again.')}`,
            request.url
          )
        );
      }
      if (!userIsAdmin) {
        return NextResponse.redirect(
          new URL(
            `${signInPath}?error=${encodeURIComponent('Access denied. Admin access required.')}`,
            request.url
          )
        );
      }
    }

    const safeNext = resolveSameOriginNext(nextPath, request.url);
    if (safeNext) {
      return NextResponse.redirect(safeNext);
    }

    // Redirect to appropriate post-auth page
    return NextResponse.redirect(new URL(postAuthPath, request.url));
  }

  // If no valid callback parameters, redirect to sign-in with error
  return NextResponse.redirect(new URL(`${signInPath}?error=invalid_callback`, request.url));
}
