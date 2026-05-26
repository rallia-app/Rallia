/**
 * MascotBubble — Ace Lottie + side-by-side speech bubble.
 *
 * Layout: Ace sits on the LEFT as a chat avatar (~92px). The speech bubble
 * sits on the RIGHT, taking the remaining row width, with a tail pointing
 * left at Ace's face. This makes the bubble read as Ace's own words instead
 * of UI copy that happens to live near a mascot.
 *
 * The bubble's content is mounted with a typewriter animation (one character
 * at a time) the FIRST time a given text appears for a given step. Stepping
 * back-and-forth doesn't re-type — that gets annoying. The typewriter is
 * driven by JS setTimeout, not Reanimated, because we only need ~25ms
 * granularity and need to handle string content (not numbers).
 *
 * On each new `textKey` the bubble does a quick scale/opacity intro (spring
 * from 0.94 → 1) so it feels like Ace just said it. The blinking cursor
 * appears at the end of the typed text until typing completes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import LottieView from 'lottie-react-native';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { spacingPixels, radiusPixels, shadowsSemanticNative } from '@rallia/design-system';

import aceAnimation from '#/features/weekly-checkin/assets/ace-squirrel.json';

const TYPE_INTERVAL_MS = 22;
const MASCOT_SIZE = 128;
const TAIL_SIZE = 10;
// How far down from the top of the bubble the tail sits. Lined up with the
// approximate vertical center of Ace's head at the larger mascot size.
const TAIL_OFFSET_TOP = 32;

interface MascotBubbleProps {
  /** Plain-text bubble content. Rich text rendering happens at the caller. */
  text: string;
  /** Unique key per content variant — keeps the typewriter from re-running on prop changes that aren't a new line. */
  textKey: string;
  /** Optional override of bubble copy with a JSX node (e.g. interpolated highlights). */
  children?: React.ReactNode;
}

export function MascotBubble({ text, textKey, children }: MascotBubbleProps) {
  const { colors } = useThemeStyles();
  // Typewriter state — only used when `children` is not provided.
  const [typedText, setTypedText] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const typingRef = useRef<{ key: string; timer?: ReturnType<typeof setTimeout> }>({ key: '' });

  // Bubble entrance animation — replays on every new textKey.
  const bubbleScale = useRef(new Animated.Value(0.94)).current;
  const bubbleOpacity = useRef(new Animated.Value(0)).current;
  // Blinking cursor while typing.
  const cursorOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    bubbleScale.setValue(0.94);
    bubbleOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(bubbleScale, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
      Animated.timing(bubbleOpacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [textKey, bubbleScale, bubbleOpacity]);

  useEffect(() => {
    if (children) {
      setIsTyping(false);
      return;
    }
    if (typingRef.current.key === textKey) return;
    typingRef.current.key = textKey;

    if (typingRef.current.timer) clearTimeout(typingRef.current.timer);

    setTypedText('');
    setIsTyping(true);
    let i = 0;

    const tick = () => {
      i += 1;
      setTypedText(text.slice(0, i));
      if (i < text.length) {
        typingRef.current.timer = setTimeout(tick, TYPE_INTERVAL_MS);
      } else {
        setIsTyping(false);
      }
    };
    typingRef.current.timer = setTimeout(tick, TYPE_INTERVAL_MS);

    return () => {
      if (typingRef.current.timer) clearTimeout(typingRef.current.timer);
    };
  }, [text, textKey, children]);

  // Cursor blink while typing.
  useEffect(() => {
    if (!isTyping) {
      cursorOpacity.setValue(0);
      return;
    }
    cursorOpacity.setValue(1);
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, {
          toValue: 0,
          duration: 380,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cursorOpacity, {
          toValue: 1,
          duration: 380,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    blink.start();
    return () => blink.stop();
  }, [isTyping, cursorOpacity]);

  return (
    <View style={styles.row}>
      <View style={styles.mascotWrap}>
        <LottieView source={aceAnimation} autoPlay loop style={styles.mascot} />
      </View>

      <Animated.View
        style={[
          styles.bubble,
          {
            backgroundColor: colors.card,
            opacity: bubbleOpacity,
            transform: [{ scale: bubbleScale }],
          },
        ]}
      >
        {/* Tail outline (slightly larger, sits behind the inner tail) — gives
            the bubble its subtle shadow continuation on the tail edge. */}
        <View style={[styles.tailOuter, { borderRightColor: colors.card }]} />
        {/* Inner tail fills with the same card color, masking the outline edge. */}
        <View style={[styles.tailInner, { borderRightColor: colors.card }]} />

        {children ? (
          <View>{children}</View>
        ) : (
          <Text style={[styles.bubbleText, { color: colors.text }]}>
            {typedText}
            {isTyping && (
              <Animated.Text
                style={[styles.cursor, { color: colors.text, opacity: cursorOpacity }]}
              >
                {' ▍'}
              </Animated.Text>
            )}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
  },
  mascotWrap: {
    width: MASCOT_SIZE,
    height: MASCOT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascot: {
    width: MASCOT_SIZE,
    height: MASCOT_SIZE,
  },
  bubble: {
    flex: 1,
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    marginTop: spacingPixels[2],
    minHeight: 52,
    // Pull the bubble slightly inward so the tail visually overlaps Ace's
    // body without forcing actual layout overlap.
    marginLeft: -spacingPixels[1],
    ...shadowsSemanticNative.card,
  },
  // Left-pointing triangle. RN-supported pattern: zero-size view with three
  // transparent borders + one colored border on the side opposite the point.
  tailOuter: {
    position: 'absolute',
    left: -TAIL_SIZE,
    top: TAIL_OFFSET_TOP,
    width: 0,
    height: 0,
    borderTopWidth: TAIL_SIZE,
    borderBottomWidth: TAIL_SIZE,
    borderRightWidth: TAIL_SIZE,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  tailInner: {
    position: 'absolute',
    left: -TAIL_SIZE + 1,
    top: TAIL_OFFSET_TOP,
    width: 0,
    height: 0,
    borderTopWidth: TAIL_SIZE,
    borderBottomWidth: TAIL_SIZE,
    borderRightWidth: TAIL_SIZE,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  cursor: {
    fontSize: 15,
    fontWeight: '500',
  },
});
