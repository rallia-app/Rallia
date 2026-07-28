'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PlaceDetails, PlacePrediction } from '../types';

/**
 * Vendored from packages/shared-hooks, stripped to the proxy path only. The
 * upstream hook can call Google directly from the browser when a public key is
 * set; here there is no public key by design, so everything goes through our
 * own /api/places routes.
 */

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

interface Options {
  searchQuery: string;
  debounceMs?: number;
  enabled?: boolean;
  minQueryLength?: number;
}

export function usePlacesAutocomplete({
  searchQuery,
  debounceMs = 300,
  enabled = true,
  minQueryLength = 3,
}: Options) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebounce(searchQuery, debounceMs);

  const clearPredictions = useCallback(() => {
    setPredictions([]);
    setError(null);
  }, []);

  const getPlaceDetails = useCallback(async (placeId: string): Promise<PlaceDetails | null> => {
    try {
      const response = await fetch('/api/places/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { details?: PlaceDetails };
      return data.details ?? null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPredictions([]);
      return;
    }

    const query = debouncedQuery.trim();
    if (query.length < minQueryLength) {
      setPredictions([]);
      setIsLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    fetch('/api/places/autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: query }),
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error('Failed to fetch place suggestions');
        const data = (await response.json()) as { predictions?: PlacePrediction[] };
        setPredictions(data.predictions ?? []);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError('Failed to search places');
        setPredictions([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
  }, [debouncedQuery, enabled, minQueryLength]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return useMemo(
    () => ({ predictions, isLoading, error, clearPredictions, getPlaceDetails }),
    [predictions, isLoading, error, clearPredictions, getPlaceDetails]
  );
}
