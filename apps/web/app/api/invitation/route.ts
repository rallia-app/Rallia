import { getAdminRole } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { generateUrlSafeToken } from '@/utils/invitation';
import { NextRequest, NextResponse } from 'next/server';
import * as z from 'zod';

const RequestSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(['player', 'admin', 'organization_member']),
  adminRole: z.enum(['super_admin', 'moderator', 'support']).optional(),
  source: z
    .enum(['manual', 'auto_match', 'invite_list', 'mailing_list', 'growth_prompt'])
    .optional(),
  expiresAt: z.string().optional(),
});

export async function POST(Request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminRole = await getAdminRole(user?.id);

    if (!adminRole || adminRole !== 'super_admin') {
      return NextResponse.json(
        { error: 'You are not authorized to create invitations' },
        { status: 401 }
      );
    }

    const json = await Request.json();
    const data = RequestSchema.parse(json);

    if (!data.email && !data.phone) {
      return NextResponse.json({ error: 'Email or phone is required' }, { status: 400 });
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
        phone: data.phone,
        role: data.role,
        admin_role: data.adminRole,
        token,
        inviter_id: user.id,
        metadata: { locale: inviterProfile?.preferred_locale || 'en-US' },
        expires_at: data.expiresAt
          ? new Date(data.expiresAt).toISOString()
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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

    return NextResponse.json(
      {
        success: true,
        invitation,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Invitation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
