/**
 * Date-aware (de)serializer for the AsyncStorage-backed React Query persister.
 *
 * Plain JSON loses `Date` instances on round-trip — they come back as strings,
 * and consumers that call `.getTime()` on the rehydrated value crash. We tag
 * Date instances with `{ __type: 'Date', iso }` on the way out and rebuild
 * them on the way in so persisted queries (e.g. the "Just for you" carousel,
 * whose suggestion slots carry `Date` fields) round-trip safely.
 *
 * Serialization is the hot path: the persister re-serializes the ENTIRE
 * dehydrated cache (multi-MB when signed in) on a throttle while queries
 * churn, and that work is synchronous on the JS thread — it used to land
 * mid-navigation. So the encode pass deep-walks ONLY the queries known to
 * carry Dates (see `queryCarriesDates`) and hands everything else to
 * JSON.stringify's fast path untouched. Deserialization runs once per cold
 * start, so it decode-walks the whole tree and rebuilds markers anywhere.
 *
 * If you persist a NEW query whose payload carries Date instances, add it to
 * `queryCarriesDates` below — otherwise its Dates degrade to plain ISO
 * strings on rehydration (no crash here, but `.getTime()` consumers break).
 * Set/Map payloads are still excluded at the dehydrate layer in App.tsx.
 */

import type { PersistedClient } from '@tanstack/react-query-persist-client';

const DATE_MARKER = '__type' as const;
const DATE_VALUE = 'Date' as const;

interface DateMarker {
  [DATE_MARKER]: typeof DATE_VALUE;
  iso: string;
}

/** Persisted queries whose payloads contain `Date` instances. */
function queryCarriesDates(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'matches' && queryKey[1] === 'justForYou';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDateMarker(value: unknown): value is DateMarker {
  return isPlainObject(value) && value[DATE_MARKER] === DATE_VALUE && typeof value.iso === 'string';
}

function encodeDates(value: unknown): unknown {
  if (value instanceof Date) {
    // Invalid Dates can't produce an ISO string — persist them as null
    // (matching Date.prototype.toJSON) instead of throwing away the persist.
    if (Number.isNaN(value.getTime())) return null;
    return { [DATE_MARKER]: DATE_VALUE, iso: value.toISOString() } satisfies DateMarker;
  }
  if (Array.isArray(value)) {
    return value.map(encodeDates);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key in value) {
      out[key] = encodeDates(value[key]);
    }
    return out;
  }
  return value;
}

function decodeDates(value: unknown): unknown {
  if (isDateMarker(value)) {
    return new Date(value.iso);
  }
  if (Array.isArray(value)) {
    return value.map(decodeDates);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key in value) {
      out[key] = decodeDates(value[key]);
    }
    return out;
  }
  return value;
}

export function serializeQueryCache(value: PersistedClient): string {
  const queries = value.clientState?.queries;
  if (!queries?.some(q => queryCarriesDates(q.queryKey))) {
    return JSON.stringify(value);
  }
  return JSON.stringify({
    ...value,
    clientState: {
      ...value.clientState,
      queries: queries.map(q => (queryCarriesDates(q.queryKey) ? (encodeDates(q) as typeof q) : q)),
    },
  });
}

export function deserializeQueryCache(raw: string): PersistedClient {
  return decodeDates(JSON.parse(raw)) as PersistedClient;
}
