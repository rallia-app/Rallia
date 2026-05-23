/**
 * Date-aware (de)serializer for the AsyncStorage-backed React Query persister.
 *
 * Plain JSON loses `Date` instances on round-trip — they come back as strings,
 * and consumers that call `.getTime()` on the rehydrated value crash. We tag
 * Date instances with `{ __type: 'Date', iso }` on the way out and rebuild
 * them on the way in so persisted queries (e.g. the "Just for you" carousel,
 * whose suggestion slots carry `Date` fields) round-trip safely.
 *
 * Intentionally minimal — handles Date only. Set/Map payloads are still
 * excluded at the dehydrate layer in App.tsx.
 */

import type { PersistedClient } from '@tanstack/react-query-persist-client';

const DATE_MARKER = '__type' as const;
const DATE_VALUE = 'Date' as const;

interface DateMarker {
  [DATE_MARKER]: typeof DATE_VALUE;
  iso: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDateMarker(value: unknown): value is DateMarker {
  return (
    isPlainObject(value) &&
    (value as Record<string, unknown>)[DATE_MARKER] === DATE_VALUE &&
    typeof (value as Record<string, unknown>).iso === 'string'
  );
}

function encodeDates(value: unknown): unknown {
  if (value instanceof Date) {
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
  return JSON.stringify(encodeDates(value));
}

export function deserializeQueryCache(raw: string): PersistedClient {
  return decodeDates(JSON.parse(raw)) as PersistedClient;
}
