import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { runWhenIdle } from '#/utils/runWhenIdle';

// Sibling tabs worth warming. 'Actions' is a sheet trigger, not a real screen.
const TABS_TO_PRELOAD = ['Courts', 'Community', 'Chat'] as const;

type Preloadable = { preload?: (name: string) => void };

/**
 * Warms the sibling bottom-tab stacks shortly after the first tab settles, so
 * their first focus doesn't pay the full mount + initial-render cost (the >1s
 * TTID measured in Sentry). preload() mounts each stack and runs its on-mount
 * queries without focusing it, so it warms both render and data.
 *
 * preload does NOT trigger focus, so useFocusEffect side effects (screen-view
 * analytics, map/camera activation) stay deferred until the user actually
 * visits the tab. Only plain mount effects/queries run early. Call once from
 * the initial tab (Home).
 */
export function useTabPreload() {
  const navigation = useNavigation();
  const didPreload = useRef(false);

  useEffect(() => {
    if (didPreload.current) return;
    didPreload.current = true;

    const tab = navigation.getParent('BottomTabs');
    if (!tab?.preload) return;

    // Hold tab warming until the cold-start critical path (auth → player →
    // Home carousel) has cleared the Supabase connection pool. Warming three
    // tab stacks immediately piled their mount queries (e.g. Chat's
    // get_player_conversations) onto the sign-in request herd and saturated the
    // pool — that RPC was hitting the 8s statement timeout. The tabs aren't
    // needed in the first few seconds, so defer past the burst, then yield to
    // interactions and stagger each stack onto its own frame as before.
    const PRELOAD_DELAY_MS = 4000;
    let handle: ReturnType<typeof runWhenIdle> | undefined;
    const timer = setTimeout(() => {
      handle = runWhenIdle(() => {
        TABS_TO_PRELOAD.forEach((name, i) => {
          setTimeout(() => tab.preload?.(name), i * 150);
        });
      });
    }, PRELOAD_DELAY_MS);

    return () => {
      clearTimeout(timer);
      handle?.cancel();
    };
  }, [navigation]);
}
