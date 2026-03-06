import { createClient } from '@/lib/supabase/server';
import { generateUrlSafeToken } from '@/utils/invitation';
import { NextRequest, NextResponse } from 'next/server';
import * as z from 'zod';

const RequestSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'manager', 'staff', 'member']),
  organizationId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const json = await request.json();
    const data = RequestSchema.parse(json);

    // Verify user has permission to invite (must be owner or admin of the organization)
    const { data: membership, error: membershipError } = await supabase
      .from('organization_member')
      .select('role')
      .eq('organization_id', data.organizationId)
      .eq('user_id', user.id)
      .is('left_at', null)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'You are not a member of this organization' },
        { status: 403 }
      );
    }

    // Only owners and admins can invite
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only owners and admins can invite members' },
        { status: 403 }
      );
    }

    // Admins can only invite staff and members, not other admins
    if (membership.role === 'admin' && data.role === 'admin') {
      return NextResponse.json({ error: 'Admins cannot invite other admins' }, { status: 403 });
    }

    // Check if email is already a member of this organization
    const { data: existingProfile } = await supabase
      .from('profile')
      .select('id')
      .eq('email', data.email)
      .single();

    if (existingProfile) {
      const { data: existingMember } = await supabase
        .from('organization_member')
        .select('id')
        .eq('organization_id', data.organizationId)
        .eq('user_id', existingProfile.id)
        .is('left_at', null)
        .single();

      if (existingMember) {
        return NextResponse.json(
          { error: 'This user is already a member of your organization' },
          { status: 400 }
        );
      }
    }

    // Check for existing pending invitation
    const { data: existingInvitation } = await supabase
      .from('invitation')
      .select('id')
      .eq('email', data.email)
      .eq('organization_id', data.organizationId)
      .eq('status', 'pending')
      .single();

    if (existingInvitation) {
      return NextResponse.json(
        { error: 'An invitation has already been sent to this email' },
        { status: 400 }
      );
    }

    // Generate invitation token
    const token = generateUrlSafeToken();

    // Fetch inviter's locale for the invitation email
    const { data: inviterProfile } = await supabase
      .from('profile')
      .select('preferred_locale')
      .eq('id', user.id)
      .single();

    // Create invitation in database
    const { data: invitation, error: invitationError } = await supabase
      .from('invitation')
      .insert({
        email: data.email,
        role: 'organization_member',
        organization_id: data.organizationId,
        token,
        inviter_id: user.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { org_role: data.role, locale: inviterProfile?.preferred_locale || 'en-US' },
        source: 'manual',
        status: 'pending',
      })
      .select()
      .single();

    if (invitationError) {
      console.error('Invitation error:', invitationError);
      return NextResponse.json(
        { error: invitationError.message || 'Failed to create invitation' },
        { status: 500 }
      );
    }

    // TODO: Send invitation email via Supabase Edge Function
    // For now, the invitation is created and can be viewed in the pending list

    return NextResponse.json(
      {
        success: true,
        invitation,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Invitation error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET endpoint to fetch pending invitations for an organization
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

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Verify user is a member of the organization
    const { data: membership, error: membershipError } = await supabase
      .from('organization_member')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .is('left_at', null)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'You are not a member of this organization' },
        { status: 403 }
      );
    }

    // Fetch pending invitations
    const { data: invitations, error: invitationsError } = await supabase
      .from('invitation')
      .select(
        `
        id,
        email,
        status,
        created_at,
        expires_at,
        metadata,
        inviter:inviter_id (
          display_name
        )
      `
      )
      .eq('organization_id', organizationId)
      .eq('role', 'organization_member')
      .in('status', ['pending', 'expired'])
      .order('created_at', { ascending: false });

    if (invitationsError) {
      console.error('Error fetching invitations:', invitationsError);
      return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
    }

    return NextResponse.json({ invitations }, { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE endpoint to revoke an invitation
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const invitationId = searchParams.get('invitationId');

    if (!invitationId) {
      return NextResponse.json({ error: 'Invitation ID is required' }, { status: 400 });
    }

    // Get the invitation to check organization
    const { data: invitation, error: invitationError } = await supabase
      .from('invitation')
      .select('organization_id')
      .eq('id', invitationId)
      .single();

    if (invitationError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    if (!invitation.organization_id) {
      return NextResponse.json({ error: 'Invalid invitation' }, { status: 400 });
    }

    // Verify user has permission (owner or admin)
    const { data: membership, error: membershipError } = await supabase
      .from('organization_member')
      .select('role')
      .eq('organization_id', invitation.organization_id)
      .eq('user_id', user.id)
      .is('left_at', null)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'You are not a member of this organization' },
        { status: 403 }
      );
    }

    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only owners and admins can revoke invitations' },
        { status: 403 }
      );
    }

    // Revoke the invitation (using 'cancelled' status as that's the closest available)
    const { error: updateError } = await supabase
      .from('invitation')
      .update({
        status: 'cancelled',
        revoked_at: new Date().toISOString(),
        revoked_by: user.id,
      })
      .eq('id', invitationId);

    if (updateError) {
      console.error('Error revoking invitation:', updateError);
      return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
