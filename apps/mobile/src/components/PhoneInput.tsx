/**
 * PhoneInput Component
 *
 * Phone number input with two completely independent sections:
 * 1. Country code input (user types the dial code digits, "+" is pre-filled)
 * 2. Phone number input (formatted according to the detected country)
 *
 * The flag auto-displays based on the entered country code.
 * When country is unknown, shows a globe icon and allows free-form input.
 * The two inputs are fully independent - changing one never affects the other.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, TextInput as RNTextInput, ViewStyle, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { COUNTRIES, Country } from '@rallia/shared-constants';
import { useTheme } from '@rallia/shared-hooks';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';

import { useLocale } from '#/context';

export interface PhoneInputProps {
  value?: string;
  onChangePhone: (fullNumber: string, countryCode: string, localNumber: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  maxLength?: number;
  containerStyle?: ViewStyle;
  inputStyle?: ViewStyle;
  colors?: {
    text?: string;
    textMuted?: string;
    textSecondary?: string;
    background?: string;
    inputBackground?: string;
    inputBorder?: string;
    primary?: string;
    error?: string;
    card?: string;
  };
  onFocus?: () => void;
  onBlur?: () => void;
  TextInputComponent?: React.ComponentType<React.ComponentProps<typeof RNTextInput>>;
}

/**
 * Find the best matching country for given dial digits (exact match only).
 */
function findCountryByDialDigits(digits: string): Country | undefined {
  if (!digits) return undefined;

  const withPlus = `+${digits}`;
  const exactMatches = COUNTRIES.filter(c => c.dialCode === withPlus);

  if (exactMatches.length === 0) return undefined;
  if (exactMatches.length === 1) return exactMatches[0];

  // Multiple exact matches (e.g., +1 for US/CA) - always prefer Canada for +1
  const canadaMatch = exactMatches.find(c => c.code === 'CA');
  if (canadaMatch) return canadaMatch;
  return exactMatches[0];
}

/**
 * Get country from locale.
 */
function getLocaleCountry(locale: string | undefined): Country | undefined {
  if (!locale) return undefined;
  const parts = locale.split('-');
  const countryCode = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : undefined;
  if (!countryCode) return undefined;
  return COUNTRIES.find(c => c.code.toUpperCase() === countryCode);
}

/**
 * Format phone number as user types using the country's format pattern.
 * Optimized for real-time formatting during input.
 */
function formatAsYouType(digits: string, format: string | undefined): string {
  if (!digits) return '';
  if (!format) return digits;

  let result = '';
  let digitIndex = 0;

  for (let i = 0; i < format.length && digitIndex < digits.length; i++) {
    if (format[i] === '#') {
      result += digits[digitIndex];
      digitIndex++;
    } else {
      result += format[i];
    }
  }

  return result;
}

/**
 * Extract only digits from a formatted string.
 */
