/**
 * Stripe Payments Service
 *
 * Handles PaymentIntent creation, refunds, and payment processing.
 */

import Stripe from 'stripe';
import { getStripeClient } from './client';

export interface CreatePaymentIntentParams {
  amountCents: number;
  currency?: string;
  /** Connected account ID for destination charges */
  connectedAccountId: string;
  /** Application fee in cents */
  applicationFeeCents?: number;
  /** Metadata to attach to the PaymentIntent */
  metadata?: Record<string, string>;
  /** Description for the payment */
  description?: string;
  /** Customer ID if available */
  customerId?: string;
}

export interface PaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  status: Stripe.PaymentIntent.Status;
}

export interface RefundParams {
  paymentIntentId?: string;
  chargeId?: string;
  amountCents?: number; // If not provided, full refund
  reason?: Stripe.RefundCreateParams.Reason;
  metadata?: Record<string, string>;
}

export interface StripeRefundResult {
  refundId: string;
  amountCents: number;
  status: string;
}

/**
 * Create a PaymentIntent for a booking
 * Uses destination charges to transfer funds to connected account
 */
export async function createPaymentIntent(
  params: CreatePaymentIntentParams
): Promise<PaymentIntentResult> {
  const stripe = getStripeClient();

  const paymentIntent = await stripe.paymentIntents.create({
    amount: params.amountCents,
    currency: params.currency || 'cad',
    description: params.description,
    metadata: params.metadata,
    customer: params.customerId,
    // Destination charge - funds go to connected account minus application fee
    transfer_data: {
      destination: params.connectedAccountId,
    },
    application_fee_amount: params.applicationFeeCents || 0,
    // Auto-confirm if customer has saved payment method
    automatic_payment_methods: {
      enabled: true,
    },
  });

  return {
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret!,
    status: paymentIntent.status,
  };
}

/**
 * Retrieve a PaymentIntent
 */
export async function getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  const stripe = getStripeClient();
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

/**
 * Cancel a PaymentIntent (before it's been captured)
 */
export async function cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  const stripe = getStripeClient();
  return stripe.paymentIntents.cancel(paymentIntentId);
}

/**
 * Create a refund for a charge
 */
export async function createRefund(params: RefundParams): Promise<StripeRefundResult> {
  const stripe = getStripeClient();

  const refundParams: Stripe.RefundCreateParams = {
    reason: params.reason || 'requested_by_customer',
    metadata: params.metadata,
  };

  // Either payment_intent or charge must be provided
  if (params.paymentIntentId) {
    refundParams.payment_intent = params.paymentIntentId;
  } else if (params.chargeId) {
    refundParams.charge = params.chargeId;
  } else {
    throw new Error('Either paymentIntentId or chargeId must be provided');
  }

  // Partial refund if amount specified
  if (params.amountCents) {
    refundParams.amount = params.amountCents;
  }

  const refund = await stripe.refunds.create(refundParams);

  return {
    refundId: refund.id,
    amountCents: refund.amount,
    status: refund.status!,
  };
}

/**
 * Get refund by ID
 */
export async function getRefund(refundId: string): Promise<Stripe.Refund> {
  const stripe = getStripeClient();
  return stripe.refunds.retrieve(refundId);
}

/**
 * Calculate the application fee for a booking
 * Default: 5% of the booking amount
 */
export function calculateApplicationFee(amountCents: number, feePercent: number = 5): number {
  return Math.round((amountCents * feePercent) / 100);
}

export interface CreateDonationPaymentIntentParams {
  amountCents: number;
  currency?: string;
  donorName?: string;
  donorEmail?: string;
  donorMessage?: string;
}

export interface CreateMatchUnlockPaymentIntentParams {
  amountCents: number;
  currency?: string;
  receiptEmail?: string;
  metadata: Record<string, string>;
}

export async function createMatchUnlockPaymentIntent(
  params: CreateMatchUnlockPaymentIntentParams
): Promise<PaymentIntentResult> {
  const stripe = getStripeClient();

  const paymentIntent = await stripe.paymentIntents.create({
    amount: params.amountCents,
    currency: params.currency ?? 'cad',
    automatic_payment_methods: { enabled: true },
    receipt_email: params.receiptEmail || undefined,
    description: 'Rallia instant match intro (early access preview)',
    metadata: {
      type: 'match_smoke_test',
      ...params.metadata,
    },
  });

  return {
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret!,
    status: paymentIntent.status,
  };
}

export async function createDonationPaymentIntent(
  params: CreateDonationPaymentIntentParams
): Promise<PaymentIntentResult> {
  const stripe = getStripeClient();

  const paymentIntent = await stripe.paymentIntents.create({
    amount: params.amountCents,
    currency: params.currency ?? 'cad',
    automatic_payment_methods: { enabled: true },
    receipt_email: params.donorEmail || undefined,
    description: 'Donation to Rallia',
    metadata: {
      type: 'donation',
      donor_name: params.donorName ?? '',
      donor_email: params.donorEmail ?? '',
      donor_message: params.donorMessage?.slice(0, 500) ?? '',
    },
  });

  return {
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret!,
    status: paymentIntent.status,
  };
}
