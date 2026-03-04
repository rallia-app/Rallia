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

  // Bearer auth with anon key (staging/prod). When no key is configured (e.g. local --no-verify-jwt), skip validation.
  const expectedAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (expectedAnonKey) {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== expectedAnonKey) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    // Log incoming request
    console.log('Received email request');
    console.log('Request method:', req.method);
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));

    // Parse and validate request body
    const body = await req.json();
    console.log('Request body received:', JSON.stringify(body, null, 2));

    const validatedRequest: EmailRequest = EmailRequestSchema.parse(body);
    console.log('Request validated successfully, emailType:', validatedRequest.emailType);

    // Get appropriate handler for the email type
    const handler = getHandler(validatedRequest.emailType);

    // Validate payload with handler-specific schema (already validated by EmailRequestSchema)
    const validatedPayload = handler.validate(validatedRequest);

    // Get recipient email and email content (async operations)
    const recipient = await handler.getRecipient(validatedPayload);
    console.log('Recipient email:', recipient);

    const { subject, html } = await handler.getContent(validatedPayload);
    console.log('Email content generated, subject:', subject);

    // Check if Resend API key is configured
    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not set!');
      throw new Error('RESEND_API_KEY environment variable is required');
    }
    if (!FROM_EMAIL) {
      console.error('FROM_EMAIL is not set!');
      throw new Error('FROM_EMAIL environment variable is required');
    }

    console.log('Sending email via Resend SDK...');
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL!,
      to: recipient,
      subject,
      html,
    });

    if (error) {
      console.error('Resend API error:', error.message);

      const errorResponse: EmailResponse = {
        success: false,
        error: error.message,
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Return success response
    console.log('Email sent successfully! Resend email ID:', data?.id);
    const successResponse: EmailResponse = {
      success: true,
      id: data?.id,
      message: 'Email sent successfully',
    };

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // Enhanced error logging
    console.error('Email function error:', error);
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }

    // Handle validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map(issue => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });

      console.error('Validation errors:', errorMessages);

      const errorResponse: EmailResponse = {
        success: false,
        error: `Validation error: ${errorMessages.join('; ')}`,
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Final error response:', errorMessage);

    const errorResponse: EmailResponse = {
      success: false,
      error: errorMessage,
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
