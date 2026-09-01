/**
 * Callout Component
 *
 * Inline tinted notice: a leading icon, a short message, and an optional
 * action link. Replaces the hand-rolled `infoBox` StyleSheet entries that were
 * duplicated across screens, wizard steps, and modals.
 *
 * Tone drives the tint, border, and default icon. Body copy uses `textMuted`
 * so it stays readable in dark mode.
 *
 * @example
 * ```tsx
 * <Callout message={t('matchCreation.fields.tbdLocationInfo')} />
 *
 * // Positive nudge with an action
 * <Callout
 *   tone="success"
 *   message={t('matchCreation.nudges.bookCourt')}
 *   actionLabel={t('matchCreation.nudges.bookCourtAction')}
 *   onActionPress={handleBookCourt}
 * />
 * ```
 */

import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '@rallia/shared-hooks';
import { fontSizePixels, radiusPixels, spacingPixels } from '@rallia/design-system';

import { Text } from '../foundation/Text';
import { Button } from '../foundation/Button';

export type CalloutTone = 'info' | 'success' | 'warning';

export interface CalloutProps {
  /** Tint, border, and default icon. Defaults to `info`. */
  tone?: CalloutTone;
  /** Overrides the tone's default icon. */
  icon?: React.ReactNode;
  /** Optional bold line above the message. */
  title?: string;
  /** Body copy. */
  message: string;
  /** Action link label; no action when omitted. */
  actionLabel?: string;
  /** Action link press handler. */
  onActionPress?: () => void;
  /** Additional container styles */
  style?: StyleProp<ViewStyle>;
  /** Test ID for testing */
  testID?: string;
}

const TONE_ICONS: Record<CalloutTone, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle-outline',
  success: 'checkmark-circle-outline',
  warning: 'alert-circle-outline',
};

export const Callout: React.FC<CalloutProps> = ({
  tone = 'info',
  icon,
  title,
  message,
  actionLabel,
  onActionPress,
  style,
  testID,
}) => {
  const { colors } = useThemeStyles();
  const accent = tone === 'info' ? colors.buttonActive : colors[tone];

  return (
    <View
      style={[styles.container, { backgroundColor: `${accent}10`, borderColor: accent }, style]}
      testID={testID}
    >
      {icon ?? <Ionicons name={TONE_ICONS[tone]} size={20} color={accent} />}
      <View style={styles.body}>
        {title ? (
          <Text size="sm" weight="semibold" color={colors.text}>
            {title}
          </Text>
        ) : null}
        <Text size="sm" color={colors.textMuted} style={styles.message}>
          {message}
        </Text>
        {actionLabel && onActionPress ? (
          <Button variant="link" size="sm" onPress={onActionPress} style={styles.action}>
            {actionLabel}
          </Button>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  body: {
    flex: 1,
    gap: spacingPixels[1],
  },
  message: {
    lineHeight: Math.round(fontSizePixels.sm * 1.4),
  },
  action: {
    alignSelf: 'flex-start',
    paddingHorizontal: 0,
  },
});
