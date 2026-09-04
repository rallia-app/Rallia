/**
 * Stripe's payment sheet returns as soon as the charge is authorized, but the
 * row the UI reads is flipped later by our webhook (ledger succeeded, THEN the
 * membership / registration). Both paid screens used to refresh once and again
 * after a flat 2.5s, which is a guess: when the webhook lands later than that,
 * nothing refetches again and the CTA keeps offering to enrol someone who has
 * already paid.
 *
 * This polls instead, and stops the moment the state actually flips.
 */
export interface AwaitWebhookSettleOptions {
  /** Refetch the queries the screen reads. Must resolve once they have settled. */
  refresh: () => Promise<unknown>;
  /** True once the refreshed data shows the webhook landed. */
  isSettled: () => boolean;
  /** Give up after this long. Default 20s. */
  timeoutMs?: number;
  /** Gap between attempts. Default 1.2s. */
  intervalMs?: number;
  /** Stop early (screen unmounted). */
  signal?: AbortSignal;
}

/**
 * Resolves true when `isSettled()` turns true, false on timeout or abort.
 *
 * A false return is NOT an error: the charge succeeded either way, the webhook
 * is just slow. Callers should leave the success toast alone and simply let the
 * screen refresh on its next natural focus.
 */
export async function awaitWebhookSettle({
  refresh,
  isSettled,
  timeoutMs = 20_000,
  intervalMs = 1_200,
  signal,
}: AwaitWebhookSettleOptions): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  // First pass is immediate: a webhook that beat the sheet costs us no wait.
  await refresh();
  if (isSettled()) return true;

  while (Date.now() < deadline) {
    if (signal?.aborted) return false;

    const remaining = deadline - Date.now();
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, Math.min(intervalMs, remaining));
      signal?.addEventListener?.('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    if (signal?.aborted) return false;

    await refresh();
    if (isSettled()) return true;
  }

  return false;
}
