/**
 * GET /api/stripe/connect/callback
 *
 * Handles the return from Stripe Connect onboarding.
 * This is the refresh URL - called when the user needs to restart onboarding.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getSiteOrigin } from '@/lib/site-origin';
import { createClient } from '@/lib/supabase/server';
import { createAccountLink, getAccountStatus } from '@/lib/stripe';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organization_id');

    if (!organizationId) {
      return NextResponse.redirect(
        new URL('/dashboard/settings/payments?error=missing_organization', request.url)
      );
    }

    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(new URL('/sign-in', request.url));
    }

    // Verify user is owner of the organization
    const { data: membership } = await supabase
      .from('organization_member')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .single();

    if (!membership || membership.role !== 'owner') {
      return NextResponse.redirect(
        new URL('/dashboard/settings/payments?error=not_authorized', request.url)
      );
    }

    // Get existing Stripe account
    const { data: stripeAccount } = await supabase
      .from('organization_stripe_account')
      .select('stripe_account_id')
      .eq('organization_id', organizationId)
      .single();

    if (!stripeAccount) {
      return NextResponse.redirect(
        new URL('/dashboard/settings/payments?error=no_account', request.url)
      );
    }

    // Check account status and update database
    try {
      const status = await getAccountStatus(stripeAccount.stripe_account_id);

      // Update the database with latest status
      await supabase
        .from('organization_stripe_account')
        .update({
          onboarding_complete: status.onboardingComplete,
          charges_enabled: status.chargesEnabled,
          payouts_enabled: status.payoutsEnabled,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', organizationId);

      if (status.onboardingComplete) {
        // Onboarding is complete
        return NextResponse.redirect(
          new URL('/dashboard/settings/payments?stripe_connected=true', request.url)
        );
      }
    } catch {
      // Account status check failed, continue to create new link
      console.error('Failed to check account status');
    }

    // Onboarding not complete, create a new account link
    const baseUrl = getSiteOrigin(request);
    const returnUrl = `${baseUrl}/dashboard/settings/payments?stripe_connected=true`;
    const refreshUrl = `${baseUrl}/api/stripe/connect/callback?organization_id=${organizationId}`;

    const onboardingUrl = await createAccountLink(
      stripeAccount.stripe_account_id,
      returnUrl,
      refreshUrl,
      'account_onboarding'
    );

    return NextResponse.redirect(onboardingUrl);
  } catch (error) {
    console.error('Error in Stripe callback:', error);
    return NextResponse.redirect(
      new URL('/dashboard/settings/payments?error=callback_failed', request.url)
    );
  }
}
