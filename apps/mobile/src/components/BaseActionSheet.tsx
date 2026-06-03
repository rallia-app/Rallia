/**
 * BaseActionSheet
 *
 * Reusable wrapper around react-native-actions-sheet that enforces
 * consistent styling, keyboard handling, and safe-area behaviour
 * across all bottom sheets in the app.
 *
 * Usage:
 *   <BaseActionSheet title="Edit Profile" onClose={handleClose} scrollable footer={<SubmitButton />}>
 *     {formContent}
 *   </BaseActionSheet>
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

interface BaseActionSheetProps {
  /** Sheet title — if omitted, no header is rendered */
  title?: string;
  /** Close handler — if omitted, no close button shown in header */
  onClose?: () => void;
  /** Sheet content */
  children: React.ReactNode;
  /** Footer content (e.g. submit button) — rendered with standard border/padding */
  footer?: React.ReactNode;
  /** Wrap children in an actions-sheet ScrollView with keyboardShouldPersistTaps */
  scrollable?: boolean;
  /** Allow drag-to-dismiss (default: true) */
  gestureEnabled?: boolean;
  /** Allow closing the sheet (default: true) */
  closable?: boolean;
  /** Close when tapping backdrop (default: true) */
  closeOnTouchBackdrop?: boolean;
  /** Called before the sheet closes — return false to prevent */
  onBeforeClose?: () => void;
  /** Called after the sheet finishes closing (for state resets) */
  onSheetClose?: () => void;
  /** Use flex: 1 on the container — set false for content-fit sheets (default: true) */
  flex?: boolean;
  /**
   * Hide the drag-handle indicator (and the bare strip it sits on) while
   * keeping the gesture and rounded top corners. Useful when the sheet's own
   * content (e.g. a full-bleed gradient header) should run to the very top.
   */
  hideHandle?: boolean;
}

export function BaseActionSheet({
  title,
  onClose,
  children,
  footer,
  scrollable = false,
  gestureEnabled = true,
  closable = true,
  closeOnTouchBackdrop = true,
  onBeforeClose,
  onSheetClose,
  flex = true,
  hideHandle = false,
}: BaseActionSheetProps) {
  const { colors } = useThemeStyles();

  return (
    <ActionSheet
      gestureEnabled={gestureEnabled}
      closable={closable}
      closeOnTouchBackdrop={closeOnTouchBackdrop}
      onBeforeClose={onBeforeClose}
      onClose={onSheetClose}
      // An empty header replaces (and thus hides) the default drag indicator
      // while leaving the gesture + rounded corners intact.
      CustomHeaderComponent={hideHandle ? <View /> : undefined}
      containerStyle={[
        styles.sheetBackground,
        flex && styles.sheetFlex,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      {title != null && (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text weight="semibold" size="lg" style={{ color: colors.text }}>
              {title}
            </Text>
          </View>
          {onClose && (
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Content */}
      {scrollable ? (
        <ScrollView
          style={flex ? styles.scrollFlex : undefined}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}

      {/* Footer */}
      {footer != null && (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View>
      )}
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
    overflow: 'hidden',
  },
  sheetFlex: {
    flex: 1,
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
  },
  content: {
    padding: spacingPixels[4],
  },
  contentFlex: {
    flex: 1,
  },
  scrollFlex: {
    flex: 1,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
});

export default BaseActionSheet;
