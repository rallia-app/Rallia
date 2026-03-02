/**
 * send-admin-push Edge Function
 *
 * Sends push notifications to admin devices for critical alerts.
 * Called by database trigger when critical admin_alert is created,
 * or manually via API for broadcast notifications.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Initialize Supabase client with service role
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Expo Push API endpoint
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Types
interface AdminPushRequest {
  alertId?: string;
  alertType: string;
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  data?: Record<string, unknown>;
  adminIds?: string[]; // Optional: target specific admins
}

interface DeviceToken {
  admin_id: string;
  push_token: string;
  platform: string;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
}

interface ExpoPushResponse {
  data: Array<{
    status: 'ok' | 'error';
    id?: string;
    message?: string;
    details?: { error?: string };
  }>;
}

/**
 * Get eligible device tokens based on alert type and preferences
 */
async function getEligibleTokens(
  alertType: string,
  severity: string,
  adminIds?: string[]
): Promise<DeviceToken[]> {
  try {
    // Get all active devices with their admin preferences
    let query = supabase
      .from('admin_device')
      .select(`
        admin_id,
        push_token,
        platform
      `)
      .eq('is_active', true);

    // If specific admins are targeted
    if (adminIds && adminIds.length > 0) {
      query = query.in('admin_id', adminIds);
    }

    const { data: devices, error: deviceError } = await query;

    if (deviceError) {
      console.error('Error fetching devices:', deviceError);
      return [];
    }

    if (!devices || devices.length === 0) {
      console.log('No active devices found');
      return [];
    }

    // Get alert preferences for these admins
    const adminIdsToCheck = [...new Set(devices.map(d => d.admin_id))];
    
    const { data: preferences, error: prefError } = await supabase
      .from('admin_alert_preference')
      .select('admin_id, alert_type, push_enabled')
      .in('admin_id', adminIdsToCheck)
      .eq('alert_type', alertType)
      .eq('push_enabled', true);

    if (prefError) {
      console.error('Error fetching preferences:', prefError);
      // If preferences fail, only send to critical alerts
      if (severity !== 'critical') {
        return [];
      }
      return devices as DeviceToken[];
    }

    // For critical alerts, send even if no explicit preference (default on)
    if (severity === 'critical') {
      // Send to all active devices unless explicitly disabled
      const disabledAdmins = new Set<string>();
      
      const { data: disabledPrefs } = await supabase
        .from('admin_alert_preference')
        .select('admin_id')
        .in('admin_id', adminIdsToCheck)
        .eq('alert_type', alertType)
        .eq('push_enabled', false);

      if (disabledPrefs) {
        disabledPrefs.forEach(p => disabledAdmins.add(p.admin_id));
      }

      return devices.filter(d => !disabledAdmins.has(d.admin_id)) as DeviceToken[];
    }

    // For non-critical, only send to admins with explicit push_enabled
    const enabledAdminIds = new Set(preferences?.map(p => p.admin_id) || []);
    return devices.filter(d => enabledAdminIds.has(d.admin_id)) as DeviceToken[];
  } catch (err) {
    console.error('Error getting eligible tokens:', err);
    return [];
  }
}

/**
 * Send push notifications via Expo Push API
 */
async function sendExpoPush(
  tokens: string[],
  title: string,
  message: string,
  severity: string,
  data?: Record<string, unknown>
): Promise<{ sent: number; failed: number }> {
  if (tokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const messages: ExpoPushMessage[] = tokens.map(token => ({
    to: token,
    title,
    body: message,
    data: data || {},
    priority: severity === 'critical' ? 'high' : 'default',
    sound: severity === 'critical' ? 'default' : null,
    channelId: severity === 'critical' ? 'admin-critical' : 'admin-alerts',
  }));

  try {
    // Expo recommends batching in chunks of 100
    const chunkSize = 100;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        console.error('Expo Push API error:', response.status, await response.text());
        failed += chunk.length;
        continue;
      }

      const result: ExpoPushResponse = await response.json();
      
      for (const ticket of result.data) {
        if (ticket.status === 'ok') {
          sent++;
        } else {
          failed++;
          console.error('Push ticket error:', ticket.message, ticket.details);
        }
      }
    }

    return { sent, failed };
  } catch (err) {
    console.error('Error sending Expo push:', err);
    return { sent: 0, failed: tokens.length };
  }
}

/**
 * Log push notification attempt
 */
async function logPushAttempt(
  alertId: string | undefined,
  tokenCount: number,
  sent: number,
  failed: number
): Promise<void> {
  if (!alertId) return;

  try {
    await supabase.from('admin_audit_log').insert({
      action: 'push_notification_sent',
      entity_type: 'admin_alert',
      entity_id: alertId,
      details: {
        total_tokens: tokenCount,
        sent,
        failed,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Error logging push attempt:', err);
  }
}

// Main handler
serve(async (req: Request) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: AdminPushRequest = await req.json();
    const { alertId, alertType, title, message, severity, data, adminIds } = payload;

    console.log('Processing admin push request:', { alertId, alertType, severity });

    // Get eligible device tokens
    const devices = await getEligibleTokens(alertType, severity, adminIds);
    
    if (devices.length === 0) {
      console.log('No eligible devices for notification');
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No eligible devices' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokens = devices.map(d => d.push_token);
    console.log(`Sending to ${tokens.length} devices`);

    // Send push notifications
    const { sent, failed } = await sendExpoPush(
      tokens,
      title,
      message,
      severity,
      { alertId, alertType, severity, ...data }
    );

    // Log attempt
    await logPushAttempt(alertId, tokens.length, sent, failed);

    console.log(`Push notification complete: ${sent} sent, ${failed} failed`);

    return new Response(
      JSON.stringify({ success: true, sent, failed, total: tokens.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Error processing push request:', err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
