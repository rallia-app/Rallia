import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { WelcomeRecordSchema } from '../schemas.ts';
import { renderWelcomeEmail } from '../templates/welcome.ts';
import type { EmailContent, WelcomeEmailPayload, WelcomeRecord } from '../types.ts';

const NEARBY_RADIUS_KM = 25;

/** Player's sport display names (canonical case, primary first) and their sport ids. */
async function fetchPlayerSports(
  supabase: SupabaseClient,
  userId: string
): Promise<{ sports: string[]; sportIds: string[] }> {
  try {
    const { data } = await supabase
      .from('player_sport')
      .select('is_primary, sport_id, sport(display_name)')
      .eq('player_id', userId)
      .not('is_active', 'is', false);

    if (!Array.isArray(data)) return { sports: [], sportIds: [] };

    const sorted = [...data].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
    const sports: string[] = [];
    const sportIds: string[] = [];
    for (const row of sorted) {
      const sport = Array.isArray(row.sport) ? row.sport[0] : row.sport;
      const name = sport?.display_name;
      if (name) sports.push(String(name));
      if (row.sport_id) sportIds.push(row.sport_id);
    }
    return { sports, sportIds };
  } catch {
    return { sports: [], sportIds: [] };
  }
}

/** Count of courts within NEARBY_RADIUS_KM of the player's home, or null. */
async function fetchNearbyCourtCount(
  supabase: SupabaseClient,
  userId: string,
  sportIds: string[]
): Promise<number | null> {
  if (sportIds.length === 0) return null;
  try {
    const { data: player } = await supabase
      .from('player')
      .select('latitude, longitude')
      .eq('id', userId)
      .single();

    const lat = player?.latitude;
    const lng = player?.longitude;
    if (lat == null || lng == null) return null;

    // Reuse the app's facility search and sum court_count across nearby
    // venues; p_limit is high so nothing within the radius is truncated.
    const { data, error } = await supabase.rpc('search_facilities_nearby', {
      p_sport_ids: sportIds,
      p_latitude: lat,
      p_longitude: lng,
      p_max_distance_km: NEARBY_RADIUS_KM,
      p_limit: 1000,
    });

    if (error || !Array.isArray(data)) return null;
    const total = data.reduce(
      (sum: number, f: { court_count?: number | null }) => sum + (f.court_count ?? 0),
      0
    );
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // If the trigger did not include the profile fields (e.g. manual admin send),
    // fall back to a lookup by user_id.
    if (!firstName || !displayName || !record.preferred_locale) {
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

    const { sports, sportIds } = await fetchPlayerSports(supabase, record.user_id);
    const courtCount = await fetchNearbyCourtCount(supabase, record.user_id, sportIds);

    const baseUrl =
      Deno.env.get('NEXT_PUBLIC_BASE_URL') ||
      Deno.env.get('NEXT_PUBLIC_SITE_URL') ||
      'https://www.rallia.ca';

    // CTAs go through the /api/go bouncer: it opens the mobile app via the
    // rallia:// scheme, or falls back to the website home page on desktop.
    const go = (to: string) => `${baseUrl}/api/go?to=${to}&locale=${encodeURIComponent(locale)}`;

    const payload: WelcomeEmailPayload = {
      type: 'welcome',
      email: record.email,
      firstName,
      displayName,
      sports,
      courtCount,
      profileUrl: go('profile'),
      courtsUrl: go('courts'),
      gamesUrl: go('games'),
    };

    return renderWelcomeEmail(payload, locale);
  }
}
