import { isAdmin } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

export default async function AdminPostAuthPage({
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

  // If not authenticated, redirect to admin sign-in
  if (authError || !user) {
    redirect(`/${locale}/admin/sign-in`);
  }

  // Get token query parameter
  const params = await searchParams;
  const token = params.token;

  if (token) {
    const { data: invitation, error: invitationError } = await supabase
      .from('invitation')
      .select('*')
      .eq('token', token)
      .single();

    if (invitationError) {
      console.error('Error fetching invitation:', invitationError);
      redirect(`/${locale}/admin/sign-in?error=invitation_not_found`);
    }

    if (!invitation) {
      redirect(`/${locale}/admin/sign-in?error=invitation_not_found`);
    }

    // Validate invitation email matches user email
    if (invitation.email !== user.email) {
      console.error('Invitation email does not match user email');
      redirect(`/${locale}/admin/sign-in?error=email_mismatch`);
    }

    // Check if invitation has been revoked
    if (invitation.revoked_at) {
      console.error('Invitation has been revoked');
      redirect(`/${locale}/admin/sign-in?error=invitation_revoked`);
    }

    // Check if invitation has expired
    if (invitation.expires_at < new Date().toISOString()) {
      console.error('Invitation has expired');
      redirect(`/${locale}/admin/sign-in?error=invitation_expired`);
    }

    // Check if invitation has already been accepted
    if (invitation.status === 'accepted') {
      console.error('Invitation has already been accepted');
      // Already accepted, check if user is admin and redirect accordingly
      const userIsAdmin = await isAdmin(user.id);
      redirect(
        userIsAdmin
          ? `/${locale}/admin/dashboard`
          : `/${locale}/admin/sign-in?error=already_accepted`
      );
    }

    // Only accept pending or sent invitations
    if (invitation.status !== 'pending' && invitation.status !== 'sent') {
      console.error('Invitation is not in a valid state:', invitation.status);
      redirect(`/${locale}/admin/sign-in?error=invalid_invitation_status`);
    }

    // Process admin invitation
    if (invitation.role === 'admin' && invitation.admin_role) {
      // First check if admin already exists
      const { data: existingAdmin } = await supabase
        .from('admin')
        .select('*')
        .eq('id', user.id)
        .single();

      if (existingAdmin) {
        // Admin already exists, just update the invitation
        const { error: updateError } = await supabase
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

        // Admin exists, redirect to dashboard
        redirect(`/${locale}/admin/dashboard`);
      }

      // Create new admin record
      const { data: admin, error: adminError } = await supabase
        .from('admin')
        .insert({
          id: user.id,
          role: invitation.admin_role,
        })
        .select()
        .single();

      if (adminError) {
        console.error('Error creating admin:', adminError);
        redirect(`/${locale}/admin/sign-in?error=admin_creation_failed`);
      }

      if (admin) {
        // Update invitation status to accepted
        const { error: updateError } = await supabase
          .from('invitation')
          .update({
            status: 'accepted',
            accepted_at: new Date().toISOString(),
            invited_user_id: user.id,
          })
          .eq('id', invitation.id);

        if (updateError) {
          console.error('Error updating invitation status:', updateError);
          // Don't redirect on update error, admin is already created
        }

        // Successfully created admin and updated invitation
        redirect(`/${locale}/admin/dashboard`);
      }
    }

    // If we reach here, the invitation exists but doesn't match expected criteria
    redirect(`/${locale}/admin/sign-in?error=invalid_invitation`);
  }

  // No token provided, check if user is already an admin
  const userIsAdmin = await isAdmin(user.id);

  // If not an admin, redirect to regular sign-in
  if (!userIsAdmin) {
    await supabase.auth.signOut();
    redirect(`/${locale}/admin/sign-in?error=not_admin`);
  }

  // User is authenticated and is an admin, redirect to dashboard
  redirect(`/${locale}/admin/dashboard`);
}
