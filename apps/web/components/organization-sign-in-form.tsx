'use client';

import { useAuth, type OAuthProvider } from '@rallia/shared-hooks';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';

type AuthState = 'initial' | 'email-sent' | 'loading' | 'error';

export function OrganizationSignInForm({
  initialError,
  initialEmail,
  successPath = '/sign-in/post-auth',
  next,
  title,
  description,
  variant = 'card',
}: {
  initialError?: string;
  initialEmail?: string;
  /**
   * 'card' renders the standalone bordered card the org flow uses. 'plain' drops the
   * card chrome so a hosting page (the player sign-in hero) can own the surface.
   */
  variant?: 'card' | 'plain';
  /**
   * Heading copy. Defaults to the organization wording; the player app passes the
   * `auth.*` strings mobile's sign-in already uses so the two read the same.
   */
  title?: string;
  description?: string;
  /**
   * Where to land after OTP verification. Defaults to the org post-auth handler, which
   * provisions organization_member from an invitation token. The player app has no such
   * step and points straight at /app.
   */
  successPath?: string;
  /**
   * Forwarded to /api/auth/callback for the OAuth round trip, which resolves it to a
   * same-origin path before redirecting.
   */
  next?: string;
}) {
  const t = useTranslations('signIn');
  const locale = useLocale();
  // Use SSR-aware Supabase client for proper cookie handling
  const supabase = useMemo(() => createClient(), []);
  const { signInWithProvider, signInWithEmail, verifyOtp } = useAuth({
    client: supabase,
  });
  const searchParams = useSearchParams();

  const token = searchParams.get('token');

  const [email, setEmail] = useState(initialEmail ?? '');
  const [otp, setOtp] = useState('');
  const [authState, setAuthState] = useState<AuthState>('initial');
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialError ? decodeURIComponent(initialError) : null
  );
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);

  const handleOAuthSignIn = async (provider: 'google' | 'azure' | 'facebook') => {
    setLoadingProvider(provider);
    setErrorMessage(null);

    // Build callback URL with token if present
    const callbackUrl = new URL('/api/auth/callback', window.location.origin);
    if (token) {
      callbackUrl.searchParams.set('invitation_token', token);
    }
    if (next) {
      callbackUrl.searchParams.set('next', next);
    }

    const result = await signInWithProvider(provider, {
      redirectTo: callbackUrl.toString(),
    });

    if (!result.success) {
      setErrorMessage(result.error?.message ?? t('unexpectedError'));
      setLoadingProvider(null);
    }
    // OAuth redirect will happen automatically on success
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (authState === 'initial') {
      // Send OTP
      setAuthState('loading');

      // Build callback URL with token if present
      const callbackUrl = new URL('/api/auth/callback', window.location.origin);
      if (token) {
        callbackUrl.searchParams.set('invitation_token', token);
      }
      // Covers the case where the player clicks the emailed link instead of typing the
      // code; the in-tab OTP path lands via successPath below.
      if (next) {
        callbackUrl.searchParams.set('next', next);
      }

      const result = await signInWithEmail(email, {
        emailRedirectTo: callbackUrl.toString(),
        data: { locale },
      });

      if (!result.success) {
        setErrorMessage(result.error?.message ?? t('failedToSendOtp'));
        setAuthState('initial');
      } else {
        setAuthState('email-sent');
      }
    } else if (authState === 'email-sent') {
      // Verify OTP
      if (!otp || otp.length !== 6) {
        setErrorMessage(t('invalidOtpCode'));
        return;
      }

      setAuthState('loading');

      const result = await verifyOtp(email, otp);

      if (!result.success) {
        setErrorMessage(result.error?.message ?? t('failedToVerifyOtp'));
        setAuthState('email-sent');
      } else {
        // Full document load rather than router.push + refresh.
        //
        // A client-side push reuses the router cache, and the destination was very
        // likely visited moments ago while signed out — /app answers an anonymous
        // request with a redirect to this page, so the cached entry for it is that
        // redirect, not the app. Pushing then renders the stale payload and the
        // player lands on a blank screen until they reload by hand. Firing refresh()
        // straight after push also races the navigation it is meant to revalidate.
        //
        // Signing in is a once-per-session transition, so paying for one real
        // navigation buys a guaranteed-fresh cookie and server render. This is what
        // the OAuth path already does implicitly via /api/auth/callback.
        const target = `${successPath}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
        window.location.assign(`/${locale}${target}`);
      }
    }
  };

  const isEmailLoading = authState === 'loading' && !loadingProvider;
  const isGoogleLoading = loadingProvider === 'google';
  // const isFacebookLoading = loadingProvider === 'facebook'; // Facebook auth commented out
  const isAnyOAuthLoading = isGoogleLoading; // was: isGoogleLoading || isFacebookLoading

  const formBody = (
    <>
      {errorMessage && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {authState === 'email-sent' && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 text-sm text-green-800 dark:text-green-200">
          {t('otpSentMessage')}
        </div>
      )}

      {/* OAuth Buttons */}
      {authState === 'initial' && (
        <>
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => handleOAuthSignIn('google')}
              disabled={isAnyOAuthLoading}
            >
              {isGoogleLoading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <svg className="mr-2 size-4" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              )}
              {t('signInWithGoogle')}
            </Button>

            {/* Facebook auth commented out - re-enable by uncommenting and restoring isFacebookLoading / isAnyOAuthLoading
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => handleOAuthSignIn('facebook')}
                disabled={isAnyOAuthLoading}
              >
                {isFacebookLoading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <svg className="mr-2 size-4" viewBox="0 0 24 24" fill="currentColor">
                    <path
                      d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
                      fill="#1877F2"
                    />
                  </svg>
                )}
                {t('signInWithFacebook')}
              </Button>
              */}
          </div>

          <div className="relative flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs uppercase text-muted-foreground whitespace-nowrap">
              {t('or')}
            </span>
            <Separator className="flex-1" />
          </div>
        </>
      )}

      {/* Email OTP Form */}
      <form onSubmit={handleEmailSubmit} className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="email"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {t('emailLabel')}
          </label>
          <div className="relative">
            <Input
              id="email"
              type="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={authState === 'email-sent' || isEmailLoading}
              required
            />
          </div>
        </div>

        {authState === 'email-sent' && (
          <div className="space-y-2">
            <label
              htmlFor="otp"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {t('otpLabel')}
            </label>
            <Input
              id="otp"
              type="text"
              placeholder={t('otpPlaceholder')}
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
              disabled={isEmailLoading}
              maxLength={6}
              className="text-center text-lg tracking-widest"
              required
            />
            <p className="text-xs text-muted-foreground">{t('otpHint')}</p>
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full bg-[var(--secondary-500)] hover:bg-[var(--secondary-600)] dark:bg-[var(--secondary-500)] dark:hover:bg-[var(--secondary-600)]"
          disabled={isEmailLoading || isAnyOAuthLoading}
        >
          {isEmailLoading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t('loading')}
            </>
          ) : authState === 'email-sent' ? (
            t('verifyOtp')
          ) : (
            t('sendOtp')
          )}
        </Button>

        {authState === 'email-sent' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setAuthState('initial');
              setOtp('');
              setErrorMessage(null);
            }}
          >
            {t('changeEmail')}
          </Button>
        )}
      </form>
    </>
  );

  if (variant === 'plain') {
    return (
      <div className="w-full">
        <div className="mb-8 space-y-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            {title ?? t('title')}
          </h1>
          <p className="text-muted-foreground">{description ?? t('description')}</p>
        </div>
        <div className="space-y-4">{formBody}</div>
      </div>
    );
  }

  return (
    <Card className="w-full max-w-md border-[var(--secondary-200)] dark:border-[var(--secondary-800)]">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{title ?? t('title')}</CardTitle>
        <CardDescription className="text-base">{description ?? t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{formBody}</CardContent>
    </Card>
  );
}
