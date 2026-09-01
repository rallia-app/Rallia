/**
 * SelectableChip
 *
 * A pill-shaped, single-tap choice: day and time strips, filter bars, tag
 * pickers. Not a Button — a Button performs an action, a chip carries a value
 * that is either picked or not, and rows of them are read as one set.
 *
 * Two looks:
 *   'solid'   the value itself. Selected fills with the accent.
 *   'ghost'   the escape hatch at the end of a strip ("Other day…"), dashed so
 *             it reads as "not one of these" rather than an unselected value.
 *
 * @example
 * <SelectableChip label="Tomorrow" selected={day === key} onPress={pick} />
 * <SelectableChip label="Other day" variant="ghost" icon={<Icon />} onPress={open} />
 * <SelectableChip label="Unread" badge={12} selected={f === 'unread'} onPress={pick} />
 */

import React, { useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { useThemeStyles } from '@rallia/shared-hooks';
import { base, spacingPixels, radiusPixels, lighten } from '@rallia/design-system';

import { Text } from './Text';

export interface SelectableChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Rendered before the label (icon element, avatar, dot). */
  icon?: React.ReactNode;
  /** Rendered after the label — the chevron on a chip that opens a dropdown. */
  trailingIcon?: React.ReactNode;
  /** Count pill after the label. Hidden at 0, clamped to "99+". */
  badge?: number;
  /** 'solid' = a pickable value; 'ghost' = the "something else" escape hatch. */
  variant?: 'solid' | 'ghost';
  /** Overrides the theme accent used for the selected fill. */
  accentColor?: string;
  /** Bounce the chip on tap. For dense filter strips where the row is the unit. */
  animateOnPress?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function SelectableChip({
  label,
  selected = false,
  onPress,
  icon,
  trailingIcon,
  badge,
  variant = 'solid',
  accentColor,
  animateOnPress = false,
  disabled = false,
  style,
  accessibilityLabel,
  testID,
}: SelectableChipProps) {
  const { colors } = useThemeStyles();
  const accent = accentColor ?? colors.buttonActive;
  const isGhost = variant === 'ghost';

  const background = isGhost ? 'transparent' : selected ? accent : colors.buttonInactive;
  // A selected chip keeps a rim a step lighter than its own fill. Without it the
  // border matches the fill exactly and a dense strip reads as one bar of colour
  // rather than separate pills. `lighten` returns its input for a non-hex accent,
  // which degrades to the flat fill rather than throwing.
  const border = isGhost ? colors.border : selected ? lighten(accent, 20) : colors.border;
  const labelColor = isGhost ? colors.textMuted : selected ? base.white : colors.text;

  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    if (animateOnPress) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.95, duration: 50, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 50, useNativeDriver: true }),
      ]).start();
    }
    onPress();
  };

  const showBadge = badge !== undefined && badge > 0;

  const chip = (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: background, borderColor: border },
        isGhost && styles.ghost,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text size="sm" weight={selected ? 'semibold' : 'regular'} color={labelColor}>
        {label}
      </Text>
      {showBadge ? (
        <View style={[styles.badge, { backgroundColor: selected ? base.white : accent }]}>
          <Text
            size="xs"
            weight="semibold"
            color={selected ? accent : base.white}
            style={styles.badgeText}
          >
            {badge > 99 ? '99+' : String(badge)}
          </Text>
        </View>
      ) : null}
      {trailingIcon ? <View style={styles.icon}>{trailingIcon}</View> : null}
    </Pressable>
  );

  if (!animateOnPress) return chip;

  return <Animated.View style={{ transform: [{ scale }] }}>{chip}</Animated.View>;
}

export default SelectableChip;

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[3.5],
    paddingVertical: spacingPixels[2],
    borderWidth: 1,
    borderRadius: radiusPixels.full,
  },
  ghost: {
    borderStyle: 'dashed',
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.8,
  },
  badge: {
    minWidth: 20,
    paddingHorizontal: spacingPixels[1],
    paddingVertical: 1,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...(Platform.OS === 'android' && { textAlignVertical: 'center' as const }),
  },
});
