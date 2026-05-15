/**
 * refresh-facility-availability Edge Function
 *
 * Per-facility refresh worker for the SWR availability snapshot pipeline.
 * Invoked by the suggestion service layer (fire-and-forget) and by the daily
 * pre-warm cron. Reads a list of facility ids, fetches their per-court
 * availability from the configured provider, and atomically replaces the
 * upcoming-window rows in facility_availability_snapshot.
 *
 * Concurrency: per-facility transactional advisory lock — simultaneous
 * invocations for the same facility resolve as one writer and N "locked"
 * results. The lock auto-releases at transaction end.
 *
 * Window: 3 days from today. Matches what both IC3/Otium and ActivityMessenger
 * return today.
 *
 * Auth: same `apikey` secret-header model as the other internal edge
 * functions (see `_shared/auth.ts`).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { requireSecretApikey } from '../_shared/auth.ts';

import { fetchProviderAvailability, type ProviderConfig, type SnapshotRow } from './providers.ts';

// =============================================================================
// CONFIGURATION
// =============================================================================

const WINDOW_DAYS = 3;
const MAX_FACILITIES_PER_INVOCATION = 50;
const FACILITY_CONCURRENCY = 8;

// =============================================================================
// TYPES
// =============================================================================

interface RequestBody {
  facility_ids?: unknown;
}

interface FacilityRow {
  facility_id: string;
  external_provider_id: string | null;
  provider_type: string | null;
  api_base_url: string | null;
  api_config: Record<string, unknown> | null;
}

interface RefreshResult {
  refreshed: string[];
  already_fresh: string[];
  locked: string[];
  failed: Array<{ facility_id: string; error: string }>;
  skipped: Array<{ facility_id: string; reason: string }>;
  durationMs: number;
}

// =============================================================================
// INPUT VALIDATION
// =============================================================================

function parseFacilityIds(body: RequestBody): { ids: string[]; error: string | null } {
  if (!Array.isArray(body.facility_ids)) {
    return { ids: [], error: 'facility_ids must be an array' };
  }
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = body.facility_ids.filter((v): v is string => typeof v === 'string' && uuidRe.test(v));
  if (ids.length === 0) {
    return { ids: [], error: 'facility_ids contains no valid UUIDs' };
  }
  if (ids.length > MAX_FACILITIES_PER_INVOCATION) {
    return {
      ids: [],
      error: `Too many facility_ids (max ${MAX_FACILITIES_PER_INVOCATION})`,
    };
  }
  // Dedup.
  return { ids: [...new Set(ids)], error: null };
}

// =============================================================================
// DATA HELPERS
// =============================================================================

function nextNDates(n: number): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }
  return out;
}

/**
 * Resolves the data-provider config for a set of facility ids. Walks the
 * `facility → data_provider` link with a fallback to
 * `facility → organization → data_provider`, matching the resolution
 * already done by the suggestion RPCs.
 */
async function loadFacilityProviders(
  supabase: SupabaseClient,
  facilityIds: string[]
): Promise<Map<string, FacilityRow>> {
  const { data, error } = await supabase.rpc('resolve_facility_providers', {
    p_facility_ids: facilityIds,
  });

  if (error) throw new Error(`resolve_facility_providers failed: ${error.message}`);

  const out = new Map<string, FacilityRow>();
  for (const r of (data ?? []) as FacilityRow[]) {
    out.set(r.facility_id, r);
  }
  return out;
}

// =============================================================================
// PER-FACILITY REFRESH
// =============================================================================

interface RefreshOutcome {
  facility_id: string;
  status: 'refreshed' | 'already_fresh' | 'locked' | 'failed' | 'skipped';
  error?: string;
  reason?: string;
  rowCount?: number;
}

