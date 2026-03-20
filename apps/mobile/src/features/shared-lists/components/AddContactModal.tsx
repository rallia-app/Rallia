/**
 * AddContactModal Component
 * Modal for manually adding or editing a contact
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
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import { neutral } from '@rallia/design-system';
import {
  createSharedContact,
  updateSharedContact,
  type SharedContact,
} from '@rallia/shared-services';

export function AddContactActionSheet({ payload }: SheetProps<'add-contact'>) {
  const listId = payload?.listId ?? '';
  const editingContact = payload?.editingContact ?? null;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = !!editingContact;

  // Reset form when sheet opens with new data
  useEffect(() => {
    if (editingContact) {
      setName(editingContact.name);
      setPhone(editingContact.phone || '');
      setEmail(editingContact.email || '');
      setNotes(editingContact.notes || '');
    } else {
      setName('');
      setPhone('');
      setEmail('');
      setNotes('');
    }
  }, [editingContact]);

  const resetForm = useCallback(() => {
    setName('');
    setPhone('');
    setEmail('');
    setNotes('');
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    SheetManager.hide('add-contact');
  }, [resetForm]);

  const validateForm = useCallback((): boolean => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      Alert.alert(t('alerts.error'), t('sharedLists.contacts.nameRequired'));
      return false;
    }

    if (!trimmedPhone && !trimmedEmail) {
      Alert.alert(t('alerts.error'), t('sharedLists.contacts.phoneOrEmailRequired'));
      return false;
    }

    // Basic email validation
    if (trimmedEmail && !trimmedEmail.includes('@')) {
      Alert.alert(t('alerts.error'), t('sharedLists.contacts.invalidEmail'));
      return false;
    }

    return true;
  }, [name, phone, email, t]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      if (isEditing && editingContact) {
        await updateSharedContact({
          id: editingContact.id,
          name: name.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          notes: notes.trim() || undefined,
        });
      } else {
        await createSharedContact({
          list_id: listId,
          name: name.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          notes: notes.trim() || undefined,
          source: 'manual',
        });
      }
      resetForm();
      SheetManager.hide('add-contact');
    } catch (error) {
      console.error('Failed to save contact:', error);
      Alert.alert(
        t('alerts.error'),
        isEditing
          ? t('sharedLists.contacts.failedToUpdate')
          : t('sharedLists.errors.failedToAddContact')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [validateForm, isEditing, editingContact, listId, name, phone, email, notes, resetForm, t]);

  const canSubmit = name.trim() && (phone.trim() || email.trim());

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetBackground,
        styles.container,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCenter}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {isEditing
              ? t('sharedLists.contacts.editContact')
              : t('sharedLists.contacts.addContact')}
          </Text>
        </View>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton} disabled={isSubmitting}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Form */}
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.formContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name Input */}
        <View style={styles.inputGroup}>
          <Text size="sm" weight="medium" style={[styles.label, { color: colors.textSecondary }]}>
            {t('sharedLists.contacts.contactName')} *
          </Text>
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: colors.inputBackground, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="person-outline"
              size={20}
              color={colors.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={name}
              onChangeText={setName}
              placeholder={t('sharedLists.contacts.contactNamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              maxLength={150}
              editable={!isSubmitting}
            />
          </View>
        </View>

        {/* Phone Input */}
        <View style={styles.inputGroup}>
          <Text size="sm" weight="medium" style={[styles.label, { color: colors.textSecondary }]}>
            {t('sharedLists.contacts.contactPhone')}
          </Text>
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: colors.inputBackground, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="call-outline"
              size={20}
              color={colors.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('sharedLists.contacts.contactPhonePlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              maxLength={30}
              editable={!isSubmitting}
            />
          </View>
        </View>

        {/* Email Input */}
        <View style={styles.inputGroup}>
          <Text size="sm" weight="medium" style={[styles.label, { color: colors.textSecondary }]}>
            {t('sharedLists.contacts.contactEmail')}
          </Text>
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: colors.inputBackground, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="mail-outline"
              size={20}
              color={colors.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={email}
              onChangeText={setEmail}
              placeholder={t('sharedLists.contacts.contactEmailPlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              maxLength={255}
              editable={!isSubmitting}
            />
          </View>
        </View>

        {/* Notes Input */}
        <View style={styles.inputGroup}>
          <Text size="sm" weight="medium" style={[styles.label, { color: colors.textSecondary }]}>
            {t('sharedLists.contacts.notes')}
          </Text>
          <View
            style={[
              styles.inputContainer,
              styles.notesContainer,
              { backgroundColor: colors.inputBackground, borderColor: colors.border },
            ]}
          >
            <TextInput
              style={[styles.input, styles.notesInput, { color: colors.text }]}
              value={notes}
              onChangeText={setNotes}
              placeholder={t('sharedLists.contacts.notesPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              maxLength={500}
              textAlignVertical="top"
              editable={!isSubmitting}
            />
          </View>
        </View>

        {/* Hint */}
        <View style={[styles.hint, { backgroundColor: isDark ? neutral[800] : neutral[100] }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
          <Text size="sm" style={{ color: colors.textSecondary, flex: 1, marginLeft: 8 }}>
            {t('sharedLists.contacts.contactMethodRequired')}
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: colors.primary },
            (isSubmitting || !canSubmit) && { opacity: 0.7 },
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting || !canSubmit}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.buttonTextActive} />
          ) : (
            <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
              {isEditing ? t('common.save') : t('sharedLists.contacts.add')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

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
  scrollContent: {
    flex: 1,
  },
  formContent: {
    padding: spacingPixels[4],
  },
  inputGroup: {
    marginBottom: spacingPixels[4],
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
  },
  inputIcon: {
    marginRight: spacingPixels[2],
  },
  input: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    fontSize: fontSizePixels.base,
  },
  notesContainer: {
    alignItems: 'flex-start',
    paddingVertical: spacingPixels[2],
  },
  notesInput: {
    minHeight: 80,
    paddingTop: spacingPixels[1],
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
    paddingBottom: spacingPixels[4],
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
export default AddContactActionSheet;
