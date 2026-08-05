/**
 * Keeps a focused input visible inside an ActionSheet.
 *
 * The sheet makes room for the keyboard by capping its own height, which
 * shortens the scroll viewport without touching the scroll offset: whatever
 * sat near the bottom is simply clipped away. React Native's ScrollView has no
 * scroll-to-focused-input behaviour of its own, and its built-in
 * `scrollResponderScrollNativeHandleToKeyboard` assumes a full-screen scroll
 * view, so its math is wrong inside a sheet.
 *
 * Everything here is measured in the scroll view's own coordinates — position
 * within the content, viewport height — so it stays correct while the sheet
 * animates to its new position. It only ever scrolls down, so a field that is
 * already visible never moves.
 *
 * Pass the ids of the inputs to track, then spread `inputs.<id>` onto each one:
 *
 *   const { scrollProps, inputs } = useKeyboardAwareSheetScroll(['cost', 'notes']);
 *   <SheetScrollView {...scrollProps}>
 *     <TextInput {...inputs.notes} />
 */
import { useCallback, useMemo, useRef } from 'react';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  TextInput,
} from 'react-native';
import { spacingPixels } from '@rallia/design-system';

export interface KeyboardAwareInputProps {
  ref: (node: TextInput | null) => void;
  onFocus: () => void;
  onBlur: () => void;
}

export function useKeyboardAwareSheetScroll<Id extends string>(
  ids: readonly Id[],
  margin: number = spacingPixels[4]
) {
  const scrollRef = useRef<ScrollView>(null);
  const offsetY = useRef(0);
  const viewportHeight = useRef(0);
  const nodes = useRef<Partial<Record<Id, TextInput | null>>>({});
  const focusedId = useRef<Id | null>(null);

  const revealFocusedInput = useCallback(() => {
    const input = focusedId.current ? nodes.current[focusedId.current] : null;
    // measureLayout needs the host view, not the ScrollView component itself.
    const scrollHost = scrollRef.current?.getNativeScrollRef();
    if (!input || !scrollHost || viewportHeight.current <= 0) return;

    // The content sits at the scroll view's origin, so `y` is the position
    // within the content and is unaffected by the current scroll offset.
    input.measureLayout(
      scrollHost,
      (_x, y, _width, height) => {
        const target = y + height + margin - viewportHeight.current;
        if (target > offsetY.current + 1) {
          scrollRef.current?.scrollTo({ y: target, animated: true });
        }
      },
      () => {}
    );
  }, [margin]);

  const scrollProps = useMemo(
    () => ({
      ref: scrollRef,
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        offsetY.current = event.nativeEvent.contentOffset.y;
      },
      // Fires when the sheet resizes for the keyboard — the moment the focused
      // field may have fallen out of view.
      onLayout: (event: LayoutChangeEvent) => {
        viewportHeight.current = event.nativeEvent.layout.height;
        if (focusedId.current) revealFocusedInput();
      },
    }),
    [revealFocusedInput]
  );

  const key = ids.join('|');
  const inputs = useMemo(() => {
    const entries = key.split('|').map(id => [
      id,
      {
        ref: (node: TextInput | null) => {
          nodes.current[id as Id] = node;
        },
        onFocus: () => {
          focusedId.current = id as Id;
          // No layout change follows when the keyboard is already up.
          revealFocusedInput();
        },
        onBlur: () => {
          focusedId.current = null;
        },
      },
    ]);
    return Object.fromEntries(entries) as Record<Id, KeyboardAwareInputProps>;
  }, [key, revealFocusedInput]);

  return { scrollProps, inputs };
}
