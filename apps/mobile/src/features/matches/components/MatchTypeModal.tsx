/**
 * Match Type Modal
 *
 * Bottom sheet modal to select Single or Double match type.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';

export type MatchType = 'single' | 'double';

export function MatchTypeActionSheet({ payload }: SheetProps<'match-type'>) {
  const onSelect = payload?.onSelect;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const handleSelect = useCallback(
    (type: MatchType) => {
      onSelect?.(type);
      SheetManager.hide('match-type');
    },
    [onSelect]
  );

  const options: { type: MatchType; labelKey: TranslationKey; icon: string }[] = [
    { type: 'single', labelKey: 'match.format.singles', icon: 'person' },
    { type: 'double', labelKey: 'match.format.doubles', icon: 'people' },
  ];

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Title */}
        <Text weight="semibold" size="lg" style={[styles.title, { color: colors.text }]}>
          {t('match.pickMatchType')}
        </Text>

        {/* Options */}
        <View style={styles.options}>
          {options.map(option => (
            <TouchableOpacity
              key={option.type}
              style={[
                styles.optionButton,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => handleSelect(option.type)}
              activeOpacity={0.7}
            >
              <View
                style={[styles.iconContainer, { backgroundColor: isDark ? '#2C2C2E' : '#F0F0F0' }]}
              >
                <Ionicons
                  name={option.icon as keyof typeof Ionicons.glyphMap}
                  size={24}
                  color={colors.textSecondary}
                />
              </View>
              <Text weight="medium" size="base" style={{ color: colors.text, marginLeft: 16 }}>
                {t(option.labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cancel button */}
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => SheetManager.hide('match-type')}
        >
          <Text weight="medium" size="base" style={{ color: colors.textSecondary }}>
            {t('common.cancel')}
          </Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const MatchTypeModal = MatchTypeActionSheet;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  container: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
    paddingBottom: spacingPixels[4],
    paddingTop: 12,
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 24,
  },
  options: {
    paddingHorizontal: spacingPixels[6],
    gap: spacingPixels[3],
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 12,
  },
});
