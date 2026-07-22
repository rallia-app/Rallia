/**
 * POST /api/stripe/connect
 *
 * Creates a Stripe Express Connect account for an organization
 * and returns the onboarding URL.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getSiteOrigin } from '@/lib/site-origin';
import { createClient } from '@/lib/supabase/server';
import { createConnectAccount, createAccountLink } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get request body
    const body = await request.json();
    const { organizationId } = body;

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Verify user is owner of the organization
    const { data: membership, error: memberError } = await supabase
      .from('organization_member')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership || membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only organization owners can connect Stripe' },
        { status: 403 }
      );
    }

    // Get organization details
    const { data: organization, error: orgError } = await supabase
      .from('organization')
      .select('id, name, email, country')
      .eq('id', organizationId)
      .single();

    if (orgError || !organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Check if organization already has a Stripe account
    const { data: existingAccount } = await supabase
      .from('organization_stripe_account')
      .select('stripe_account_id, onboarding_complete')
      .eq('organization_id', organizationId)
      .single();

    const baseUrl = getSiteOrigin(request);
    const returnUrl = `${baseUrl}/dashboard/settings/payments?stripe_connected=true`;
    const refreshUrl = `${baseUrl}/api/stripe/connect/callback?organization_id=${organizationId}`;

    if (existingAccount) {
      // Account exists, create a new onboarding link if not complete
      if (existingAccount.onboarding_complete) {
        return NextResponse.json(
          { error: 'Stripe account already connected and onboarding complete' },
          { status: 400 }
        );
      }

      // Create new account link for incomplete onboarding
      const onboardingUrl = await createAccountLink(
        existingAccount.stripe_account_id,
        returnUrl,
        refreshUrl,
        'account_onboarding'
      );

      return NextResponse.json({
        success: true,
        onboardingUrl,
        accountId: existingAccount.stripe_account_id,
        isExisting: true,
      });
    }

    // Create new Stripe Connect account
    const result = await createConnectAccount({
      organizationId: organization.id,
      organizationName: organization.name,
      organizationEmail: organization.email || user.email || '',
      country: organization.country || 'CA',
      returnUrl,
      refreshUrl,
    });

    // Store the account ID in the database
    const { error: insertError } = await supabase.from('organization_stripe_account').insert({
      organization_id: organizationId,
      stripe_account_id: result.accountId,
      stripe_account_type: 'express',
      onboarding_complete: false,
      charges_enabled: false,
      payouts_enabled: false,
      default_currency: 'CAD',
    });

    if (insertError) {
      console.error('Error storing Stripe account:', insertError);
      // Don't fail the request, the account was created in Stripe
    }

    return NextResponse.json({
      success: true,
      onboardingUrl: result.onboardingUrl,
      accountId: result.accountId,
      isExisting: false,
    });
  } catch (error) {
    console.error('Error creating Stripe Connect account:', error);
    return NextResponse.json({ error: 'Failed to create Stripe Connect account' }, { status: 500 });
  }
}
