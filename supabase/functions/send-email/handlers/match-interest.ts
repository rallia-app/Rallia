import { createClient } from '@supabase/supabase-js';

import { MatchInterestRecordSchema } from '../schemas.ts';
import { renderMatchInterestEmail } from '../templates/match-interest.ts';
import type { EmailContent, MatchInterestRecord } from '../types.ts';

export class MatchInterestHandler {
  validate(payload: unknown): MatchInterestRecord {
    return MatchInterestRecordSchema.parse(payload);
  }

  async getRecipient(record: MatchInterestRecord): Promise<string> {
    return record.email;
  }

  async getContent(record: MatchInterestRecord): Promise<EmailContent> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch match details for the email
    const { data: match, error } = await supabase
      .from('match')
      .select('*, sport:sport_id (name), facility:facility_id (name, city)')
      .eq('id', record.match_id)
      .single();

    if (error || !match) {
      console.error('Error fetching match for interest email:', error);
      throw new Error('Failed to fetch match details');
    }

    const sportName = (match.sport as { name: string } | null)?.name ?? 'Game';
    const facility = match.facility as { name: string; city: string } | null;
    const location = facility ? `${facility.name}, ${facility.city}` : match.location_name || 'TBD';

    const dateObj = new Date(`${match.match_date}T${match.start_time}`);
    const matchDate = dateObj.toLocaleDateString('en-US', { dateStyle: 'long' });
    const matchTime = dateObj.toLocaleTimeString('en-US', { timeStyle: 'short' });

    const baseUrl = Deno.env.get('NEXT_PUBLIC_BASE_URL') || 'https://rallia.app';
    const matchUrl = `${baseUrl}/match/${record.match_id}`;

    return renderMatchInterestEmail({
      type: 'match_interest',
      email: record.email,
      name: record.name,
      sportName,
      matchDate,
      matchTime,
      location,
      matchUrl,
    });
  }
}
