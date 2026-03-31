/**
 * Process Program Payments Edge Function
 *
 * This function runs daily to process scheduled installment payments
 * for program registrations.
 *
 * Scheduled via Supabase cron: SELECT cron.schedule('process-program-payments', '0 9 * * *', ...);
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14';

import { reportHeartbeat } from '../_shared/heartbeat.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

interface PaymentRecord {
  id: string;
  registration_id: string;
  amount_cents: number;
  currency: string;
  installment_number: number;
  stripe_customer_id: string | null;
  stripe_payment_intent_id: string | null;
  due_date: string;
  retry_count: number;
}

Deno.serve(async req => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Bearer auth with anon key (staging/prod). When no key is configured (e.g. local --no-verify-jwt), skip validation.
    const expectedAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (expectedAnonKey) {
      const authHeader = req.headers.get('Authorization');
      const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
      if (!token || token !== expectedAnonKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        });
      }
    }

    // Initialize clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });

    const today = new Date().toISOString().split('T')[0];

    // Get all pending payments due today or overdue (with retry logic)
    const { data: duePayments, error: fetchError } = await supabase
      .from('registration_payment')
      .select(
        `
        *,
        registration:registration_id (
          id,
          status,
          player_id,
          stripe_customer_id,
          program:program_id (
            name,
            organization_id
          )
        )
      `
      )
      .eq('status', 'pending')
      .lte('due_date', today)
      .or('next_retry_at.is.null,next_retry_at.lte.' + new Date().toISOString())
      .lt('retry_count', 3) // Max 3 retries
      .order('due_date', { ascending: true });

    if (fetchError) {
      throw new Error(`Failed to fetch due payments: ${fetchError.message}`);
    }

    console.log(`Found ${duePayments?.length || 0} payments to process`);

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const payment of duePayments || []) {
      const registration = payment.registration as {
        id: string;
        status: string;
        player_id: string;
        stripe_customer_id: string | null;
        program: { name: string; organization_id: string } | null;
      } | null;

      // Skip if registration is not confirmed
      if (!registration || registration.status !== 'confirmed') {
        results.skipped++;
        continue;
      }

      // Skip if no Stripe customer
      const customerId = payment.stripe_customer_id || registration.stripe_customer_id;
      if (!customerId) {
        results.skipped++;
        console.log(`Skipping payment ${payment.id}: No Stripe customer`);
        continue;
      }

      results.processed++;

      try {
        // Create or get existing payment intent
        let paymentIntent;

        if (payment.stripe_payment_intent_id) {
          // Get existing payment intent
          paymentIntent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);

          // If already succeeded, update our record
          if (paymentIntent.status === 'succeeded') {
            await supabase
              .from('registration_payment')
              .update({
                status: 'succeeded',
                paid_at: new Date().toISOString(),
              })
              .eq('id', payment.id);

            results.succeeded++;
            continue;
          }

          // If requires confirmation, try to confirm
          if (paymentIntent.status === 'requires_confirmation') {
            paymentIntent = await stripe.paymentIntents.confirm(payment.stripe_payment_intent_id);
          }
        } else {
          // Create new payment intent
          paymentIntent = await stripe.paymentIntents.create({
            amount: payment.amount_cents,
            currency: payment.currency.toLowerCase(),
            customer: customerId,
            off_session: true,
            confirm: true,
            metadata: {
              registration_id: registration.id,
              payment_id: payment.id,
              installment_number: payment.installment_number.toString(),
              program_name: registration.program?.name || '',
            },
          });

          // Save payment intent ID
          await supabase
            .from('registration_payment')
            .update({
              stripe_payment_intent_id: paymentIntent.id,
            })
            .eq('id', payment.id);
        }

        // Check result
        if (paymentIntent.status === 'succeeded') {
          await supabase
            .from('registration_payment')
            .update({
              status: 'succeeded',
              paid_at: new Date().toISOString(),
              stripe_charge_id:
                typeof paymentIntent.latest_charge === 'string'
                  ? paymentIntent.latest_charge
                  : paymentIntent.latest_charge?.id,
            })
            .eq('id', payment.id);

          // Update registration paid amount
          await supabase.rpc('update_registration_paid_amount', {
            p_registration_id: registration.id,
          });

          results.succeeded++;
          console.log(`Payment ${payment.id} succeeded`);

          // TODO: Send payment confirmation notification
        } else if (
          paymentIntent.status === 'requires_action' ||
          paymentIntent.status === 'requires_payment_method'
        ) {
          // Payment needs customer action
          await supabase
            .from('registration_payment')
            .update({
              retry_count: payment.retry_count + 1,
              next_retry_at: getNextRetryDate(),
              failure_reason: 'Requires customer action',
            })
            .eq('id', payment.id);

          results.failed++;
          console.log(`Payment ${payment.id} requires action`);

          // TODO: Send notification to customer about failed payment
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        results.failed++;
        results.errors.push(`Payment ${payment.id}: ${errorMessage}`);

        // Update payment with error
        await supabase
          .from('registration_payment')
          .update({
            retry_count: payment.retry_count + 1,
            next_retry_at: getNextRetryDate(),
            failed_at: new Date().toISOString(),
            failure_reason: errorMessage,
          })
          .eq('id', payment.id);

        console.error(`Payment ${payment.id} failed:`, errorMessage);
      }
    }

    console.log('Payment processing complete:', results);

    await reportHeartbeat(Deno.env.get('BETTERSTACK_HEARTBEAT_PROGRAM_PAYMENTS'));

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Payment processing error:', errorMessage);

    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

/**
 * Calculate next retry date with exponential backoff
 */
function getNextRetryDate(): string {
  const now = new Date();
  // Retry after 24 hours
  now.setHours(now.getHours() + 24);
  return now.toISOString();
}
