/**
 * Input Component
 *
 * Flexible text input component with label, error handling, and validation.
 * Supports multiple input types and accessibility features.
 *
 * @example
 * ```tsx
 * <Input
 *   label="Email"
 *   type="email"
 *   value={email}
 *   onChangeText={setEmail}
 *   error={errors.email}
 *   required
 * />
 * ```
 */

import React, { useState } from 'react';
import {
  TextInput,
  View,
  StyleSheet,
  TextInputProps,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { Text } from '../foundation/Text';
import { colors, spacing, typography } from '../theme';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  /**
   * Input type - affects keyboard and validation
   */
  type?: 'text' | 'email' | 'password' | 'number' | 'phone' | 'url';

  /**
   * Input label
   */
  label?: string;

  /**
   * Helper text displayed below input
   */
  helperText?: string;

  /**
   * Error message - displays in red when present
   */
  error?: string;

  /**
   * Whether field is required
   */
  required?: boolean;

  /**
   * Whether input is disabled
   */
  disabled?: boolean;

  /**
   * Current input value
   */
  value: string;

  /**
   * Callback when text changes
   */
  onChangeText: (text: string) => void;

  /**
   * Icon to display on the left side
   */
  leftIcon?: React.ReactNode;

  /**
   * Icon to display on the right side
   */
  rightIcon?: React.ReactNode;

  /**
   * Custom container style
   */
  containerStyle?: ViewStyle;

  /**
   * Custom input style
   */
  inputStyle?: ViewStyle;

  /**
   * Maximum character length
   */
  maxLength?: number;

  /**
   * Whether to show character count
   */
  showCharCount?: boolean;
}

/**
 * Get keyboard type based on input type
 */
const getKeyboardType = (type?: InputProps['type']): TextInputProps['keyboardType'] => {
  switch (type) {
    case 'email':
      return 'email-address';
    case 'number':
      return 'numeric';
    case 'phone':
      return 'phone-pad';
    case 'url':
      return 'url';
    default:
      return 'default';
  }
};

/**
 * Get text content type for autofill
 */
const getTextContentType = (type?: InputProps['type']): TextInputProps['textContentType'] => {
  switch (type) {
    case 'email':
      return 'emailAddress';
    case 'password':
      return 'password';
    case 'phone':
      return 'telephoneNumber';
    case 'url':
      return 'URL';
    default:
      return 'none';
  }
};

/**
 * Get autocomplete type
 */
const getAutoComplete = (type?: InputProps['type']): TextInputProps['autoComplete'] => {
  switch (type) {
    case 'email':
      return 'email';
    case 'password':
      return 'password';
    case 'phone':
      return 'tel';
    case 'url':
      return 'url';
    default:
      return 'off';
  }
};

export const Input: React.FC<InputProps> = ({
  type = 'text',
  label,
  helperText,
  error,
  required,
  disabled,
  value,
  onChangeText,
  leftIcon,
  rightIcon,
  containerStyle,
  inputStyle,
  maxLength,
  showCharCount,
  placeholder,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const hasError = !!error;
  const isPassword = type === 'password';
  const charCount = value.length;
  const isMaxLength = maxLength && charCount >= maxLength;

  // Determine border color based on state
  const getBorderColor = () => {
    if (hasError) return colors.error;
    if (isFocused) return colors.primary;
    if (disabled) return colors.lightGray;
    return colors.lightGray;
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {/* Label */}
      {label && (
        <View style={styles.labelContainer}>
          <Text variant="label" style={styles.label}>
            {label}
            {required && <Text color={colors.error}> *</Text>}
          </Text>
        </View>
      )}

      {/* Input Container */}
      <View
        style={[
          styles.inputContainer,
          {
            borderColor: getBorderColor(),
            backgroundColor: disabled ? colors.veryLightGray : colors.white,
          },
          isFocused && styles.inputContainerFocused,
        ]}
      >
        {/* Left Icon */}
        {leftIcon && <View style={styles.leftIconContainer}>{leftIcon}</View>}

        {/* Text Input */}
        <TextInput
          style={[
            styles.input,
            leftIcon ? styles.inputWithLeftIcon : undefined,
            rightIcon || isPassword ? styles.inputWithRightIcon : undefined,
            disabled ? styles.inputDisabled : undefined,
            inputStyle,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.gray}
          editable={!disabled}
          keyboardType={getKeyboardType(type)}
          textContentType={getTextContentType(type)}
          autoComplete={getAutoComplete(type)}
          secureTextEntry={isPassword && !showPassword}
          maxLength={maxLength}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...props}
        />

        {/* Password Toggle or Right Icon */}
        {isPassword ? (
          <TouchableOpacity
            style={styles.rightIconContainer}
            onPress={() => setShowPassword(!showPassword)}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            accessibilityRole="button"
          >
            <Text size="sm" color={colors.gray}>
              {showPassword ? '👁️' : '👁️‍🗨️'}
            </Text>
          </TouchableOpacity>
        ) : rightIcon ? (
          <View style={styles.rightIconContainer}>{rightIcon}</View>
        ) : null}
      </View>

      {/* Helper Text, Error, or Character Count */}
      <View style={styles.footerContainer}>
        <View style={styles.messageContainer}>
          {error ? (
            <Text size="sm" color={colors.error} style={styles.errorText}>
              {error}
            </Text>
          ) : helperText ? (
            <Text size="sm" color={colors.gray} style={styles.helperText}>
              {helperText}
            </Text>
          ) : null}
        </View>

        {showCharCount && maxLength && (
          <Text size="sm" color={isMaxLength ? colors.error : colors.gray} style={styles.charCount}>
            {charCount}/{maxLength}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing[4],
  },
  labelContainer: {
    marginBottom: spacing[2],
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.dark,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing[3],
    minHeight: 48,
  },
  inputContainerFocused: {
    borderWidth: 2,
  },
  input: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colors.dark,
    paddingVertical: spacing[3],
  },
  inputWithLeftIcon: {
    marginLeft: spacing[2],
  },
  inputWithRightIcon: {
    marginRight: spacing[2],
  },
  inputDisabled: {
    color: colors.gray,
  },
  leftIconContainer: {
    marginRight: spacing[2],
  },
  rightIconContainer: {
    marginLeft: spacing[2],
    padding: spacing[1],
  },
  footerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: spacing[1],
    minHeight: 20,
  },
  messageContainer: {
    flex: 1,
  },
  helperText: {
    fontSize: typography.fontSize.sm,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
  },
  charCount: {
    fontSize: typography.fontSize.sm,
    marginLeft: spacing[2],
  },
});

// Export default for convenience
export default Input;
