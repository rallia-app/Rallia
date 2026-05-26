import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, Logger } from '@rallia/shared-services';

export const usePendingReferenceRequestsCount = () => {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setCount(0);
        return;
      }

      const { count: result, error } = await supabase
        .from('rating_reference_request')
        .select('id', { count: 'exact', head: true })
        .eq('referee_id', user.id)
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

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  useFocusEffect(
    useCallback(() => {
      fetchCount();
    }, [fetchCount])
  );

  return { count, loading, refetch: fetchCount };
};
