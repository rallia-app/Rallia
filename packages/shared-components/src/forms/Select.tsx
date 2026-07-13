/**
 * Select Component (Picker)
 *
 * Dropdown selection component with label, error handling, and validation.
 * Uses React Native Picker for native platform integration.
 *
 * @example
 * ```tsx
 * <Select
 *   label="Gender"
 *   value={gender}
 *   onChange={setGender}
 *   options={[
 *     { label: 'Male', value: 'male' },
 *     { label: 'Female', value: 'female' },
 *   ]}
 *   error={errors.gender}
 * />
 * ```
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Text } from '../foundation/Text';
import { colors, spacing, typography } from '../theme';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SelectProps {
  /**
   * Select label
   */
  label?: string;

  /**
   * Placeholder text when no value selected
   */
  placeholder?: string;

  /**
   * Helper text displayed below select
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
   * Whether select is disabled
   */
  disabled?: boolean;

  /**
   * Currently selected value
   */
  value: string;

  /**
   * Callback when selection changes
   */
  onChange: (value: string) => void;

  /**
   * Available options
   */
  options: SelectOption[];

  /**
   * Custom container style
   */
  containerStyle?: StyleProp<ViewStyle>;

  /**
   * Custom select button style
   */
  selectStyle?: StyleProp<ViewStyle>;
}

export const Select: React.FC<SelectProps> = ({
  label,
  placeholder = 'Select an option',
  helperText,
  error,
  required,
  disabled,
  value,
  onChange,
  options,
  containerStyle,
  selectStyle,
}) => {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const hasError = !!error;
  const selectedOption = options.find(opt => opt.value === value);
  const displayText = selectedOption?.label || placeholder;

  // Determine border color based on state
  const getBorderColor = () => {
    if (hasError) return colors.error;
    if (isFocused) return colors.primary;
    if (disabled) return colors.lightGray;
    return colors.lightGray;
  };

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsModalVisible(false);
    setIsFocused(false);
  };

  const handleOpen = () => {
    if (!disabled) {
      setIsModalVisible(true);
      setIsFocused(true);
    }
  };

  const handleClose = () => {
    setIsModalVisible(false);
    setIsFocused(false);
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

      {/* Select Button */}
      <TouchableOpacity
        style={[
          styles.selectButton,
          {
            borderColor: getBorderColor(),
            backgroundColor: disabled ? colors.veryLightGray : colors.white,
          },
          isFocused && styles.selectButtonFocused,
          selectStyle,
        ]}
        onPress={handleOpen}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label || 'Select'}
        accessibilityState={{ disabled }}
      >
        <Text
          style={[
            styles.selectText,
            ...(!selectedOption ? [styles.placeholderText] : []),
            ...(disabled ? [styles.disabledText] : []),
          ]}
        >
          {displayText}
        </Text>
        <Text style={styles.chevron}>▼</Text>
      </TouchableOpacity>

      {/* Helper Text or Error */}
      <View style={styles.footerContainer}>
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

      {/* Options Modal */}
      <Modal visible={isModalVisible} transparent animationType="fade" onRequestClose={handleClose}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={handleClose}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text weight="semibold" size="lg">
                {label || 'Select an option'}
              </Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Text size="xl">✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={options}
              keyExtractor={item => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.optionItem,
                    item.value === value && styles.optionItemSelected,
                    item.disabled && styles.optionItemDisabled,
                  ]}
                  onPress={() => !item.disabled && handleSelect(item.value)}
                  disabled={item.disabled}
                >
                  <Text
                    style={[
                      styles.optionText,
                      ...(item.value === value ? [styles.optionTextSelected] : []),
                      ...(item.disabled ? [styles.optionTextDisabled] : []),
                    ]}
                  >
                    {item.label}
                  </Text>
                  {item.value === value && (
                    <Text color={colors.primary} weight="bold">
                      ✓
                    </Text>
                  )}
                </TouchableOpacity>
              )}
              style={styles.optionsList}
            />
          </View>
        </TouchableOpacity>
      </Modal>
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
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    minHeight: 48,
  },
  selectButtonFocused: {
    borderWidth: 2,
  },
  selectText: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colors.dark,
  },
  placeholderText: {
    color: colors.gray,
  },
  disabledText: {
    color: colors.gray,
  },
  chevron: {
    fontSize: typography.fontSize.sm,
    color: colors.gray,
    marginLeft: spacing[2],
  },
  footerContainer: {
    marginTop: spacing[1],
    minHeight: 20,
  },
  helperText: {
    fontSize: typography.fontSize.sm,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  modalContent: {
    backgroundColor: colors.white,
    borderRadius: 12,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray,
  },
  closeButton: {
    padding: spacing[2],
  },
  optionsList: {
    maxHeight: 400,
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.veryLightGray,
  },
  optionItemSelected: {
    backgroundColor: colors.primaryLight,
  },
  optionItemDisabled: {
    opacity: 0.5,
  },
  optionText: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colors.dark,
  },
  optionTextSelected: {
    fontWeight: typography.fontWeight.semibold,
    color: colors.primary,
  },
  optionTextDisabled: {
    color: colors.gray,
  },
});

// Export default for convenience
export default Select;
