import type { Match } from '@rallia/shared-types';
import { createServiceRoleClient } from '@/lib/supabase/server';

/** Shape returned by the Supabase query with selected relation columns */
export type MatchWithRelations = Match & {
  sport: Pick<{ name: string; slug: string }, 'name' | 'slug'> | null;
  facility: Pick<{ name: string; city: string }, 'name' | 'city'> | null;
  court: Pick<{ name: string }, 'name'> | null;
  min_rating_score: Pick<{ label: string }, 'label'> | null;
  participants:
    | {
        id: string;
        status: string;
        is_host: boolean;
        player_id: string;
        player: {
          profile: {
            display_name: string | null;
            profile_picture_url: string | null;
          } | null;
        } | null;
      }[]
    | null;
};

export async function getMatch(id: string): Promise<MatchWithRelations | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('match')
    .select(
      '*, sport:sport_id (name, slug), facility:facility_id (name, city), court:court_id (name), min_rating_score:min_rating_score_id (label), participants:match_participant (id, status, is_host, player_id, player:player_id (profile!player_id_fkey (display_name, profile_picture_url)))'
    )
    .eq('id', id)
    .single();
  return data as MatchWithRelations | null;
}
