/**
 * BetterStack Heartbeat Reporter
 *
 * Call after a cron function completes successfully to signal
 * to BetterStack that the job ran. If the ping fails, it logs
 * a warning but never throws — heartbeat failure should never
 * break the actual job.
 */
export async function reportHeartbeat(heartbeatUrl: string | undefined): Promise<void> {
  if (!heartbeatUrl) {
    console.warn('[heartbeat] No heartbeat URL configured, skipping');
    return;
  }

  try {
    const response = await fetch(heartbeatUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`[heartbeat] Ping returned ${response.status}`);
    }
  } catch (error) {
    console.warn('[heartbeat] Failed to ping:', error instanceof Error ? error.message : error);
  }
}
