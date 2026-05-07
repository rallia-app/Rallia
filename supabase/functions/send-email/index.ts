import { Resend } from 'resend';
import { ZodError } from 'zod';

import { getHandler } from './registry.ts';
import { EmailRequestSchema } from './schemas.ts';
import type { EmailRequest, EmailResponse } from './types.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY environment variable is required');
}
if (!FROM_EMAIL) {
  throw new Error('FROM_EMAIL environment variable is required');
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

  // Auth check per https://supabase.com/docs/guides/functions/auth:
  // accept SUPABASE_PUBLISHABLE_KEYS["default"] in apikey or Authorization: Bearer.
  const expectedKey = (() => {
    try {
      return (
        JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>
      )['default'];
    } catch {
      return undefined;
    }
  })();
  if (expectedKey) {
    const apikey = req.headers.get('apikey');
    const bearer = req.headers
      .get('Authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim();
    const token = apikey || bearer;
    if (!token || token !== expectedKey) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const body = await req.json();
    const validatedRequest: EmailRequest = EmailRequestSchema.parse(body);
    const handler = getHandler(validatedRequest.emailType);
    const validatedPayload = handler.validate(validatedRequest);
    const recipient = await handler.getRecipient(validatedPayload);
    const { subject, html } = await handler.getContent(validatedPayload);
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL!,
      to: recipient,
      subject,
      html,
    });

    if (error) {
      console.error(`[send-email] Resend error: ${error.message}`);
      return new Response(
        JSON.stringify({ success: false, error: error.message } satisfies EmailResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(
      `[send-email] Sent ${validatedRequest.emailType} email to ${recipient} (${data?.id})`
    );
    return new Response(JSON.stringify({ success: true, id: data?.id } satisfies EmailResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message =
      error instanceof ZodError
        ? `Validation: ${error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`
        : error instanceof Error
          ? error.message
          : 'Internal server error';

    console.error(`[send-email] Error: ${message}`);
    return new Response(
      JSON.stringify({ success: false, error: message } satisfies EmailResponse),
      {
        status: error instanceof ZodError ? 400 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
