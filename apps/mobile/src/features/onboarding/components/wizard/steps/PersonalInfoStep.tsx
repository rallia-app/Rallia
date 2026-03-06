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
  Keyboard,
  ActivityIndicator,
  LayoutAnimation,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  BottomSheetTextInput,
  BottomSheetScrollView,
  type BottomSheetScrollViewMethods,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { PhoneInput } from '../../../../../components/PhoneInput';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  validateFullName,
  validateUsername,
  lightHaptic,
  selectionHaptic,
} from '@rallia/shared-utils';
import { GENDER_VALUES } from '@rallia/shared-types';
import { supabase } from '@rallia/shared-services';
import type { TranslationKey } from '@rallia/shared-translations';
import type { Locale } from '@rallia/shared-translations';
import type { OnboardingFormData } from '../../../hooks/useOnboardingWizard';
import { useLocale } from '../../../../../context';
import { PENDING_REFERRAL_KEY_EXPORT } from '../../../../../screens/InviteReferralScreen';

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
  username?: string;
  dateOfBirth?: string;
  gender?: string;
  phoneNumber?: string;
}

type ValidationStatus = 'idle' | 'valid' | 'invalid' | 'checking';

const MINIMUM_AGE = 13;

// Calculate minimum date of birth (13 years ago)
const getMinimumDateOfBirth = (): Date => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - MINIMUM_AGE);
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
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Referral code state
  const [showReferralCode, setShowReferralCode] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [referralSaved, setReferralSaved] = useState(false);

  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Username uniqueness check state
  const [usernameStatus, setUsernameStatus] = useState<ValidationStatus>('idle');
  const [usernameCheckTimeout, setUsernameCheckTimeout] = useState<NodeJS.Timeout | null>(null);

  // Refs for keyboard visibility handling
  const scrollViewRef = useRef<BottomSheetScrollViewMethods>(null);
  const firstNameFieldRef = useRef<View>(null);
  const lastNameFieldRef = useRef<View>(null);
  const usernameFieldRef = useRef<View>(null);
  const phoneNumberFieldRef = useRef<View>(null);
  // Y positions of each field within scroll content (from onLayout), used to scroll only enough to bring field into view
  const fieldYOffsets = useRef<Record<string, number>>({});
  const SCROLL_TO_FIELD_TOP_PADDING = 24;

  const minimumDateOfBirth = useMemo(() => getMinimumDateOfBirth(), []);
  const minimumDateSelectable = useMemo(() => new Date(1900, 0, 1), []);

  // Listen for keyboard events to adjust padding dynamically
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const keyboardShowListener = Keyboard.addListener(showEvent, e => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const keyboardHideListener = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      keyboardShowListener.remove();
      keyboardHideListener.remove();
    };
  }, []);

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

  const checkUsernameUniqueness = useCallback(async (username: string) => {
    if (!username.trim()) return;

    setUsernameStatus('checking');

    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      let query = supabase
        .from('profile')
        .select('display_name')
        .ilike('display_name', username.trim());

      if (currentUser) {
        query = query.neq('id', currentUser.id);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error('Username check error:', error);
        setUsernameStatus('idle');
      } else if (data) {
        setUsernameStatus('invalid');
      } else {
        setUsernameStatus('valid');
      }
    } catch {
      setUsernameStatus('idle');
    }
  }, []);

  const validateUsernameField = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Username is required';
    }
    if (value.length < 3) {
      return 'Username must be at least 3 characters';
    }
    return undefined;
  };

  const validateDateOfBirth = (date: Date | null): string | undefined => {
    if (!date) {
      return 'Date of birth is required';
    }
    if (date > minimumDateOfBirth) {
      return `You must be at least ${MINIMUM_AGE} years old`;
    }
    return undefined;
  };

  const validatePhoneNumber = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Phone number is required';
    }
    // Basic phone validation - at least 8 digits
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly.length < 8) {
      return 'Please enter a valid phone number';
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

  const handleUsernameChange = (text: string) => {
    const validatedText = validateUsername(text);
    onUpdateFormData({ username: validatedText });

    // Clear errors
    if (fieldErrors.username) {
      clearFieldError('username');
    }
    setUsernameStatus('idle');

    // Debounced uniqueness check
    if (usernameCheckTimeout) {
      clearTimeout(usernameCheckTimeout);
    }

    if (validatedText.length >= 3) {
      const timeout = setTimeout(() => {
        checkUsernameUniqueness(validatedText);
      }, 500);
      setUsernameCheckTimeout(timeout);
    }
  };

  const handleUsernameBlur = () => {
    const error = validateUsernameField(formData.username);
    if (error) {
      setFieldErrors(prev => ({ ...prev, username: error }));
    }
  };

  const handlePhoneNumberChange = useCallback(
    (fullNumber: string, _countryCode: string, _localNumber: string) => {
      onUpdateFormData({ phoneNumber: fullNumber });
      if (fieldErrors.phoneNumber) {
        clearFieldError('phoneNumber');
      }
    },
    [onUpdateFormData, fieldErrors.phoneNumber]
  );

  const handlePhoneNumberBlur = () => {
    const error = validatePhoneNumber(formData.phoneNumber);
    if (error) {
      setFieldErrors(prev => ({ ...prev, phoneNumber: error }));
    }
  };

  const handleReferralCodeSubmit = useCallback(async () => {
    const code = referralCode.trim().toUpperCase();
    if (!code) return;
    try {
      await AsyncStorage.setItem(PENDING_REFERRAL_KEY_EXPORT, code);
      setReferralSaved(true);
    } catch {
      // Silently fail — attribution will be attempted later
    }
  }, [referralCode]);

  const toggleReferralSection = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowReferralCode(prev => !prev);
  }, []);

  // Get the current date value for the picker
  const dateValue = formData.dateOfBirth || new Date(2000, 0, 1);

  const handleDateChange = (_event: unknown, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (selectedDate) {
        onUpdateFormData({ dateOfBirth: selectedDate });
      }
    } else if (selectedDate) {
      // iOS: just update temp value, commit on Done
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
      return new Intl.DateTimeFormat(appLocale as Locale, {
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
    <BottomSheetScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 20 : spacingPixels[8] },
      ]}
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
        {formData.profileImage
          ? t('profile.changePhoto' as TranslationKey)
          : t('chat.addPhoto' as TranslationKey)}
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
        <BottomSheetTextInput
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
        <BottomSheetTextInput
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

      {/* Username */}
      <View
        ref={usernameFieldRef}
        style={styles.inputContainer}
        onLayout={e => {
          fieldYOffsets.current.username = e.nativeEvent.layout.y;
        }}
      >
        <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
          {t('onboarding.personalInfoStep.username')}{' '}
          <Text color={colors.error}>{t('onboarding.personalInfoStep.required')}</Text>
        </Text>
        <View style={styles.inputWithStatus}>
          <BottomSheetTextInput
            placeholder={t('onboarding.personalInfoStep.usernamePlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={formData.username}
            onChangeText={handleUsernameChange}
            onBlur={handleUsernameBlur}
            maxLength={10}
            onFocus={() => scrollToField('username')}
            style={[
              styles.input,
              styles.inputWithIcon,
              {
                backgroundColor: colors.inputBackground,
                borderColor: fieldErrors.username ? colors.error : colors.inputBorder,
                color: colors.text,
              },
            ]}
          />
          {usernameStatus === 'checking' && (
            <ActivityIndicator size="small" color={colors.buttonActive} style={styles.statusIcon} />
          )}
          {usernameStatus === 'valid' && (
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={colors.buttonActive}
              style={styles.statusIcon}
            />
          )}
          {usernameStatus === 'invalid' && (
            <Ionicons
              name="close-circle"
              size={20}
              color={colors.error}
              style={styles.statusIcon}
            />
          )}
        </View>
        <View style={styles.inputFooter}>
          <Text size="xs" color={fieldErrors.username ? colors.error : colors.textSecondary}>
            {fieldErrors.username || t('onboarding.personalInfoStep.usernameHelper')}
          </Text>
          <Text size="xs" color={colors.textSecondary}>
            {formData.username.length}/10
          </Text>
        </View>
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
            <View style={[styles.datePickerContainer, { backgroundColor: colors.cardBackground }]}>
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
                style={styles.iosPicker}
              />
            </View>
          </Pressable>
        </Modal>
      )}

      {/* Android Date Picker */}
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

      {/* Phone Number */}
      <View
        ref={phoneNumberFieldRef}
        style={styles.inputContainer}
        onLayout={e => {
          fieldYOffsets.current.phoneNumber = e.nativeEvent.layout.y;
        }}
      >
        <PhoneInput
          value={formData.phoneNumber}
          onChangePhone={handlePhoneNumberChange}
          label={t('onboarding.personalInfoStep.phoneNumber')}
          placeholder={t('onboarding.personalInfoStep.phoneNumber')}
          required
          colors={{
            text: colors.text,
            textMuted: colors.textMuted,
            textSecondary: colors.textSecondary,
            background: colors.background,
            inputBackground: colors.inputBackground,
            inputBorder: fieldErrors.phoneNumber ? colors.error : colors.inputBorder,
            primary: colors.buttonActive,
            error: colors.error,
            card: colors.cardBackground,
          }}
          onFocus={() => scrollToField('phoneNumber')}
          onBlur={handlePhoneNumberBlur}
          TextInputComponent={BottomSheetTextInput}
        />
        {fieldErrors.phoneNumber && (
          <Text size="xs" color={colors.error} style={styles.errorText}>
            {fieldErrors.phoneNumber}
          </Text>
        )}
      </View>

      {/* Referral Code (optional collapsible) */}
      <View style={styles.inputContainer}>
        <TouchableOpacity
          onPress={toggleReferralSection}
          style={styles.referralToggle}
          activeOpacity={0.7}
        >
          <Ionicons
            name={showReferralCode ? 'chevron-down-outline' : 'chevron-forward-outline'}
            size={18}
            color={colors.buttonActive}
          />
          <Text size="sm" weight="medium" color={colors.buttonActive}>
            {t('referral.haveReferralCode')}
          </Text>
        </TouchableOpacity>
        {showReferralCode && (
          <View style={styles.referralInputRow}>
            <BottomSheetTextInput
              placeholder={t('referral.enterCode')}
              placeholderTextColor={colors.textMuted}
              value={referralCode}
              onChangeText={setReferralCode}
              autoCapitalize="characters"
              maxLength={12}
              editable={!referralSaved}
              style={[
                styles.input,
                {
                  flex: 1,
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
                disabled={!referralCode.trim()}
                style={[
                  styles.referralApplyButton,
                  {
                    backgroundColor: referralCode.trim()
                      ? colors.buttonActive
                      : colors.buttonInactive,
                  },
                ]}
                activeOpacity={0.8}
              >
                <Text
                  size="sm"
                  weight="semibold"
                  color={referralCode.trim() ? '#FFFFFF' : colors.textMuted}
                >
                  {t('common.submit')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {referralSaved && (
          <Text size="xs" color={colors.buttonActive} style={styles.errorText}>
            {t('referral.codeApplied')}
          </Text>
        )}
      </View>
    </BottomSheetScrollView>
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
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacingPixels[1],
  },
  inputWithStatus: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputWithIcon: {
    flex: 1,
    paddingRight: spacingPixels[10],
  },
  statusIcon: {
    position: 'absolute',
    right: spacingPixels[3],
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
  iosPicker: {
    height: 200,
  },
  referralToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[1],
  },
  referralInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[2],
  },
  referralApplyButton: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  referralCheckIcon: {
    paddingHorizontal: spacingPixels[2],
  },
});

export default PersonalInfoStep;
