/**
 * PersonalInfoStep Component
 *
 * First step of onboarding - collects personal information.
 * Migrated from PersonalInformationOverlay with theme-aware colors.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Modal,
  Image,
  Pressable,
  LayoutAnimation,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  validateFullName,
  lightHaptic,
  selectionHaptic,
  sanitizeReferralCode,
  isReferralCodeComplete,
  REFERRAL_CODE_LENGTH,
} from '@rallia/shared-utils';
import { GENDER_VALUES } from '@rallia/shared-types';
import type { TranslationKey, Locale } from '@rallia/shared-translations';

import type { OnboardingFormData } from '#/features/onboarding/hooks/useOnboardingWizard';
import { useLocale } from '#/context';
import { PENDING_REFERRAL_KEY } from '#/navigation/deepLinkStore';
import * as Analytics from '#/services/analytics';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  inputBackground: string;
  inputBorder: string;
  error: string;
}

interface PersonalInfoStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  onPickImage: () => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
}

const MINIMUM_AGE_YEARS = 18;

// Calculate minimum date of birth (18 years ago)
const getMinimumDateOfBirth = (): Date => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - MINIMUM_AGE_YEARS);
  return date;
};

export const PersonalInfoStep: React.FC<PersonalInfoStepProps> = ({
  formData,
  onUpdateFormData,
  onPickImage,
  colors,
  t,
  isDark,
}) => {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(formData.dateOfBirth || new Date(2000, 0, 1));

  // Referral code state
  const [referralCode, setReferralCode] = useState('');
  const [referralSaved, setReferralSaved] = useState(false);

  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Refs for keyboard visibility handling
  const scrollViewRef = useRef<any>(null);
  const firstNameFieldRef = useRef<View>(null);
  const lastNameFieldRef = useRef<View>(null);
  // Y positions of each field within scroll content (from onLayout), used to scroll only enough to bring field into view
  const fieldYOffsets = useRef<Record<string, number>>({});
  const SCROLL_TO_FIELD_TOP_PADDING = 24;

  const minimumDateOfBirth = useMemo(() => getMinimumDateOfBirth(), []);
  const minimumDateSelectable = useMemo(() => new Date(1900, 0, 1), []);

  // Validation functions
  const validateFirstName = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'First name is required';
    }
    return undefined;
  };

  const validateLastName = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Last name is required';
    }
    return undefined;
  };

  const validateDateOfBirth = (date: Date | null): string | undefined => {
    if (!date) {
      return 'Date of birth is required';
    }
    if (date > minimumDateOfBirth) {
      return t('onboarding.validation.minimumAge');
    }
    return undefined;
  };

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const handleFirstNameChange = (text: string) => {
    const validatedText = validateFullName(text);
    onUpdateFormData({ firstName: validatedText });
    if (fieldErrors.firstName) {
      clearFieldError('firstName');
    }
  };

  const handleFirstNameBlur = () => {
    const error = validateFirstName(formData.firstName);
    if (error) {
      setFieldErrors(prev => ({ ...prev, firstName: error }));
    }
  };

  const handleLastNameChange = (text: string) => {
    const validatedText = validateFullName(text);
    onUpdateFormData({ lastName: validatedText });
    if (fieldErrors.lastName) {
      clearFieldError('lastName');
    }
  };

  const handleLastNameBlur = () => {
    const error = validateLastName(formData.lastName);
    if (error) {
      setFieldErrors(prev => ({ ...prev, lastName: error }));
    }
  };

  const handleReferralCodeSubmit = useCallback(async () => {
    if (!isReferralCodeComplete(referralCode)) return;
    const code = referralCode;
    try {
      // When manually entered, we only have the code (type defaults to 'referral')
      await AsyncStorage.setItem(
        PENDING_REFERRAL_KEY,
        JSON.stringify({ code, type: 'referral', enteredManually: true })
      );
      setReferralSaved(true);
      Analytics.referralAttributed({ invitation_type: 'referral', referral_code: code });
    } catch {
      // Silently fail — attribution will be attempted later
    }
  }, [referralCode]);

  const handleChangeReferralCode = useCallback(async () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setReferralSaved(false);
    setReferralCode('');
    try {
      await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
    } catch {
      // Non-fatal
    }
  }, []);

  // Hydrate from a pending referral captured via DiscoveryStep, clipboard, or deep link
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PENDING_REFERRAL_KEY).then(raw => {
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as { code?: string; type?: string };
        const sanitized = parsed.code ? sanitizeReferralCode(parsed.code) : '';
        if (parsed.type === 'referral' && isReferralCodeComplete(sanitized)) {
          setReferralCode(sanitized);
          setReferralSaved(true);
        }
      } catch {
        // Ignore malformed entries
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Get the current date value for the picker
  const dateValue = formData.dateOfBirth || new Date(2000, 0, 1);

  const handleDateChange = (_event: unknown, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      // Android: native dialog dismisses automatically, validate and save immediately
      setShowDatePicker(false);
      if (selectedDate) {
        const error = validateDateOfBirth(selectedDate);
        if (error) {
          setFieldErrors(prev => ({ ...prev, dateOfBirth: error }));
        } else {
          onUpdateFormData({ dateOfBirth: selectedDate });
          clearFieldError('dateOfBirth');
        }
      }
    } else if (selectedDate) {
      // iOS: update temp value, commit on Done
      setTempDate(selectedDate);
    }
  };

  const handleDateDone = () => {
    // Validate age before saving
    const error = validateDateOfBirth(tempDate);
    if (error) {
      setFieldErrors(prev => ({ ...prev, dateOfBirth: error }));
    } else {
      onUpdateFormData({ dateOfBirth: tempDate });
      clearFieldError('dateOfBirth');
    }
    setShowDatePicker(false);
    lightHaptic();
  };

  const handleDateCancel = () => {
    setTempDate(dateValue);
    setShowDatePicker(false);
  };

  const { locale: appLocale } = useLocale();

  const formatDate = (date: Date | null): string => {
    if (!date) return '';
    try {
      return new Intl.DateTimeFormat(appLocale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date);
    } catch {
      // Fallback to US format if Intl not available
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();
      return `${month}/${day}/${year}`;
    }
  };

  const scrollToField = useCallback((fieldKey: string) => {
    const delay = Platform.OS === 'ios' ? 300 : 100;
    setTimeout(() => {
      const y = fieldYOffsets.current[fieldKey];
      if (y !== undefined && scrollViewRef.current) {
        const targetY = Math.max(0, y - SCROLL_TO_FIELD_TOP_PADDING);
        scrollViewRef.current.scrollTo({ y: targetY, animated: true });
      }
    }, delay);
  }, []);

  return (
    <SheetScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Title */}
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.personalInfoStep.title')}
      </Text>

      {/* Profile Picture */}
      <TouchableOpacity
        style={[styles.profilePicContainer, { borderColor: colors.buttonActive }]}
        activeOpacity={0.8}
        onPress={() => {
          lightHaptic();
          onPickImage();
        }}
      >
        {formData.profileImage ? (
          <Image source={{ uri: formData.profileImage }} style={styles.profileImage} />
        ) : (
          <Ionicons name="camera-outline" size={32} color={colors.buttonActive} />
        )}
      </TouchableOpacity>
      <Text size="sm" color={colors.textSecondary} style={styles.photoLabel}>
        {formData.profileImage ? t('profile.changePhoto') : t('chat.addPhoto')}
      </Text>

      {/* First Name */}
      <View
        ref={firstNameFieldRef}
        style={styles.inputContainer}
        onLayout={e => {
          fieldYOffsets.current.firstName = e.nativeEvent.layout.y;
        }}
      >
        <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
          {t('onboarding.personalInfoStep.firstName')}{' '}
          <Text color={colors.error}>{t('onboarding.personalInfoStep.required')}</Text>
        </Text>
        <TextInput
          placeholder={t('onboarding.personalInfoStep.firstNamePlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={formData.firstName}
          onChangeText={handleFirstNameChange}
          onBlur={handleFirstNameBlur}
          onFocus={() => scrollToField('firstName')}
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: fieldErrors.firstName ? colors.error : colors.inputBorder,
              color: colors.text,
            },
          ]}
        />
        {fieldErrors.firstName && (
          <Text size="xs" color={colors.error} style={styles.errorText}>
            {fieldErrors.firstName}
          </Text>
        )}
      </View>

      {/* Last Name */}
      <View
        ref={lastNameFieldRef}
        style={styles.inputContainer}
        onLayout={e => {
          fieldYOffsets.current.lastName = e.nativeEvent.layout.y;
        }}
      >
        <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
          {t('onboarding.personalInfoStep.lastName')}{' '}
          <Text color={colors.error}>{t('onboarding.personalInfoStep.required')}</Text>
        </Text>
        <TextInput
          placeholder={t('onboarding.personalInfoStep.lastNamePlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={formData.lastName}
          onChangeText={handleLastNameChange}
          onBlur={handleLastNameBlur}
          onFocus={() => scrollToField('lastName')}
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: fieldErrors.lastName ? colors.error : colors.inputBorder,
              color: colors.text,
            },
          ]}
        />
        {fieldErrors.lastName && (
          <Text size="xs" color={colors.error} style={styles.errorText}>
            {fieldErrors.lastName}
          </Text>
        )}
      </View>

      {/* Date of Birth */}
      <View style={styles.inputContainer}>
        <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
          {t('onboarding.personalInfoStep.dateOfBirth')}{' '}
          <Text color={colors.error}>{t('onboarding.personalInfoStep.required')}</Text>
        </Text>
        <TouchableOpacity
          style={[
            styles.input,
            styles.dateInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: fieldErrors.dateOfBirth ? colors.error : colors.inputBorder,
            },
          ]}
          onPress={() => {
            lightHaptic();
            setTempDate(dateValue);
            setShowDatePicker(true);
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="calendar-outline" size={20} color={colors.buttonActive} />
          <Text color={formData.dateOfBirth ? colors.text : colors.textMuted} style={{ flex: 1 }}>
            {formData.dateOfBirth ? formatDate(formData.dateOfBirth) : t('common.select')}
          </Text>
        </TouchableOpacity>
        {fieldErrors.dateOfBirth && (
          <Text size="xs" color={colors.error} style={styles.errorText}>
            {fieldErrors.dateOfBirth}
          </Text>
        )}
      </View>

      {/* iOS Date Picker Modal */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="fade"
          onRequestClose={handleDateCancel}
        >
          <Pressable
            style={[
              styles.modalOverlay,
              { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)' },
            ]}
            onPress={handleDateCancel}
          >
            <Pressable
              style={[styles.datePickerContainer, { backgroundColor: colors.cardBackground }]}
              onPress={e => e.stopPropagation()}
            >
              <View style={[styles.datePickerHeader, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={handleDateCancel} style={styles.pickerHeaderButton}>
                  <Text size="base" color={colors.textMuted}>
                    {t('common.cancel')}
                  </Text>
                </TouchableOpacity>
                <Text size="base" weight="semibold" color={colors.text}>
                  {t('onboarding.personalInfoStep.dateOfBirth')}
                </Text>
                <TouchableOpacity onPress={handleDateDone} style={styles.pickerHeaderButton}>
                  <Text size="base" weight="semibold" color={colors.buttonActive}>
                    {t('common.done')}
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
                maximumDate={minimumDateOfBirth}
                minimumDate={minimumDateSelectable}
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
          value={dateValue}
          mode="date"
          display="spinner"
          onChange={handleDateChange}
          maximumDate={minimumDateOfBirth}
          minimumDate={minimumDateSelectable}
        />
      )}

      {/* Gender - Full-width Options */}
      <View style={styles.inputContainer}>
        <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
          {t('onboarding.personalInfoStep.gender')}{' '}
          <Text color={colors.error}>{t('onboarding.personalInfoStep.required')}</Text>
        </Text>
        <View style={styles.genderRow}>
          {GENDER_VALUES.map(value => {
            const isSelected = formData.gender === value;
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
                  onUpdateFormData({ gender: value });
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

      {/* Referral Code */}
      <View style={styles.inputContainer}>
        <View style={styles.referralLabelRow}>
          <Ionicons name="gift-outline" size={16} color={colors.buttonActive} />
          <Text size="sm" weight="semibold" color={colors.text} style={styles.referralLabel}>
            {t('referral.inviteCardTitle')}
          </Text>
        </View>
        <Text size="xs" color={colors.textSecondary} style={styles.referralHelper}>
          {t('referral.inviteCardSubtitle')}
        </Text>

        <View style={styles.referralInputRow}>
          <TextInput
            placeholder={t('referral.enterCode')}
            placeholderTextColor={colors.textMuted}
            value={referralCode}
            onChangeText={text => setReferralCode(sanitizeReferralCode(text))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={REFERRAL_CODE_LENGTH}
            editable={!referralSaved}
            returnKeyType="done"
            onSubmitEditing={handleReferralCodeSubmit}
            style={[
              styles.input,
              styles.referralInput,
              {
                backgroundColor: colors.inputBackground,
                borderColor: referralSaved ? colors.buttonActive : colors.inputBorder,
                color: colors.text,
              },
            ]}
          />
          {referralSaved ? (
            <View style={styles.referralCheckIcon}>
              <Ionicons name="checkmark-circle" size={24} color={colors.buttonActive} />
            </View>
          ) : (
            <TouchableOpacity
              onPress={handleReferralCodeSubmit}
              disabled={!isReferralCodeComplete(referralCode)}
              style={[
                styles.referralApplyButton,
                {
                  backgroundColor: isReferralCodeComplete(referralCode)
                    ? colors.buttonActive
                    : colors.buttonInactive,
                },
              ]}
              activeOpacity={0.8}
            >
              <Text
                size="sm"
                weight="semibold"
                color={isReferralCodeComplete(referralCode) ? '#FFFFFF' : colors.textMuted}
              >
                {t('common.submit')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {referralSaved && (
          <View style={styles.referralAppliedFooter}>
            <Text size="xs" color={colors.buttonActive}>
              {t('referral.codeApplied')}
            </Text>
            <TouchableOpacity onPress={handleChangeReferralCode} activeOpacity={0.6}>
              <Text size="xs" weight="semibold" color={colors.buttonActive}>
                {t('referral.changeCode')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    flexGrow: 1,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
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
  photoLabel: {
    textAlign: 'center',
    marginTop: -spacingPixels[4],
    marginBottom: spacingPixels[6],
  },
  inputContainer: {
    marginBottom: spacingPixels[3],
  },
  errorText: {
    marginTop: spacingPixels[1],
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
  referralLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1] + 2,
    marginBottom: spacingPixels[1],
  },
  referralLabel: {
    marginBottom: 0,
  },
  referralHelper: {
    marginBottom: spacingPixels[2],
    lineHeight: 16,
  },
  referralInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  referralInput: {
    flex: 1,
  },
  referralApplyButton: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  referralCheckIcon: {
    paddingHorizontal: spacingPixels[2],
  },
  referralAppliedFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacingPixels[1],
  },
});

export default PersonalInfoStep;
