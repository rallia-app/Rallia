import { createClient } from '@supabase/supabase-js';
import { NotificationRecordSchema } from '../schemas.ts';
import { renderNotificationEmail } from '../templates/notification.ts';
import type { EmailContent, NotificationEmailPayload, NotificationRecord } from '../types.ts';

export class NotificationHandler {
  validate(payload: unknown): NotificationRecord {
    return NotificationRecordSchema.parse(payload);
  }

  async getRecipient(record: NotificationRecord): Promise<string> {
    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user email from auth.users (profiles table doesn't have email)
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(
      record.user_id
    );

    if (authError || !authUser?.user?.email) {
      console.error('Error fetching user email:', authError);
      throw new Error('Failed to fetch user email for notification');
    }

    return authUser.user.email;
  }

  async getContent(record: NotificationRecord): Promise<EmailContent> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user email
    const email = await this.getRecipient(record);

    // Fetch preferred locale from profile
    const { data: profile } = await supabase
      .from('profile')
      .select('preferred_locale')
      .eq('id', record.user_id)
      .single();

    const locale = profile?.preferred_locale || 'en-US';

    // Build processed payload
    const payload: NotificationEmailPayload = {
      type: 'notification',
      email,
      notificationType: record.notification_type,
      title: record.title,
      body: record.body || undefined,
      payload: record.payload || undefined,
    };

    return renderNotificationEmail(payload, locale);
  }
}
