/**
 * AttachmentPickerActionSheet
 *
 * Bottom sheet shown when the user taps the paperclip in the chat composer.
 * Lets them pick from camera (photo or video), photo library, or document
 * picker. The actual picking is handed off to callbacks supplied by the
 * composer so it can drive the per-attachment upload flow.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { useTranslation } from '../../../hooks';

const SHEET_ID = 'attachment-picker';

type AttachmentPickerOption = 'photo' | 'video' | 'library' | 'document';

export interface AttachmentPickerSheetPayload {
  onSelect: (option: AttachmentPickerOption) => void;
}

export function AttachmentPickerActionSheet({ payload }: SheetProps<'attachment-picker'>) {
  const onSelect = payload?.onSelect;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  const colors = {
    cardBackground: themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    border: themeColors.border,
    iconPrimary: primary[500],
    iconBg: isDark ? neutral[800] : neutral[100],
  };

  const handlePick = useCallback(
    async (option: AttachmentPickerOption) => {
      void lightHaptic();
      await SheetManager.hide(SHEET_ID);
      // Small delay so sheet is fully gone before native pickers fire.
      setTimeout(() => onSelect?.(option), 250);
    },
    [onSelect]
  );

  const handleClose = useCallback(() => {
    void lightHaptic();
    void SheetManager.hide(SHEET_ID);
  }, []);

  const options: Array<{
    key: AttachmentPickerOption;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
  }> = [
    {
      key: 'photo',
      icon: 'camera-outline',
      label: t('chat.input.attachmentPicker.takePhoto'),
    },
    {
      key: 'video',
      icon: 'videocam-outline',
      label: t('chat.input.attachmentPicker.recordVideo'),
    },
    {
      key: 'library',
      icon: 'images-outline',
      label: t('chat.input.attachmentPicker.photoLibrary'),
    },
    {
      key: 'document',
      icon: 'document-outline',
      label: t('chat.input.attachmentPicker.document'),
    },
  ];

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheet, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handle, { backgroundColor: colors.border }]}
    >
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={styles.titleSpacer} />
          <Text size="lg" weight="semibold" color={colors.text}>
            {t('chat.input.attachmentPicker.title')}
          </Text>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          >
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {options.map((opt, index) => (
          <TouchableOpacity
            key={opt.key}
            onPress={() => void handlePick(opt.key)}
            activeOpacity={0.75}
            style={[
              styles.option,
              index < options.length - 1 && {
                borderBottomColor: colors.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.iconBg }]}>
              <Ionicons name={opt.icon} size={22} color={colors.iconPrimary} />
            </View>
            <Text size="base" weight="medium" color={colors.text}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handle: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  body: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[4],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[3],
  },
  titleSpacer: {
    width: 44,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[4],
  },
});
