/**
 * Delete Account Edge Function
 *
 * Permanently deletes a user's account and all associated data.
 * Uses auth.admin.deleteUser() which cascades through ON DELETE CASCADE
 * constraints: auth.users → profile → player → all dependent tables.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

const DEMO_ACCOUNT_EMAIL = 'demo@rallia.ca';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ---- Auth ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }
    const user = authData.user;

    // ---- Guard: demo account ----
    if (user.email === DEMO_ACCOUNT_EMAIL) {
      return new Response(JSON.stringify({ error: 'Demo account cannot be deleted' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    // Service-role client for privileged operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ---- Delete storage files ----
    try {
      const { data: profile } = await supabase
        .from('profile')
        .select('profile_picture_url')
        .eq('id', user.id)
        .single();

      if (profile?.profile_picture_url) {
        // Extract the storage path from the URL
        const url = profile.profile_picture_url;
        const bucketPath = url.includes('/profile-pictures/')
          ? url.split('/profile-pictures/').pop()
          : null;

        if (bucketPath) {
          await supabase.storage.from('profile-pictures').remove([bucketPath]);
        }
      }
    } catch (storageError) {
      // Log but don't block deletion if storage cleanup fails
      console.error('Failed to clean up storage files:', storageError);
    }

    // ---- Delete user (cascades all data) ----
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);

    if (deleteError) {
      console.error('Failed to delete user:', deleteError);
      return new Response(
        JSON.stringify({ error: `Failed to delete account: ${deleteError.message}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete account';
    console.error('delete-account error:', message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
