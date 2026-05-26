import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { useNavigation } from '@react-navigation/native';

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

    // Yield to Home's own post-interaction work first, then stagger each stack
    // onto its own frame so three mounts don't land in one janky commit.
    const handle = InteractionManager.runAfterInteractions(() => {
      TABS_TO_PRELOAD.forEach((name, i) => {
        setTimeout(() => tab.preload?.(name), i * 150);
      });
    });

    return () => handle.cancel();
  }, [navigation]);
}
