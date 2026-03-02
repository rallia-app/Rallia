// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MatchGenerationResult {
  player_id: string
  player_name: string
  matches_created: number
}

interface GeneratedMatch {
  match_id: string
  match_date: string
  start_time: string
  end_time: string
  sport_name: string
  facility_name: string
  host_name: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role for admin operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse request body for options
    let targetMatchCount = 10
    let specificPlayerId: string | null = null
    
    if (req.method === 'POST') {
      try {
        const body = await req.json()
        targetMatchCount = body.target_match_count || 10
        specificPlayerId = body.player_id || null
      } catch {
        // Body parsing failed, use defaults
      }
    }

    console.log(`[generate-weekly-matches] Starting match generation`)
    console.log(`[generate-weekly-matches] Target matches per player: ${targetMatchCount}`)
    
    let results: MatchGenerationResult[] = []
    let totalMatchesCreated = 0

    if (specificPlayerId) {
      // Generate for a specific player
      console.log(`[generate-weekly-matches] Generating for specific player: ${specificPlayerId}`)
      
      const { data: matches, error } = await supabase
        .rpc('generate_weekly_matches_for_player', {
          p_player_id: specificPlayerId,
          p_target_match_count: targetMatchCount
        })

      if (error) {
        console.error(`[generate-weekly-matches] Error generating matches for player:`, error)
        throw error
      }

      const matchCount = matches?.length || 0
      totalMatchesCreated = matchCount
      
      // Get player name
      const { data: profile } = await supabase
        .from('profile')
        .select('display_name')
        .eq('id', specificPlayerId)
        .single()

      results = [{
        player_id: specificPlayerId,
        player_name: profile?.display_name || 'Unknown',
        matches_created: matchCount
      }]

      console.log(`[generate-weekly-matches] Created ${matchCount} matches for player ${profile?.display_name}`)
    } else {
      // Generate for all players
      console.log(`[generate-weekly-matches] Generating for all active players`)
      
      const { data, error } = await supabase
        .rpc('generate_weekly_matches_for_all_players', {
          p_target_match_count_per_player: targetMatchCount
        })

      if (error) {
        console.error(`[generate-weekly-matches] Error generating matches:`, error)
        throw error
      }

      results = data || []
      totalMatchesCreated = results.reduce((sum, r) => sum + r.matches_created, 0)
      
      console.log(`[generate-weekly-matches] Generated matches for ${results.length} players`)
      console.log(`[generate-weekly-matches] Total matches created: ${totalMatchesCreated}`)
    }

    // Log summary
    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      players_processed: results.length,
      total_matches_created: totalMatchesCreated,
      results: results
    }

    console.log(`[generate-weekly-matches] Completed successfully:`, JSON.stringify(summary))

    return new Response(
      JSON.stringify(summary),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error(`[generate-weekly-matches] Fatal error:`, error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-weekly-matches' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"target_match_count": 10}'

  For a specific player:
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-weekly-matches' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"target_match_count": 10, "player_id": "your-player-uuid"}'

*/
