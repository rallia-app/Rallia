/**
 * SearchBar Component
 * A themed search input with clear button and optional loading indicator.
 * Matches the look and feel of the search bars in WhereStep (facility/place search).
 */

import React, { useRef } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

const SEARCH_ICON_SIZE = 20;
const CLEAR_ICON_SIZE = 18;

interface SearchBarProps {
  /** Current search value */
  value: string;
  /** Called when text changes */
  onChangeText: (text: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Whether to show loading indicator */
  isLoading?: boolean;
  /** Called when the clear button is pressed */
  onClear?: () => void;
  /** Auto focus on mount */
  autoFocus?: boolean;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search...',
  isLoading = false,
  onClear,
  autoFocus = false,
}: SearchBarProps) {
  const { colors } = useThemeStyles();
  const inputRef = useRef<TextInput>(null);

  const handleClear = () => {
    onChangeText('');
    onClear?.();
    inputRef.current?.focus();
  };

  const showClearButton = value.length > 0 && !isLoading;

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: colors.border,
          backgroundColor: colors.buttonInactive,
        },
      ]}
    >
      <Ionicons name="search-outline" size={SEARCH_ICON_SIZE} color={colors.textMuted} />
      <TextInput
        ref={inputRef}
        style={[styles.input, { color: colors.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
      />
      {isLoading && (
        <ActivityIndicator size="small" color={colors.primary} style={styles.loadingIndicator} />
      )}
      {showClearButton && (
        <TouchableOpacity
          onPress={handleClear}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close-circle" size={CLEAR_ICON_SIZE} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: spacingPixels[1],
  },
  loadingIndicator: {
    marginLeft: spacingPixels[0],
  },
});

export default SearchBar;