async function refreshOneFacility(
  supabase: SupabaseClient,
  facilityRow: FacilityRow
): Promise<RefreshOutcome> {
  const { facility_id, external_provider_id, provider_type, api_base_url, api_config } =
    facilityRow;

  if (!external_provider_id || !provider_type || !api_base_url) {
    return {
      facility_id,
      status: 'skipped',
      reason: 'No external provider configured for this facility',
    };
  }

  // Try to acquire the per-facility lock + run the atomic replace inside one
  // transactional RPC. If the lock is held by another invocation, the RPC
  // returns `acquired=false` and we record `locked`.
  const providerConfig: ProviderConfig = {
    providerType: provider_type,
    apiBaseUrl: api_base_url,
    apiConfig: api_config ?? {},
  };

  const dates = nextNDates(WINDOW_DAYS);

  // Probe the lock before paying the provider call. The same lock is taken
  // again in the write RPC to make the entire fetch-and-write critical
  // section atomic, but probing first avoids wasting a provider call when
  // another worker is already in flight.
  const { data: lockOk, error: lockErr } = await supabase.rpc('snapshot_try_lock_facility', {
    p_facility_id: facility_id,
  });
  if (lockErr) {
    return {
      facility_id,
      status: 'failed',
      error: `lock probe failed: ${lockErr.message}`,
    };
  }
  if (lockOk === false) {
    return { facility_id, status: 'locked' };
  }

  let rows: SnapshotRow[];
  let source: string;
  try {
    const result = await fetchProviderAvailability(providerConfig, {
      externalProviderId: external_provider_id,
      dates,
    });
    rows = result.rows;
    source = result.source;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.rpc('snapshot_record_refresh_error', {
      p_facility_id: facility_id,
      p_source: provider_type,
      p_error: msg.slice(0, 500),
    });
    return { facility_id, status: 'failed', error: msg };
  }

  // Atomic write: re-take the lock inside the transaction, delete the
  // upcoming-window rows for this facility, insert the fresh ones, stamp the
  // refresh log. All-or-nothing under the lock.
  const { data: writeData, error: writeErr } = await supabase.rpc(
    'snapshot_replace_facility_rows',
    {
      p_facility_id: facility_id,
      p_source: source,
      p_rows: rows,
    }
  );
  if (writeErr) {
    return {
      facility_id,
      status: 'failed',
      error: `snapshot_replace_facility_rows failed: ${writeErr.message}`,
    };
  }

  // RPC returns a one-row table { status, rows_written }. supabase-js gives
  // it back as an array.
  const writeRow = Array.isArray(writeData) ? writeData[0] : writeData;
  const writeStatus = (writeRow?.status ?? 'wrote') as string;
  if (writeStatus === 'wrote') {
    return { facility_id, status: 'refreshed', rowCount: writeRow?.rows_written ?? rows.length };
  }
  if (writeStatus === 'already_fresh') {
    return { facility_id, status: 'already_fresh' };
  }
  if (writeStatus === 'locked') {
    return { facility_id, status: 'locked' };
  }
  return {
    facility_id,
    status: 'failed',
    error: `Unknown write status: ${writeStatus}`,
  };
}

// =============================================================================
// CONCURRENCY HELPER
// =============================================================================

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const width = Math.min(concurrency, items.length);
  for (let w = 0; w < width; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          results[i] = await fn(items[i]);
        }
      })()
    );
  }
  await Promise.all(workers);
  return results;
}

// =============================================================================
// MAIN
// =============================================================================

async function refreshFacilities(
  supabase: SupabaseClient,
  facilityIds: string[]
): Promise<RefreshResult> {
  const startTime = Date.now();
  const providers = await loadFacilityProviders(supabase, facilityIds);

  const outcomes = await runWithConcurrency(facilityIds, FACILITY_CONCURRENCY, async id => {
    const row = providers.get(id);
    if (!row) {
      return {
        facility_id: id,
        status: 'skipped',
        reason: 'Facility not found',
      };
    }
    try {
      return await refreshOneFacility(supabase, row);
    } catch (err) {
      return {
        facility_id: id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const out: RefreshResult = {
    refreshed: [],
    already_fresh: [],
    locked: [],
    failed: [],
    skipped: [],
    durationMs: Date.now() - startTime,
  };
  for (const o of outcomes) {
    if (o.status === 'refreshed') out.refreshed.push(o.facility_id);
    else if (o.status === 'already_fresh') out.already_fresh.push(o.facility_id);
    else if (o.status === 'locked') out.locked.push(o.facility_id);
    else if (o.status === 'failed')
      out.failed.push({ facility_id: o.facility_id, error: o.error ?? 'unknown' });
    else out.skipped.push({ facility_id: o.facility_id, reason: o.reason ?? 'unknown' });
  }
  return out;
}

// =============================================================================
// ENTRY POINT
// =============================================================================

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      },
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authError = requireSecretApikey(req);
  if (authError) return authError;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { ids, error: validationError } = parseFacilityIds(body);
  if (validationError) {
    return new Response(JSON.stringify({ error: validationError }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await refreshFacilities(supabase, ids);
    console.log(
      `[refresh-facility-availability] refreshed=${result.refreshed.length} already_fresh=${result.already_fresh.length} locked=${result.locked.length} failed=${result.failed.length} skipped=${result.skipped.length} durationMs=${result.durationMs}`
    );
    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[refresh-facility-availability] fatal:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
