import { createClient } from '@supabase/supabase-js';

import { WelcomeRecordSchema } from '../schemas.ts';
import { renderWelcomeEmail } from '../templates/welcome.ts';
import type { EmailContent, WelcomeEmailPayload, WelcomeRecord } from '../types.ts';

export class WelcomeHandler {
  validate(payload: unknown): WelcomeRecord {
    return WelcomeRecordSchema.parse(payload);
  }

  async getRecipient(record: WelcomeRecord): Promise<string> {
    if (!record.email) {
      throw new Error('Email is required for welcome emails');
    }
    return record.email;
  }

  async getContent(record: WelcomeRecord): Promise<EmailContent> {
    let firstName = record.first_name;
    let displayName = record.display_name;
    let locale = record.preferred_locale || 'en-US';

    // If the trigger did not include the profile fields (e.g. manual admin send),
    // fall back to a lookup by user_id.
    if (!firstName || !displayName || !record.preferred_locale) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: profile } = await supabase
        .from('profile')
        .select('first_name, display_name, preferred_locale')
        .eq('id', record.user_id)
        .single();

      if (profile) {
        firstName = firstName || profile.first_name;
        displayName = displayName || profile.display_name;
        locale = record.preferred_locale || profile.preferred_locale || 'en-US';
      }
    }

    const baseUrl =
      Deno.env.get('NEXT_PUBLIC_BASE_URL') ||
      Deno.env.get('NEXT_PUBLIC_SITE_URL') ||
      'https://www.rallia.ca';

    const payload: WelcomeEmailPayload = {
      type: 'welcome',
      email: record.email,
      firstName,
      displayName,
      openAppUrl: baseUrl,
    };

    return renderWelcomeEmail(payload, locale);
  }
}
