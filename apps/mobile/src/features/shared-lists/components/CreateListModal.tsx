/**
 * CreateListModal Component
 * Modal for creating or editing a shared contact list
 *
 * Contains:
 * - CreateListForm: Standalone form component (used in ActionSheet and wizard)
 * - CreateListActionSheet: Thin ActionSheet wrapper
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import { neutral } from '@rallia/design-system';
import {
  createSharedContactList,
  updateSharedContactList,
  type SharedContactList,
} from '@rallia/shared-services';

// =============================================================================
// FORM COMPONENT
// =============================================================================

interface CreateListFormProps {
  editingList?: SharedContactList | null;
  onSuccess?: (listId: string) => void;
  onCancel?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
}

export const CreateListForm: React.FC<CreateListFormProps> = ({
  editingList,
  onSuccess,
  onCancel,
  containerStyle,
}) => {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = !!editingList;

  useEffect(() => {
    if (editingList) {
      setName(editingList.name);
      setDescription(editingList.description || '');
    } else {
      setName('');
      setDescription('');
    }
  }, [editingList]);

  const resetForm = useCallback(() => {
    setName('');
    setDescription('');
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert(t('alerts.error'), t('sharedLists.errors.nameRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing && editingList) {
        await updateSharedContactList({
          id: editingList.id,
          name: trimmedName,
          description: description.trim() || undefined,
        });
        resetForm();
        onSuccess?.(editingList.id);
      } else {
        const newList = await createSharedContactList({
          name: trimmedName,
          description: description.trim() || undefined,
        });
        resetForm();
        onSuccess?.(newList.id);
      }
    } catch (error) {
      console.error('Failed to save list:', error);
      Alert.alert(
        t('alerts.error'),
        isEditing ? t('sharedLists.errors.failedToUpdate') : t('sharedLists.errors.failedToCreate')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [name, description, isEditing, editingList, resetForm, onSuccess, t]);

  return (
    <View style={[styles.formContainer, containerStyle]}>
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name Input */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text weight="medium" size="sm" style={{ color: colors.text }}>
              {t('sharedLists.listName')} *
            </Text>
            <Text size="xs" style={{ color: colors.textMuted }}>
              {name.length}/100
            </Text>
          </View>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            value={name}
            onChangeText={setName}
            placeholder={t('sharedLists.listNamePlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoFocus
            maxLength={100}
            editable={!isSubmitting}
          />
        </View>

        {/* Description Input */}
        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text weight="medium" size="sm" style={{ color: colors.text }}>
              {t('sharedLists.listDescription')}
            </Text>
            <Text size="xs" style={{ color: colors.textMuted }}>
              {description.length}/500
            </Text>
          </View>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('sharedLists.listDescriptionPlaceholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
            maxLength={500}
            textAlignVertical="top"
            editable={!isSubmitting}
          />
        </View>

        {/* Hint */}
        <View style={[styles.hint, { backgroundColor: isDark ? neutral[800] : neutral[100] }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
          <Text size="sm" style={{ color: colors.textSecondary, flex: 1, marginLeft: 8 }}>
            {t('sharedLists.createListHint')}
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: colors.primary },
            (isSubmitting || !name.trim()) && { opacity: 0.7 },
          ]}
          onPress={() => void handleSubmit()}
          disabled={isSubmitting || !name.trim()}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.buttonTextActive} />
          ) : (
            <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
              {isEditing ? t('common.save') : t('sharedLists.createList')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// =============================================================================
// ACTION SHEET WRAPPER
// =============================================================================

export function CreateListActionSheet({ payload }: SheetProps<'create-list'>) {
  const editingList = payload?.editingList ?? null;
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const isEditing = !!editingList;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Track form state for unsaved changes check
  useEffect(() => {
    if (editingList) {
      setName(editingList.name);
      setDescription(editingList.description || '');
    } else {
      setName('');
      setDescription('');
    }
  }, [editingList]);

  const hasUnsavedChanges = useCallback(() => {
    if (isEditing && editingList) {
      return (
        name.trim() !== editingList.name || description.trim() !== (editingList.description || '')
      );
    }
    return name.trim() !== '' || description.trim() !== '';
  }, [isEditing, editingList, name, description]);

  const handleClose = useCallback(() => {
    if (hasUnsavedChanges()) {
      Alert.alert(t('sharedLists.discardChanges'), t('sharedLists.discardChangesMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('sharedLists.discard'),
          style: 'destructive',
          onPress: () => {
            SheetManager.hide('create-list');
          },
        },
      ]);
    } else {
      SheetManager.hide('create-list');
    }
  }, [hasUnsavedChanges, t]);

  const handleSuccess = useCallback((_listId: string) => {
    SheetManager.hide('create-list');
  }, []);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetBackground,
        styles.sheetContainer,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCenter}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {isEditing ? t('sharedLists.editList') : t('sharedLists.newList')}
          </Text>
        </View>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <CreateListForm editingList={editingList} onSuccess={handleSuccess} onCancel={handleClose} />
    </ActionSheet>
  );
}

// =============================================================================
// STYLES
// =============================================================================

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
  sheetContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    alignItems: 'center',
  },
  closeButton: {
    padding: 4,
    position: 'absolute',
    right: 16,
  },
  formContainer: {
    flex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    flex: 0,
    padding: 16,
    gap: 20,
  },
  inputGroup: {
    gap: 0,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    fontSize: fontSizePixels.base,
  },
  textArea: {
    minHeight: 100,
    paddingTop: spacingPixels[3],
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    gap: spacingPixels[2],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});

// Keep default export for backwards compatibility during migration
export default CreateListActionSheet;
