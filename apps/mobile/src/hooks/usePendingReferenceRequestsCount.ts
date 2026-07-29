import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { supabase, Logger } from '@rallia/shared-services';

const FOCUS_REFETCH_INTERVAL_MS = 60 * 1000;

export const usePendingReferenceRequestsCount = () => {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    try {
      // Local session read — auth.getUser() here was a network round-trip on
      // every Home focus, queued behind the auth lock during navigation.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setCount(0);
        return;
      }

      const { count: result, error } = await supabase
        .from('rating_reference_request')
        .select('id', { count: 'exact', head: true })
        .eq('referee_id', userId)
        .eq('status', 'pending')
        .gte('expires_at', new Date().toISOString());

      if (error) {
        Logger.error('Failed to fetch pending reference requests count', error);
        return;
      }
      setCount(result || 0);
    } catch (error) {
      Logger.error('Failed to fetch pending reference requests count', error as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount and when the screen regains focus, at most once a minute —
  // every tab switch back to Home refocuses, and the count doesn't change
  // often enough to justify a query per navigation.
  const isFocused = useIsFocused();
  const lastFetchRef = useRef(0);
  useEffect(() => {
    if (!isFocused) return;
    const now = Date.now();
    if (now - lastFetchRef.current < FOCUS_REFETCH_INTERVAL_MS) return;
    lastFetchRef.current = now;
    void fetchCount();
  }, [isFocused, fetchCount]);

  return { count, loading, refetch: fetchCount };
};
