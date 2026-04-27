/**
 * EditMessageModal Component
 * Modal for editing a message
 */

import React, { useState, useCallback, useEffect, memo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import {
  spacingPixels,
  fontSizePixels,
  primary,
  neutral,
  radiusPixels,
} from '@rallia/design-system';

function EditMessageModalComponent({ payload }: SheetProps<'edit-message'>) {
  const message = payload?.message ?? null;
  const onSave = payload?.onSave;
  const isSaving = payload?.isSaving ?? false;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [textValue, setTextValue] = useState('');
  const [charCount, setCharCount] = useState(0);

  // Initialize content when modal opens with a new message (defer setState to avoid synchronous setState-in-effect)
  useEffect(() => {
    if (message) {
      const content = message.content ?? '';
      queueMicrotask(() => {
        setTextValue(content);
        setCharCount(content.length);
      });
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const handleClose = useCallback(() => {
    inputRef.current?.blur();
    SheetManager.hide('edit-message');
  }, []);

  const handleTextChange = useCallback((text: string) => {
    setTextValue(text);
    setCharCount(text.length);
  }, []);

  const handleSave = useCallback(() => {
    inputRef.current?.blur();
    const trimmed = textValue.trim();
    if (trimmed && trimmed !== message?.content) {
      onSave?.(trimmed);
    }
    SheetManager.hide('edit-message');
  }, [message, onSave, textValue]);

  const canSave = textValue.trim().length > 0 && textValue.trim() !== message?.content && !isSaving;

  if (!message) return null;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerSpacer} />
          <Text style={[styles.title, { color: colors.text }]}>{t('chat.editMessage')}</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.scrollContentContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Original message preview */}
          <View
            style={[
              styles.originalContainer,
              { backgroundColor: isDark ? neutral[800] : neutral[100] },
            ]}
          >
            <Text style={[styles.originalLabel, { color: colors.textMuted }]}>
              {t('chat.original')}:
            </Text>
            <Text style={[styles.originalText, { color: colors.textMuted }]} numberOfLines={2}>
              {message.content}
            </Text>
          </View>

          {/* Edit input */}
          <View style={styles.inputContainer}>
            <TextInput
              key={message.id}
              ref={inputRef}
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: isDark ? neutral[800] : neutral[100],
                  borderColor: colors.border,
                },
              ]}
              value={textValue}
              onChangeText={handleTextChange}
              placeholder={t('chat.editYourMessage')}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={2000}
              textAlignVertical="top"
            />
          </View>

          {/* Character count */}
          <Text style={[styles.charCount, { color: colors.textMuted }]}>{charCount} / 2000</Text>
        </ScrollView>

        {/* Sticky Save button */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            onPress={handleSave}
            style={[
              styles.saveButtonBottom,
              { backgroundColor: canSave ? primary[500] : colors.border },
              !canSave && styles.saveButtonDisabled,
            ]}
            disabled={!canSave}
          >
            <Text
              size="lg"
              weight="semibold"
              color={canSave ? colors.buttonTextActive : colors.textMuted}
            >
              {isSaving ? t('common.saving') : t('common.save')}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ActionSheet>
  );
}

export const EditMessageActionSheet = memo(EditMessageModalComponent);

// Keep old export for backwards compatibility during migration
export const EditMessageModal = EditMessageActionSheet;

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  headerSpacer: {
    width: 24 + spacingPixels[1] * 2, // Match close button width
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  title: {
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingBottom: spacingPixels[4],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[4],
  },
  saveButtonBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  originalContainer: {
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    padding: spacingPixels[3],
    borderRadius: 8,
  },
  originalLabel: {
    fontSize: fontSizePixels.xs,
    fontWeight: '500',
    marginBottom: spacingPixels[1],
  },
  originalText: {
    fontSize: fontSizePixels.sm,
    fontStyle: 'italic',
  },
  inputContainer: {
    padding: spacingPixels[4],
  },
  input: {
    fontSize: fontSizePixels.base,
    padding: spacingPixels[3],
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 100,
    maxHeight: 200,
  },
  charCount: {
    fontSize: fontSizePixels.xs,
    textAlign: 'right',
    paddingHorizontal: spacingPixels[4],
  },
});
