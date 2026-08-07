/**
 * Phone verification via Twilio Verify.
 *
 * action 'send'  — starts an OTP to the given E.164 number.
 * action 'check' — validates the code; on approval writes profile.phone +
 *                  phone_verified (service_role, passes the guard trigger)
 *                  and appends a CASL consent row to player_sms_consent.
 */

import { createClient } from '@supabase/supabase-js';

import { isValidPhoneNumber, normalizePhoneNumber } from '../_shared/phone.ts';

// Bump when phoneVerification.consentNotice copy changes materially.
const SMS_CONSENT_WORDING_VERSION = 1;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: 'unauthorized' }, 401);
    }
    const user = authData.user;

    const body = await req.json().catch(() => null);
    const action = body?.action;
    const phone = typeof body?.phone === 'string' ? normalizePhoneNumber(body.phone) : '';

    if (action !== 'send' && action !== 'check') {
      return json({ error: 'invalid_action' }, 400);
    }
    if (!isValidPhoneNumber(phone)) {
      return json({ error: 'invalid_phone' }, 400);
    }

    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const source = body?.source;
    if (action === 'check') {
      if (!/^\d{4,8}$/.test(code)) {
        return json({ error: 'invalid_code_format' }, 400);
      }
      if (source !== 'onboarding' && source !== 'settings') {
        return json({ error: 'invalid_source' }, 400);
      }
    }

    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const verifyServiceSid = Deno.env.get('TWILIO_VERIFY_SERVICE_SID');
    if (!twilioSid || !twilioToken || !verifyServiceSid) {
      return json({ error: 'sms_provider_not_configured' }, 500);
    }

    const twilioAuth = 'Basic ' + btoa(`${twilioSid}:${twilioToken}`);
    const verifyBase = `https://verify.twilio.com/v2/Services/${verifyServiceSid}`;

    if (action === 'send') {
      const formData = new URLSearchParams();
      formData.append('To', phone);
      formData.append('Channel', 'sms');

      const { data: profileData } = await supabaseUser
        .from('profile')
        .select('preferred_locale')
        .eq('id', user.id)
        .single();
      if (profileData?.preferred_locale?.startsWith('fr')) {
        formData.append('Locale', 'fr');
      }

      const response = await fetch(`${verifyBase}/Verifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: twilioAuth,
        },
        body: formData.toString(),
      });
      const data = await response.json().catch(() => null);

      if (response.status === 429 || data?.code === 60203) {
        return json({ error: 'rate_limited' }, 429);
      }
      if (!response.ok) {
        console.error('verify-phone send failed:', data?.code, data?.message);
        return json({ error: 'sms_send_failed' }, 502);
      }
      return json({ success: true });
    }

    // action === 'check'
    const formData = new URLSearchParams();
    formData.append('To', phone);
    formData.append('Code', code);

    const response = await fetch(`${verifyBase}/VerificationCheck`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: twilioAuth,
      },
      body: formData.toString(),
    });
    const data = await response.json().catch(() => null);

    if (response.status === 404 || data?.code === 20404) {
      return json({ error: 'code_expired' }, 410);
    }
    if (response.status === 429 || data?.code === 60202) {
      return json({ error: 'rate_limited' }, 429);
    }
    if (!response.ok) {
      console.error('verify-phone check failed:', data?.code, data?.message);
      return json({ error: 'sms_send_failed' }, 502);
    }
    if (data?.status !== 'approved') {
      return json({ error: 'incorrect_code' }, 422);
    }

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

    const { error: updateError } = await supabaseAdmin
      .from('profile')
      .update({ phone, phone_verified: true })
      .eq('id', user.id);
    if (updateError) {
      console.error('verify-phone profile update failed:', updateError);
      return json({ error: 'profile_update_failed' }, 500);
    }

    const { error: consentError } = await supabaseAdmin.from('player_sms_consent').insert({
      player_id: user.id,
      phone,
      wording_version: SMS_CONSENT_WORDING_VERSION,
      source,
    });
    if (consentError) {
      console.error('verify-phone consent insert failed:', consentError);
      return json({ error: 'consent_record_failed' }, 500);
    }

    return json({ success: true, phone, phone_verified: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('verify-phone error:', message);
    return json({ error: 'internal_error' }, 500);
  }
});
