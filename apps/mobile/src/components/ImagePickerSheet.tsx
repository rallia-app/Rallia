/**
 * ImagePickerSheet - Custom bottom sheet for image selection
 *
 * Replaces the native Alert.alert with a styled bottom sheet that matches
 * the app's design system, providing options for camera and gallery.
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

export function ImagePickerActionSheet({ payload }: SheetProps<'image-picker'>) {
  const onTakePhoto = payload?.onTakePhoto;
  const onChooseFromGallery = payload?.onChooseFromGallery;
  const title = payload?.title ?? 'Change Profile Picture';
  const cameraLabel = payload?.cameraLabel ?? 'Take Photo';
  const galleryLabel = payload?.galleryLabel ?? 'Choose from Gallery';
  const cameraDisabled = payload?.cameraDisabled ?? false;
  const galleryDisabled = payload?.galleryDisabled ?? false;

  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  const handleClose = useCallback(() => {
    void lightHaptic();
    void SheetManager.hide('image-picker');
  }, []);

  const handleTakePhoto = useCallback(() => {
    void lightHaptic();
    onTakePhoto?.();
    void SheetManager.hide('image-picker');
  }, [onTakePhoto]);

  const handleChooseGallery = useCallback(() => {
    void lightHaptic();
    onChooseFromGallery?.();
    void SheetManager.hide('image-picker');
  }, [onChooseFromGallery]);

  const colors = {
    background: themeColors.background,
    cardBackground: themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    border: themeColors.border,
    iconPrimary: primary[500],
    iconSecondary: isDark ? neutral[400] : neutral[500],
    overlay: 'rgba(0, 0, 0, 0.5)',
    danger: '#EF4444',
  };

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.sheet}>
        {/* Title + Close */}
        <View style={styles.titleRow}>
          <View style={styles.titleSpacer} />
          <Text size="lg" weight="semibold" color={colors.text}>
            {title}
          </Text>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Options */}
        <View style={styles.optionsContainer}>
          {/* Take Photo */}
          <TouchableOpacity
            style={[styles.optionButton, { borderBottomColor: colors.border }]}
            onPress={handleTakePhoto}
            disabled={cameraDisabled}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.optionIconContainer,
                { backgroundColor: isDark ? neutral[800] : neutral[100] },
              ]}
            >
              <Ionicons
                name="camera"
                size={22}
                color={cameraDisabled ? colors.textMuted : colors.iconPrimary}
              />
            </View>
            <Text
              size="base"
              weight="medium"
              color={cameraDisabled ? colors.textMuted : colors.text}
            >
              {cameraLabel}
            </Text>
          </TouchableOpacity>

          {/* Choose from Gallery */}
          <TouchableOpacity
            style={[styles.optionButton, { borderBottomWidth: 0 }]}
            onPress={handleChooseGallery}
            disabled={galleryDisabled}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.optionIconContainer,
                { backgroundColor: isDark ? neutral[800] : neutral[100] },
              ]}
            >
              <Ionicons
                name="images"
                size={22}
                color={galleryDisabled ? colors.textMuted : colors.iconPrimary}
              />
            </View>
            <Text
              size="base"
              weight="medium"
              color={galleryDisabled ? colors.textMuted : colors.text}
            >
              {galleryLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
const ImagePickerSheet = ImagePickerActionSheet;
export default ImagePickerSheet;

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  sheet: {
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
  optionsContainer: {
    marginTop: spacingPixels[2],
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
  },
  optionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[4],
  },
});
