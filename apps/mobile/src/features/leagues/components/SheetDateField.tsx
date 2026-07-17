/**
 * SheetDateField
 *
 * A tappable date/time field for use inside an ActionSheet. Renders the value
 * as a labelled field and opens a platform-appropriate picker: an inline
 * one-shot dialog on Android, a modal spinner on iOS. Mirrors the picker
 * convention from SuggestMatchTimeSheet.
 */

import React, { useCallback, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { useTranslation } from '#/hooks';

interface FieldColors {
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  cardBackground: string;
}

interface SheetDateFieldProps {
  label: string;
  value: Date;
  displayValue: string;
  mode: 'date' | 'time';
  minimumDate?: Date;
  maximumDate?: Date;
  onChange: (date: Date) => void;
  colors: FieldColors;
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SheetDateField({
  label,
  value,
  displayValue,
  mode,
  minimumDate,
  maximumDate,
  onChange,
  colors,
  isDark,
  style,
  testID,
}: SheetDateFieldProps) {
  const { t } = useTranslation();
  const [showPicker, setShowPicker] = useState(false);
  const [tempValue, setTempValue] = useState<Date>(value);

  const openPicker = useCallback(() => {
    lightHaptic();
    setTempValue(value);
    setShowPicker(true);
  }, [value]);

  const handleChange = useCallback(
    (_event: unknown, date?: Date) => {
      // Android fires once on selection — commit immediately and dismiss.
      if (Platform.OS === 'android') {
        setShowPicker(false);
        if (date) onChange(date);
        return;
      }
      if (date) setTempValue(date);
    },
    [onChange]
  );

  const handleDone = useCallback(() => {
    onChange(tempValue);
    setShowPicker(false);
  }, [onChange, tempValue]);

  return (
    <>
      <TouchableOpacity
        onPress={openPicker}
        activeOpacity={0.7}
        style={[styles.field, { borderColor: colors.border }, style]}
        testID={testID}
      >
        <Text size="sm" color={colors.textMuted}>
          {label}
        </Text>
        <Text size="base" weight="medium" color={colors.text}>
          {displayValue}
        </Text>
      </TouchableOpacity>

      {/* Android: one-shot dialog rendered inline. */}
      {showPicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={tempValue}
          mode={mode}
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={handleChange}
        />
      )}

      {/* iOS: modal spinner with Cancel/Done header. */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPicker(false)}
        >
          <Pressable style={styles.overlay} onPress={() => setShowPicker(false)}>
            <View style={[styles.modal, { backgroundColor: colors.cardBackground }]}>
              <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => setShowPicker(false)} style={styles.headerButton}>
                  <Text size="base" color={colors.textMuted}>
                    {t('common.cancel')}
                  </Text>
                </TouchableOpacity>
                <Text size="base" weight="semibold" color={colors.text}>
                  {label}
                </Text>
                <TouchableOpacity onPress={handleDone} style={styles.headerButton}>
                  <Text size="base" weight="semibold" color={colors.primary}>
                    {t('common.done')}
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempValue}
                mode={mode}
                display="spinner"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={handleChange}
                themeVariant={isDark ? 'dark' : 'light'}
                style={styles.iosPicker}
              />
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    gap: spacingPixels[1],
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    width: '80%',
    borderRadius: radiusPixels.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  headerButton: { paddingVertical: spacingPixels[1] },
  iosPicker: { width: '100%' },
});

export default SheetDateField;
