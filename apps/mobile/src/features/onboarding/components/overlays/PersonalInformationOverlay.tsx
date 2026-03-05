import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text, useToast } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { PhoneInput } from '../../../../components/PhoneInput';
import { useImagePicker, useThemeStyles, useTranslation } from '../../../../hooks';
import {
  validateFullName,
  validateUsername,
  lightHaptic,
  mediumHaptic,
  selectionHaptic,
} from '@rallia/shared-utils';
import { OnboardingService, supabase, Logger } from '@rallia/shared-services';
import { uploadImage, replaceImage } from '../../../../services/imageUpload';
import { GENDER_VALUES } from '@rallia/shared-types';
import type { GenderEnum } from '@rallia/shared-types';
import ProgressIndicator from '../ProgressIndicator';
import { radiusPixels, spacingPixels } from '@rallia/design-system';

export function PersonalInformationActionSheet({ payload }: SheetProps<'personal-information'>) {
  const mode = payload?.mode || 'onboarding';
  const onClose = () => SheetManager.hide('personal-information');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _onBack = payload?.onBack;
  const onContinue = payload?.onContinue;
  const onSave = payload?.onSave;
  const currentStep = payload?.currentStep || 1;
  const totalSteps = payload?.totalSteps || 8;
  const initialData = payload?.initialData;
  const { colors } = useThemeStyles();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { t } = useTranslation();
  const toast = useToast();
  const [firstName, setFirstName] = useState(initialData?.firstName || '');
  const [lastName, setLastName] = useState(initialData?.lastName || '');
  const [username, setUsername] = useState(initialData?.username || '');
  const [email] = useState(initialData?.email || ''); // Email is read-only in edit mode
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(
    initialData?.dateOfBirth ? new Date(initialData.dateOfBirth) : null
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [gender, setGender] = useState(initialData?.gender || '');
  const [phoneNumber, setPhoneNumber] = useState(initialData?.phoneNumber || '');

  // Use custom hook for image picker
  const { image: profileImage, pickImage } = useImagePicker();

  // Track saving state
  const [isSaving, setIsSaving] = useState(false);

  // Validation handlers using utility functions
  const handleFirstNameChange = (text: string) => {
    setFirstName(validateFullName(text));
  };

  const handleLastNameChange = (text: string) => {
    setLastName(validateFullName(text));
  };

  const handleUsernameChange = (text: string) => {
    setUsername(validateUsername(text));
  };

  const handlePhoneNumberChange = useCallback(
    (fullNumber: string, _countryCode: string, _localNumber: string) => {
      setPhoneNumber(fullNumber);
    },
    []
  );

  const handleDateChange = (_event: unknown, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      // Android: native dialog dismisses automatically
      setShowDatePicker(false);
      if (selectedDate) {
        setDateOfBirth(selectedDate);
      }
    } else if (selectedDate) {
      // iOS: update value, modal stays open until Done pressed
      setDateOfBirth(selectedDate);
    }
  };

  const handleDatePickerDone = () => {
    setShowDatePicker(false);
  };

  const handleDatePickerCancel = () => {
    setShowDatePicker(false);
  };

  const formatDate = (date: Date | null): string => {
    if (!date) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  };

  const handleContinue = async () => {
    if (isSaving) return;

    mediumHaptic();

    if (!dateOfBirth) {
      toast.error(t('onboarding.validation.selectDateOfBirth'));
      return;
    }

    try {
      // Gender is now stored as the enum value (e.g., 'male', 'female')
      if (!gender) {
        toast.error(t('onboarding.validation.selectGender'));
        return;
      }

      setIsSaving(true);

      // Format date to YYYY-MM-DD for database
      const formattedDate = dateOfBirth.toISOString().split('T')[0];

      // Upload profile picture if a new one was selected
      let uploadedImageUrl: string | null = null;
      if (profileImage) {
        // In edit mode, use replaceImage to delete the old image
        // In onboarding mode, use uploadImage (no old image to delete)
        const oldImageUrl = mode === 'edit' ? initialData?.profilePictureUrl : undefined;
        const { url, error: uploadError } = oldImageUrl
          ? await replaceImage(profileImage, oldImageUrl, 'profile-pictures')
          : await uploadImage(profileImage, 'profile-pictures');

        if (uploadError) {
          Logger.error('Failed to upload profile picture', uploadError as Error);
          setIsSaving(false);
          toast.error(t('onboarding.validation.failedToUploadPicture'));
          return;
        } else {
          uploadedImageUrl = url;
        }
      }

      if (mode === 'edit') {
        // Edit mode: Update existing profile data
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setIsSaving(false);
          toast.error(t('onboarding.validation.playerNotFound'));
          return;
        }

        const updateData: {
          first_name: string;
          last_name: string;
          display_name: string;
          birth_date: string;
          phone: string;
          updated_at: string;
          profile_picture_url?: string;
        } = {
          first_name: firstName,
          last_name: lastName,
          display_name: username,
          birth_date: formattedDate,
          phone: phoneNumber,
          updated_at: new Date().toISOString(),
        };

        // Only update profile picture if a new one was uploaded
        if (uploadedImageUrl) {
          updateData.profile_picture_url = uploadedImageUrl;
        }

        const { error: updateError } = await supabase
          .from('profile')
          .update(updateData)
          .eq('id', user.id);

        if (updateError) {
          Logger.error('Failed to update profile', updateError as Error, { userId: user.id });
          setIsSaving(false);
          toast.error(t('onboarding.validation.failedToUpdateProfile'));
          return;
        }

        // Update player table gender
        const { error: playerUpdateError } = await supabase
          .from('player')
          .update({
            gender: gender as GenderEnum,
          })
          .eq('id', user.id);

        if (playerUpdateError) {
          Logger.error('Failed to update player gender', playerUpdateError as Error, {
            userId: user.id,
          });
        }

        // Sync display_name to auth.users metadata (phone is already in profile table)
        const { error: authUpdateError } = await supabase.auth.updateUser({
          data: { display_name: username },
        });

        if (authUpdateError) {
          Logger.warn('Failed to sync display_name to auth.users', {
            error: authUpdateError.message,
            userId: user.id,
          });
          // Don't block the save - profile table is already updated
        }

        toast.success(t('onboarding.successMessages.personalInfoUpdated'));

        // Notify parent that data was saved successfully
        onSave?.();

        // Close modal automatically after brief delay
        setTimeout(() => {
          SheetManager.hide('personal-information');
        }, 500);
      } else {
        // Onboarding mode: Save new personal information
        const { error } = await OnboardingService.savePersonalInfo({
          first_name: firstName,
          last_name: lastName,
          display_name: username,
          birth_date: formattedDate,
          gender: gender as GenderEnum,
          phone: phoneNumber,
          profile_picture_url: uploadedImageUrl || undefined,
        });

        if (error) {
          Logger.error('Failed to save personal info during onboarding', error as Error, {
            hasProfileImage: !!uploadedImageUrl,
          });
          toast.error(t('onboarding.validation.failedToSaveInfo'));
          return;
        }

        // Sync username (display name) to auth.users metadata
        // Note: Phone is stored in profile table, not auth.users (requires verification)
        Logger.debug('Syncing username to auth.users', { username });
        const { error: authUpdateError } = await supabase.auth.updateUser({
          data: {
            display_name: username, // Sync username to display_name in user_metadata
          },
        });

        if (authUpdateError) {
          Logger.warn('Failed to sync username to auth.users', {
            error: authUpdateError.message,
          });
          // Don't block onboarding if this fails - data is already saved to profile table
        } else {
          Logger.debug('Username synced to auth.users successfully', { username });
        }

        Logger.info('Personal info saved successfully during onboarding', {
          hasFirstName: !!firstName,
          hasLastName: !!lastName,
          hasUsername: !!username,
          hasGender: !!gender,
          hasPhone: !!phoneNumber,
          hasProfileImage: !!profileImage,
        });

        if (onContinue) {
          onContinue();
        }
      }
    } catch (error) {
      Logger.error('Unexpected error saving personal info', error as Error, { mode });
      toast.error(t('onboarding.validation.unexpectedError'));
    }
  };

  const isFormValid =
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    username.trim() !== '' &&
    dateOfBirth !== null &&
    gender.trim() !== '' &&
    phoneNumber.trim() !== '';

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text weight="semibold" size="lg" style={{ color: colors.text }}>
              {mode === 'onboarding'
                ? t('onboarding.personalInfoStep.title')
                : t('profile.editSheets.personalInfoTitle')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={[styles.content, { paddingBottom: spacingPixels[8] }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Progress Indicator - Only show in onboarding mode */}
          {mode === 'onboarding' && (
            <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} />
          )}

          {/* Profile Picture Upload - Only show in onboarding mode */}
          {mode === 'onboarding' && (
            <TouchableOpacity
              style={[
                styles.profilePicContainer,
                { borderColor: colors.buttonActive, backgroundColor: colors.inputBackground },
              ]}
              activeOpacity={0.8}
              onPress={() => {
                lightHaptic();
                pickImage();
              }}
            >
              {profileImage ? (
                <Image source={{ uri: profileImage }} style={styles.profileImage} />
              ) : (
                <Ionicons name="camera-outline" size={32} color={colors.buttonActive} />
              )}
            </TouchableOpacity>
          )}

          {/* First Name Input */}
          <View style={styles.inputContainer}>
            <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
              {t('profile.fields.firstName')} <Text color={colors.error}>*</Text>
            </Text>
            <TextInput
              placeholder={t('onboarding.personalInfoStep.firstNamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={firstName}
              onChangeText={handleFirstNameChange}
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
            />
          </View>

          {/* Last Name Input */}
          <View style={styles.inputContainer}>
            <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
              {t('profile.fields.lastName')} <Text color={colors.error}>*</Text>
            </Text>
            <TextInput
              placeholder={t('onboarding.personalInfoStep.lastNamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={lastName}
              onChangeText={handleLastNameChange}
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
            />
          </View>

          {/* Email Input - Only show in edit mode, read-only */}
          {mode === 'edit' && (
            <View style={styles.inputContainer}>
              <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
                {t('profile.fields.email')} <Text color={colors.error}>*</Text>
              </Text>
              <TextInput
                placeholder={t('profile.fields.email')}
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={() => {}} // Read-only, no-op
                editable={false}
                style={[
                  styles.input,
                  styles.inputDisabled,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
              />
              <Text size="xs" color={colors.textSecondary} style={styles.helperText}>
                {t('profile.editSheets.emailReadOnlyHelp')}
              </Text>
            </View>
          )}

          {/* Username Input */}
          <View style={styles.inputContainer}>
            <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
              {t('onboarding.personalInfoStep.username')} <Text color={colors.error}>*</Text>
            </Text>
            <TextInput
              placeholder={t('onboarding.personalInfoStep.usernamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={username}
              onChangeText={handleUsernameChange}
              maxLength={10}
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
            />
            <View style={styles.inputFooter}>
              <Text size="xs" color={colors.textSecondary}>
                {t('onboarding.personalInfoStep.usernameHelper')}
              </Text>
              <Text size="xs" color={colors.textSecondary}>
                {username.length}/10
              </Text>
            </View>
          </View>

          {/* Date of Birth Input */}
          <View style={styles.inputContainer}>
            <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
              {t('profile.fields.dateOfBirth')} <Text color={colors.error}>*</Text>
            </Text>
            {Platform.OS === 'web' ? (
              <View
                style={[
                  styles.input,
                  styles.dateInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                  },
                ]}
              >
                <input
                  type="date"
                  style={{
                    flex: 1,
                    fontSize: 16,
                    border: 'none',
                    outline: 'none',
                    backgroundColor: 'transparent',
                    color: colors.text,
                    fontFamily: 'inherit',
                  }}
                  value={dateOfBirth ? dateOfBirth.toISOString().split('T')[0] : ''}
                  onChange={e => {
                    const selectedDate = e.target.value ? new Date(e.target.value) : null;
                    if (selectedDate) {
                      setDateOfBirth(selectedDate);
                    }
                  }}
                  max={new Date().toISOString().split('T')[0]}
                  min="1900-01-01"
                  placeholder={t('profile.fields.dateOfBirth')}
                />
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color={colors.buttonActive}
                  style={styles.inputIcon}
                />
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.input,
                  styles.dateInput,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                  },
                ]}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={20} color={colors.buttonActive} />
                <Text color={dateOfBirth ? colors.text : colors.textMuted} style={{ flex: 1 }}>
                  {dateOfBirth ? formatDate(dateOfBirth) : t('profile.fields.dateOfBirth')}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* iOS Date Picker Modal */}
          {showDatePicker && Platform.OS === 'ios' && (
            <Modal
              transparent
              animationType="fade"
              visible={showDatePicker}
              onRequestClose={handleDatePickerCancel}
            >
              <Pressable
                style={[
                  styles.modalOverlay,
                  { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)' },
                ]}
                onPress={handleDatePickerCancel}
              >
                <Pressable
                  style={[styles.datePickerContainer, { backgroundColor: colors.card }]}
                  onPress={e => e.stopPropagation()}
                >
                  <View style={[styles.datePickerHeader, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity
                      onPress={handleDatePickerCancel}
                      style={styles.pickerHeaderButton}
                    >
                      <Text size="base" color={colors.textMuted}>
                        {t('common.cancel')}
                      </Text>
                    </TouchableOpacity>
                    <Text size="base" weight="semibold" color={colors.text}>
                      {t('profile.fields.dateOfBirth')}
                    </Text>
                    <TouchableOpacity
                      onPress={handleDatePickerDone}
                      style={styles.pickerHeaderButton}
                    >
                      <Text size="base" weight="semibold" color={colors.buttonActive}>
                        {t('common.done')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={dateOfBirth || new Date(2000, 0, 1)}
                    mode="date"
                    display="spinner"
                    onChange={handleDateChange}
                    maximumDate={new Date()}
                    minimumDate={new Date(1900, 0, 1)}
                    themeVariant={isDark ? 'dark' : 'light'}
                    style={styles.datePicker}
                  />
                </Pressable>
              </Pressable>
            </Modal>
          )}

          {/* Android Date Picker - Native dialog */}
          {showDatePicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={dateOfBirth || new Date(2000, 0, 1)}
              mode="date"
              display="default"
              onChange={handleDateChange}
              maximumDate={new Date()}
              minimumDate={new Date(1900, 0, 1)}
            />
          )}

          {/* Gender - Full-width Options */}
          <View style={styles.inputContainer}>
            <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
              {t('profile.gender')} <Text color={colors.error}>*</Text>
            </Text>
            <View style={styles.genderRow}>
              {GENDER_VALUES.map(value => {
                const isSelected = gender === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[
                      styles.genderOption,
                      {
                        backgroundColor: isSelected ? colors.buttonActive : colors.buttonInactive,
                        borderColor: isSelected ? colors.buttonActive : colors.border,
                      },
                    ]}
                    onPress={() => {
                      selectionHaptic();
                      setGender(value);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      size="base"
                      weight={isSelected ? 'semibold' : 'regular'}
                      color={isSelected ? colors.buttonTextActive : colors.text}
                    >
                      {t(`profile.genderValues.${value}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Phone Number Input */}
          <View style={styles.inputContainer}>
            <PhoneInput
              value={phoneNumber}
              onChangePhone={handlePhoneNumberChange}
              label={t('profile.fields.phoneNumber')}
              placeholder={t('profile.editSheets.phonePlaceholder')}
              required
              maxLength={15}
              colors={{
                text: colors.text,
                textMuted: colors.textMuted,
                textSecondary: colors.textSecondary,
                background: colors.background,
                inputBackground: colors.inputBackground,
                inputBorder: colors.inputBorder,
                primary: colors.primary,
                error: colors.error,
                card: colors.card,
              }}
            />
          </View>
        </ScrollView>

        {/* Sticky Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (!isFormValid || isSaving) && { opacity: 0.6 },
            ]}
            onPress={handleContinue}
            disabled={!isFormValid || isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text weight="semibold" style={{ color: colors.primaryForeground }}>
                {mode === 'onboarding' ? t('common.continue') : t('common.save')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

export default PersonalInformationActionSheet;

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
  modalContent: {
    flex: 1,
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
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
  },
  profilePicContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: spacingPixels[6],
    borderWidth: 2,
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  footer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[8],
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
  inputContainer: {
    marginBottom: spacingPixels[3],
  },
  inputLabel: {
    marginBottom: spacingPixels[2],
  },
  input: {
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    fontSize: 16,
    borderWidth: 1,
  },
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  inputDisabled: {
    opacity: 0.6,
  },
  genderRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  genderOption: {
    flex: 1,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  helperText: {
    marginTop: spacingPixels[1],
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacingPixels[1],
  },
  inputIcon: {
    marginRight: spacingPixels[3],
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  datePickerContainer: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
    paddingBottom: spacingPixels[5],
  },
  datePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
  },
  pickerHeaderButton: {
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
    minWidth: 60,
  },
  datePicker: {
    height: 200,
  },
});
