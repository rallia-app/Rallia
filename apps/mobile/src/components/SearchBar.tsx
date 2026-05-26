/**
 * SearchBar
 *
 * Unified search input used across the app. Matches the look and feel of the
 * search bars in the match creation WhereStep (facility/place search).
 *
 * - Container: border, padding, radius from design system, background buttonInactive
 * - Left: search-outline icon (20px), textMuted
 * - Input: flex 1, fontSize 16, paddingVertical 1
 * - Right: close-circle (18px) when value length > 0, hitSlop 10
 */

import React from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

import { useThemeStyles, type ThemeColors } from '#/hooks';

const SEARCH_ICON_SIZE = 20;
const CLEAR_ICON_SIZE = 18;

export interface SearchBarProps extends Omit<TextInputProps, 'style'> {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** When provided (e.g. from modal/overlay), used instead of useThemeStyles().colors */
  colors?: Pick<ThemeColors, 'text' | 'textMuted' | 'border' | 'buttonInactive'>;
  /** Optional wrapper style (e.g. margin) */
  style?: ViewStyle;
  /** Optional container style for the search input row */
  containerStyle?: ViewStyle;
  /** Override border color (e.g. for error state) */
  borderColor?: string;
  /** Use BottomSheetTextInput when inside a bottom sheet */
  InputComponent?: React.ComponentType<TextInputProps>;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder,
  colors: colorsProp,
  style,
  containerStyle,
  borderColor,
  InputComponent = TextInput,
  placeholderTextColor,
  autoCapitalize = 'none',
  autoCorrect = false,
  ...rest
}: SearchBarProps) {
  const { colors: themeColors } = useThemeStyles();
  const colors = colorsProp ?? themeColors;
  const effectiveBorderColor = borderColor ?? colors.border;

  return (
    <View style={style}>
      <View
        style={[
          styles.searchInputContainer,
          {
            borderColor: effectiveBorderColor,
            backgroundColor: colors.buttonInactive,
          },
          containerStyle,
        ]}
      >
        <Ionicons name="search-outline" size={SEARCH_ICON_SIZE} color={colors.textMuted} />
        <InputComponent
          style={[styles.searchInput, { color: colors.text }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={placeholderTextColor ?? colors.textMuted}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          {...rest}
        />
        {value.length > 0 && (
          <TouchableOpacity
            onPress={() => onChangeText('')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-circle" size={CLEAR_ICON_SIZE} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: spacingPixels[1],
  },
});