function extractDigits(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * Parse an international phone number (e.g., "+15551234567") into dial code and local number.
 * Tries to match the longest possible dial code.
 */
function parsePhoneNumber(fullNumber: string): { dialDigits: string; phoneDigits: string } {
  if (!fullNumber) {
    return { dialDigits: '', phoneDigits: '' };
  }

  // Remove the leading + if present
  const digits = fullNumber.startsWith('+') ? fullNumber.slice(1) : fullNumber;

  // Try to find the best matching country by checking dial codes from longest to shortest
  // Dial codes can be 1-4 digits
  for (let len = Math.min(4, digits.length); len >= 1; len--) {
    const potentialDialCode = digits.slice(0, len);
    const country = findCountryByDialDigits(potentialDialCode);
    if (country) {
      return {
        dialDigits: potentialDialCode,
        phoneDigits: digits.slice(len),
      };
    }
  }

  // If no country found, return all digits as phone digits with empty dial code
  return { dialDigits: '', phoneDigits: digits };
}

export const PhoneInput: React.FC<PhoneInputProps> = ({
  value,
  onChangePhone,
  label,
  placeholder = 'Enter phone number',
  required,
  error,
  disabled,
  containerStyle,
  inputStyle,
  colors: customColors,
  onFocus,
  onBlur,
  TextInputComponent = RNTextInput,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;
  const { locale } = useLocale();

  const colors = useMemo(
    () => ({
      text: customColors?.text || themeColors.foreground,
      textMuted: customColors?.textMuted || themeColors.mutedForeground,
      textSecondary: customColors?.textSecondary || (isDark ? neutral[400] : neutral[600]),
      background: customColors?.background || themeColors.background,
      inputBackground: customColors?.inputBackground || themeColors.muted,
      inputBorder: customColors?.inputBorder || themeColors.border,
      primary: customColors?.primary || primary[500],
      error: customColors?.error || status.error.DEFAULT,
      card: customColors?.card || themeColors.card,
    }),
    [customColors, themeColors, isDark]
  );

  // State: raw digits only (no formatting)
  const [dialDigits, setDialDigits] = useState<string>(() => {
    // If value is provided, parse it; otherwise use locale default
    if (value) {
      const parsed = parsePhoneNumber(value);
      return parsed.dialDigits || getLocaleCountry(locale)?.dialCode.replace('+', '') || '';
    }
    const localeCountry = getLocaleCountry(locale);
    return localeCountry?.dialCode.replace('+', '') || '';
  });

  const [phoneDigits, setPhoneDigits] = useState<string>(() => {
    if (value) {
      const parsed = parsePhoneNumber(value);
      return parsed.phoneDigits;
    }
    return '';
  });

  // Track the previous value prop to detect external changes
  const prevValueRef = useRef(value);

  // Sync state when value prop changes externally (e.g., when data is loaded from DB)
  useEffect(() => {
    // Only react to changes in the value prop, not on every render
    if (value === prevValueRef.current) {
      return;
    }

    prevValueRef.current = value;

    // Parse the incoming value
    const parsed = parsePhoneNumber(value || '');

    // Use a callback to defer state updates outside of effect execution
    const updateState = () => {
      if (parsed.dialDigits) {
        setDialDigits(parsed.dialDigits);
      }
      setPhoneDigits(parsed.phoneDigits);
    };
    setImmediate(updateState);
  }, [value]);

  // Derive country from dial digits
  const selectedCountry = useMemo(() => findCountryByDialDigits(dialDigits), [dialDigits]);

  // Format phone digits for display
  const formattedPhone = useMemo(
    () => formatAsYouType(phoneDigits, selectedCountry?.phoneFormat),
    [phoneDigits, selectedCountry?.phoneFormat]
  );

  // Max length for formatted input
  const maxInputLength = selectedCountry?.phoneFormat?.length || 15;

  // Handle dial code changes
  const handleDialCodeChange = useCallback(
    (text: string) => {
      const digits = extractDigits(text).slice(0, 4);
      setDialDigits(digits);

      // Emit change
      const country = findCountryByDialDigits(digits);
      const fullNumber = phoneDigits ? `+${digits}${phoneDigits}` : '';
      onChangePhone(fullNumber, country?.code || '', phoneDigits);
    },
    [phoneDigits, onChangePhone]
  );

  // Handle phone number changes
  const handlePhoneChange = useCallback(
    (text: string) => {
      // Extract digits from the formatted input
      const digits = extractDigits(text);
      const maxDigits = selectedCountry?.phoneLength || 15;
      const limitedDigits = digits.slice(0, maxDigits);

      setPhoneDigits(limitedDigits);

      // Emit change
      const fullNumber = limitedDigits ? `+${dialDigits}${limitedDigits}` : '';
      onChangePhone(fullNumber, selectedCountry?.code || '', limitedDigits);
    },
    [dialDigits, selectedCountry, onChangePhone]
  );

  return (
    <View style={[inputStyles.container, containerStyle]}>
      {label && (
        <Text style={[inputStyles.label, { color: colors.text }]}>
          {label}
          {required && <Text style={{ color: colors.error }}> *</Text>}
        </Text>
      )}

      <View
        style={[
          inputStyles.inputRow,
          {
            backgroundColor: colors.inputBackground,
            borderColor: error ? colors.error : colors.inputBorder,
          },
          disabled && inputStyles.disabled,
        ]}
      >
        {/* Flag or Globe icon */}
        <View style={inputStyles.flagContainer}>
          {selectedCountry ? (
            <Text style={inputStyles.flag}>{selectedCountry.flag}</Text>
          ) : (
            <Ionicons name="globe-outline" size={20} color={colors.textMuted} />
          )}
        </View>

        {/* Country code input */}
        <View style={inputStyles.dialCodeSection}>
          <Text style={[inputStyles.plusSign, { color: colors.text }]}>+</Text>
          <TextInputComponent
            style={[inputStyles.dialCodeInput, { color: colors.text }]}
            value={dialDigits}
            onChangeText={handleDialCodeChange}
            keyboardType="number-pad"
            maxLength={4}
            editable={!disabled}
            onFocus={onFocus}
            onBlur={onBlur}
            selectTextOnFocus
            placeholder="1"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <View style={[inputStyles.separator, { backgroundColor: colors.inputBorder }]} />

        {/* Phone number input */}
        <TextInputComponent
          style={[inputStyles.input, { color: colors.text }, inputStyle]}
          value={formattedPhone}
          onChangeText={handlePhoneChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          maxLength={maxInputLength}
          editable={!disabled}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </View>

      {error && <Text style={[inputStyles.errorText, { color: colors.error }]}>{error}</Text>}
    </View>
  );
};

const inputStyles = StyleSheet.create({
  container: {
    marginBottom: spacingPixels[3],
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacingPixels[1],
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.5,
  },
  flagContainer: {
    paddingLeft: spacingPixels[3],
    paddingRight: spacingPixels[1],
    paddingVertical: spacingPixels[4],
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 32,
  },
  flag: {
    fontSize: 20,
  },
  dialCodeSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacingPixels[3],
  },
  plusSign: {
    fontSize: 16,
    fontWeight: '500',
  },
  dialCodeInput: {
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: Platform.OS === 'ios' ? spacingPixels[4] : spacingPixels[3],
    minWidth: 30,
    maxWidth: 48,
    textAlign: 'left',
  },
  separator: {
    width: 1,
    height: '60%',
  },
  input: {
    flex: 1,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    fontSize: 16,
  },
  errorText: {
    fontSize: 12,
    marginTop: spacingPixels[1],
  },
});

export default PhoneInput;
