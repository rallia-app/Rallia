import { hasOrganizationMembership } from '@/lib/supabase/check-organization';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

export default async function PostAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const supabase = await createClient();
  const locale = await getLocale();

  // Check if user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // If not authenticated, redirect to sign-in
  if (authError || !user) {
    redirect(`/${locale}/sign-in`);
  }

  // Get token query parameter
  const params = await searchParams;
  const token = params.token?.trim();

  // Only process invitation if token is provided and non-empty
  if (token && token.length > 0) {
    const { data: invitation, error: invitationError } = await supabase
      .from('invitation')
      .select('*')
      .eq('token', token)
      .single();

    // Only treat as error if we have a token but can't find the invitation
    if (invitationError || !invitation) {
      console.error('Error fetching invitation:', invitationError);
      redirect(`/${locale}/sign-in?error=invitation_not_found`);
    }

    // Validate invitation email matches user email
    if (invitation.email !== user.email) {
      console.error('Invitation email does not match user email');
      redirect(`/${locale}/sign-in?error=email_mismatch`);
    }

    // Check if invitation has been revoked
    if (invitation.revoked_at) {
      console.error('Invitation has been revoked');
      redirect(`/${locale}/sign-in?error=invitation_revoked`);
    }

    // Check if invitation has expired
    if (invitation.expires_at < new Date().toISOString()) {
      console.error('Invitation has expired');
      redirect(`/${locale}/sign-in?error=invitation_expired`);
    }

    // Check if invitation has already been accepted
    if (invitation.status === 'accepted') {
      console.error('Invitation has already been accepted');
      // Already accepted, check if user has org membership and redirect accordingly
      const hasOrg = await hasOrganizationMembership(user.id);
      redirect(hasOrg ? `/${locale}/dashboard` : `/${locale}/sign-in?error=already_accepted`);
    }

    // Only accept pending or sent invitations
    if (invitation.status !== 'pending' && invitation.status !== 'sent') {
      console.error('Invitation is not in a valid state:', invitation.status);
      redirect(`/${locale}/sign-in?error=invalid_invitation_status`);
    }

    // Process organization member invitation
    if (invitation.role === 'organization_member' && invitation.organization_id) {
      // Get the org_role from metadata (uses member_role enum: owner, admin, manager, staff, member)
      const orgRole =
        invitation.metadata &&
        typeof invitation.metadata === 'object' &&
        'org_role' in invitation.metadata
          ? String(invitation.metadata.org_role)
          : 'member';

      // Check if user is already a member of this organization
      const { data: existingMember } = await supabase
        .from('organization_member')
        .select('id')
        .eq('organization_id', invitation.organization_id)
        .eq('user_id', user.id)
        .is('left_at', null)
        .single();

      if (existingMember) {
        // Already a member, just update the invitation using service role client
        const adminClient = createServiceRoleClient();
        const { error: updateError } = await adminClient
          .from('invitation')
          .update({
            status: 'accepted',
            accepted_at: new Date().toISOString(),
            invited_user_id: user.id,
          })
          .eq('id', invitation.id);

        if (updateError) {
          console.error('Error updating invitation status:', updateError);
        }

        // Member exists, redirect to dashboard
        redirect(`/${locale}/dashboard`);
      }

      // Use service role client for trusted server-side invitation processing
      // This bypasses RLS since we've already validated the invitation
      const adminClient = createServiceRoleClient();

      // Create new organization member record
      // Uses member_role enum: owner, admin, manager, staff, member
      const validRoles = ['owner', 'admin', 'manager', 'staff', 'member'] as const;
      type MemberRole = (typeof validRoles)[number];
      const dbRole: MemberRole = validRoles.includes(orgRole as MemberRole)
        ? (orgRole as MemberRole)
        : 'member';

      const { data: member, error: memberError } = await adminClient
        .from('organization_member')
        .insert({
          organization_id: invitation.organization_id,
          user_id: user.id,
          role: dbRole,
          invited_by: invitation.inviter_id,
        })
        .select()
        .single();

      if (memberError) {
        console.error('Error creating organization member:', memberError);
        redirect(`/${locale}/sign-in?error=member_creation_failed`);
      }

      if (member) {
        // Update invitation status to accepted
        const { error: updateError } = await adminClient
          .from('invitation')
          .update({
            status: 'accepted',
            accepted_at: new Date().toISOString(),
            invited_user_id: user.id,
          })
          .eq('id', invitation.id);

        if (updateError) {
          console.error('Error updating invitation status:', updateError);
          // Don't redirect on update error, member is already created
        }

        // Successfully created member and updated invitation
        redirect(`/${locale}/dashboard`);
      }
    }

    // If we reach here, the invitation exists but doesn't match expected criteria
    redirect(`/${locale}/sign-in?error=invalid_invitation`);
  }

  // No token provided, check if user has organization membership
  const hasOrg = await hasOrganizationMembership(user.id);

  // Redirect based on organization membership
  if (hasOrg) {
    redirect(`/${locale}/dashboard`);
  } else {
    redirect(`/${locale}/onboarding`);
  }
}
