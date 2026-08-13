/**
 * ChatCardShell
 *
 * The one source of truth for how a system card sits in the message stream.
 * Every full-width chat card (Match Organizer, court prompt/confirmation) had
 * grown its own copy of the same wrapper, surface, icon circle and fallback,
 * and they drifted. They now share:
 *
 *   chatCardShell     the StyleSheet: stream padding, card surface, header row
 *   ChatCardFallback  centered muted plain text when metadata is missing
 *   ChatCardHeader    36pt tinted icon circle + title + optional subtitle
 *   ChatConfirmationBand
 *                     the compact tinted "it happened" band: solid icon circle,
 *                     up to three truncating lines, chevron affordance anchored
 *                     right (spinner while opening), whole band tappable
 *
 * Cards keep their own content below the header; only the skeleton is shared.
 */

/* eslint react-native/no-unused-styles: "off" -- the sheet is exported for the
   cards to compose, so styles used only by consumers read as dead here. */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { base, spacingPixels, radiusPixels } from '@rallia/design-system';

type ShellColors = {
  text: string;
  textMuted: string;
};

export function ChatCardFallback({ text, colors }: { text: string; colors: ShellColors }) {
  return (
    <View style={chatCardShell.fallback}>
      <Text size="sm" color={colors.textMuted} style={chatCardShell.fallbackText}>
        {text}
      </Text>
    </View>
  );
}

export function ChatCardHeader({
  icon,
  accent,
  title,
  subtitle,
  colors,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accent: string;
  title: string;
  subtitle?: string | null;
  colors: ShellColors;
}) {
  return (
    <View style={chatCardShell.headerRow}>
      <View style={[chatCardShell.iconCircle, { backgroundColor: accent + '1A' }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <View style={chatCardShell.headerText}>
        <Text size="sm" weight="semibold" color={colors.text} lineHeight="tight">
          {title}
        </Text>
        {subtitle ? (
          <Text
            size="xs"
            color={colors.textMuted}
            lineHeight="tight"
            style={chatCardShell.headerSubtitle}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ChatConfirmationBand({
  accent,
  icon = 'checkmark',
  title,
  lines,
  onPress,
  isOpening = false,
  accessibilityLabel,
  colors,
}: {
  accent: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  /** Rendered under the title, one truncating line each; nulls are skipped. */
  lines: Array<string | null | undefined>;
  onPress: () => void;
  isOpening?: boolean;
  accessibilityLabel: string;
  colors: ShellColors;
}) {
  return (
    <View style={chatCardShell.wrapper}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[chatCardShell.band, { backgroundColor: accent + '14', borderColor: accent + '40' }]}
      >
        <View style={[chatCardShell.bandIcon, { backgroundColor: accent }]}>
          <Ionicons name={icon} size={18} color={base.white} />
        </View>
        <View style={chatCardShell.bandBody}>
          <Text size="sm" weight="semibold" color={colors.text} numberOfLines={1}>
            {title}
          </Text>
          {lines
            .filter((l): l is string => !!l)
            .map((line, i) => (
              <Text key={i} size="xs" color={colors.textMuted} numberOfLines={1}>
                {line}
              </Text>
            ))}
        </View>
        <View style={[chatCardShell.bandOpen, { backgroundColor: accent + '1A' }]}>
          {isOpening ? (
            <ActivityIndicator size="small" color={accent} />
          ) : (
            <Ionicons name="chevron-forward" size={16} color={accent} />
          )}
        </View>
      </Pressable>
    </View>
  );
}

export const chatCardShell = StyleSheet.create({
  /** Position in the message stream: matches MessageBubble's gutter. */
  wrapper: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[2],
  },
  /** The card surface. Callers paint backgroundColor/borderColor per theme. */
  card: {
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
  },
  headerText: {
    flex: 1,
  },
  headerSubtitle: {
    marginTop: spacingPixels[1],
  },
  /** Action block under a header: spans the card so it has no dead side. */
  cardCta: {
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Confirmation band: one row, tap anywhere to open. */
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
  bandIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandBody: {
    flex: 1,
    gap: 1,
  },
  bandOpen: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[2],
  },
  fallbackText: {
    textAlign: 'center',
  },
});
