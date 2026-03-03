/**
 * Stripe Client Initialization
 *
 * This module provides a singleton Stripe client instance.
 * The Stripe secret key should be provided via environment variables.
 */

import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

/**
 * Get or create a Stripe client instance
 * @param secretKey - Stripe secret key (optional if already initialized)
 * @returns Stripe client instance
 */
export function getStripeClient(secretKey?: string): Stripe {
  if (stripeInstance) {
    return stripeInstance;
  }

  const key = secretKey || process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error('Stripe secret key is required. Set STRIPE_SECRET_KEY environment variable.');
  }

  stripeInstance = new Stripe(key, {
    apiVersion: '2026-02-25.clover',
    typescript: true,
    appInfo: {
      name: 'Rallia',
      version: '1.0.0',
    },
  });

  return stripeInstance;
}

/**
 * Create a new Stripe client instance (for testing or isolation)
 * @param secretKey - Stripe secret key
 * @returns New Stripe client instance
 */
export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: '2026-02-25.clover',
    typescript: true,
    appInfo: {
      name: 'Rallia',
      version: '1.0.0',
    },
  });
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetStripeClient(): void {
  stripeInstance = null;
}
