import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { setActiveConversation, clearActiveConversation } from '@rallia/shared-services';

// Refresh well inside the server's 60s active-state TTL.
const HEARTBEAT_MS = 30_000;

/**
 * Marks a conversation as "actively viewed" while its screen is focused and the
 * app is foregrounded, so the backend suppresses new-message notifications for
 * it. Heartbeats every 30s (server TTL is 60s) and clears the active state on
 * blur or when the app goes to the background.
 */
export function useActiveConversation(conversationId: string | undefined): void {
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFocusedRef = useRef(false);

  const startHeartbeat = useCallback(() => {
    if (!conversationId) return;
    setActiveConversation(conversationId);
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      setActiveConversation(conversationId);
    }, HEARTBEAT_MS);
  }, [conversationId]);

  const stopHeartbeat = useCallback(
    (clearRemote: boolean) => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (clearRemote && conversationId) {
        clearActiveConversation(conversationId);
      }
    },
    [conversationId]
  );

  // Active while the screen is focused.
  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      startHeartbeat();
      return () => {
        isFocusedRef.current = false;
        stopHeartbeat(true);
      };
    }, [startHeartbeat, stopHeartbeat])
  );

  // Pause while backgrounded; resume on return to foreground if still focused.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        if (isFocusedRef.current) startHeartbeat();
      } else {
        stopHeartbeat(true);
      }
    });
    return () => sub.remove();
  }, [startHeartbeat, stopHeartbeat]);
}
