/**
 * Edge Function: Send Feedback Notification
 *
 * Sends an email notification to the admin when new feedback is submitted.
 * This function can be called directly from the app after feedback submission
 * or via a database webhook.
 */

import { Resend } from 'resend';

import { requireSecretApikey } from '../_shared/auth.ts';

import { renderFeedbackEmail, type FeedbackPayload } from './template.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'Rallia <no-reply@updates.rallia.ca>';
const ADMIN_EMAILS = ['contact@rallia.ca'];

interface EmailResponse {
  success: boolean;
  id?: string;
  error?: string;
}

Deno.serve(async req => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const authError = requireSecretApikey(req);
  if (authError) return authError;

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for API key
    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Email service not configured' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const payload: FeedbackPayload = await req.json();

    // Validate required fields (subject/message may be empty for PMF category)
    if (!payload.feedback_id || !payload.category) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Render email content
    const { subject, html } = renderFeedbackEmail(payload);

    // Send email via Resend SDK
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAILS,
      subject,
      html,
    });

    if (error) {
      console.error('Resend API error:', error.message);

      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Return success response
    const successResponse: EmailResponse = {
      success: true,
      id: data?.id,
    };

    console.log('Feedback notification sent successfully:', payload.feedback_id);

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Feedback notification error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});
