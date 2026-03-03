import { createClient } from '@supabase/supabase-js';
import { InvitationRecordSchema } from '../schemas.ts';
import { renderInvitationEmail } from '../templates/invitation.ts';
import type { EmailContent, InvitationEmailPayload, InvitationRecord } from '../types.ts';

export class InvitationHandler {
  validate(payload: unknown): InvitationRecord {
    return InvitationRecordSchema.parse(payload);
  }

  async getRecipient(record: InvitationRecord): Promise<string> {
    if (!record.email) {
      throw new Error('Email is required for invitation emails');
    }
    return record.email;
  }

  async getContent(record: InvitationRecord): Promise<EmailContent> {
    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Determine locale: invitation metadata > inviter profile > en-US
    let locale = 'en-US';
    if (record.metadata && typeof record.metadata === 'object' && 'locale' in record.metadata) {
      locale = String(record.metadata.locale);
    } else {
      // Fall back to inviter's preferred locale
      const { data: inviterProfile } = await supabase
        .from('profile')
        .select('first_name, last_name, display_name, preferred_locale')
        .eq('id', record.inviter_id)
        .single();

      if (inviterProfile?.preferred_locale) {
        locale = inviterProfile.preferred_locale;
      }

      // Use fetched profile for name too (avoid a second query)
      const inviterName =
        inviterProfile?.display_name ||
        (inviterProfile?.first_name && inviterProfile?.last_name
          ? `${inviterProfile.first_name} ${inviterProfile.last_name}`
          : inviterProfile?.first_name) ||
        'a team member';

      return this.buildContent(record, inviterName, locale, supabase);
    }

    // If locale was in metadata, we still need inviter name
    const { data: inviterProfile, error: inviterError } = await supabase
      .from('profile')
      .select('first_name, last_name, display_name')
      .eq('id', record.inviter_id)
      .single();

    if (inviterError) {
      console.error('Error fetching inviter profile:', inviterError);
      throw new Error('Failed to fetch inviter information');
    }

    const inviterName =
      inviterProfile?.display_name ||
      (inviterProfile?.first_name && inviterProfile?.last_name
        ? `${inviterProfile.first_name} ${inviterProfile.last_name}`
        : inviterProfile?.first_name) ||
      'a team member';

    return this.buildContent(record, inviterName, locale, supabase);
  }

  private async buildContent(
    record: InvitationRecord,
    inviterName: string,
    locale: string,
    supabase: ReturnType<typeof createClient>
  ): Promise<EmailContent> {
    // Fetch organization info if this is an organization invitation
    let organizationName: string | undefined;
    let orgRole: string | undefined;
    if (record.organization_id) {
      const { data: organization, error: orgError } = await supabase
        .from('organization')
        .select('name')
        .eq('id', record.organization_id)
        .single();

      if (orgError) {
        console.error('Error fetching organization:', orgError);
      } else {
        organizationName = organization?.name;
      }

      if (record.metadata && typeof record.metadata === 'object' && 'org_role' in record.metadata) {
        orgRole = String(record.metadata.org_role);
      }
    }

    // Construct sign-up URL
    const baseUrl =
      Deno.env.get('NEXT_PUBLIC_BASE_URL') ||
      Deno.env.get('NEXT_PUBLIC_SITE_URL') ||
      'https://www.rallia.ca';

    let rolePath = 'sign-in';
    if (record.role === 'admin') {
      rolePath = 'admin/sign-in';
    } else if (record.role === 'organization_member' && record.organization_id) {
      rolePath = 'sign-in';
    }

    const signUpUrl = `${baseUrl}/${rolePath}?token=${record.token}`;

    // Format expiration date using locale-aware formatting
    const expiresAt = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(record.expires_at));

    const payload: InvitationEmailPayload = {
      type: 'invitation',
      email: record.email!,
      role: record.role,
      adminRole: record.admin_role || undefined,
      signUpUrl,
      inviterName,
      expiresAt,
      organizationName,
      orgRole,
    };

    return renderInvitationEmail(payload, locale);
  }
}
