import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@rallia/shared-services';
import { useAuth } from '@rallia/shared-hooks';
import { useThemeStyles, useTranslation } from '../hooks';
import { updateLastPromptTimestamp } from '../utils/referralInviteFrequency';

const MAX_EMAILS = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ViewState = 'form' | 'success';

export function ReferralInviteActionSheet(_props: SheetProps<'referral-invite'>) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [emails, setEmails] = useState<string[]>(['']);
  const [errors, setErrors] = useState<(string | null)[]>([null]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewState, setViewState] = useState<ViewState>('form');
  const [genericError, setGenericError] = useState<string | null>(null);
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetState = useCallback(() => {
    setEmails(['']);
    setErrors([null]);
    setIsSubmitting(false);
    setViewState('form');
    setGenericError(null);
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
  }, []);

  const handleClose = useCallback(() => {
    SheetManager.hide('referral-invite');
    resetState();
  }, [resetState]);

  const handleSkip = useCallback(async () => {
    await updateLastPromptTimestamp();
    handleClose();
  }, [handleClose]);

  const updateEmail = useCallback((index: number, value: string) => {
    setEmails(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setErrors(prev => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setGenericError(null);
  }, []);

  const addEmail = useCallback(() => {
    if (emails.length >= MAX_EMAILS) return;
    setEmails(prev => [...prev, '']);
    setErrors(prev => [...prev, null]);
  }, [emails.length]);

  const removeEmail = useCallback((index: number) => {
    setEmails(prev => prev.filter((_, i) => i !== index));
    setErrors(prev => prev.filter((_, i) => i !== index));
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: (string | null)[] = emails.map(email => {
      const trimmed = email.trim();
      if (!trimmed || !EMAIL_REGEX.test(trimmed)) {
        return t('referral.inviteModal.errorInvalidEmail');
      }
      return null;
    });

    // Check for duplicate emails within the list
    const seen = new Set<string>();
    emails.forEach((email, i) => {
      const lower = email.trim().toLowerCase();
      if (lower && seen.has(lower)) {
        newErrors[i] = t('referral.inviteModal.errorDuplicateEmail');
      }
      seen.add(lower);
    });

    setErrors(newErrors);
    return newErrors.every(e => e === null);
  }, [emails, t]);

  const handleSubmit = useCallback(async () => {
    if (!validate() || !user?.id) return;

    setIsSubmitting(true);
    setGenericError(null);

    try {
      const rows = emails.map(email => ({
        referrer_id: user.id,
        email: email.trim().toLowerCase(),
      }));

      const { error } = await supabase.from('referral_invite').insert(rows);

      if (error) {
        // Handle unique constraint violation — some emails already invited
        if (error.code === '23505') {
          setGenericError(t('referral.inviteModal.errorDuplicateEmail'));
        } else {
          setGenericError(t('referral.inviteModal.errorGeneric'));
        }
        setIsSubmitting(false);
        return;
      }

      await updateLastPromptTimestamp();
      setViewState('success');

      autoCloseTimer.current = setTimeout(() => {
        handleClose();
      }, 2000);
    } catch {
      setGenericError(t('referral.inviteModal.errorGeneric'));
    } finally {
      setIsSubmitting(false);
    }
  }, [validate, user?.id, emails, t, handleClose]);

  const renderForm = () => (
    <>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('referral.inviteModal.title')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {t('referral.inviteModal.subtitle')}
        </Text>
      </View>

      <ScrollView style={styles.emailList} keyboardShouldPersistTaps="handled">
        {emails.map((email, index) => (
          <View key={index} style={styles.emailRow}>
            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                {t('referral.inviteModal.emailLabel')}
              </Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      color: colors.foreground,
                      borderColor: errors[index] ? '#ef4444' : colors.border,
                    },
                  ]}
                  value={email}
                  onChangeText={value => updateEmail(index, value)}
                  placeholder={t('referral.inviteModal.emailPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmitting}
                />
                {emails.length > 1 && (
                  <TouchableOpacity
                    onPress={() => removeEmail(index)}
                    style={styles.removeButton}
                    disabled={isSubmitting}
                  >
                    <Ionicons name="close-circle" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              {errors[index] && <Text style={styles.errorText}>{errors[index]}</Text>}
            </View>
          </View>
        ))}
      </ScrollView>

      {emails.length < MAX_EMAILS && (
        <TouchableOpacity onPress={addEmail} style={styles.addButton} disabled={isSubmitting}>
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={[styles.addButtonText, { color: colors.primary }]}>
            {t('referral.inviteModal.addAnother')}
          </Text>
        </TouchableOpacity>
      )}

      {genericError && <Text style={[styles.errorText, styles.genericError]}>{genericError}</Text>}

      <TouchableOpacity
        onPress={handleSubmit}
        disabled={isSubmitting}
        style={[
          styles.submitButton,
          { backgroundColor: colors.primary, opacity: isSubmitting ? 0.7 : 1 },
        ]}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.submitButtonText}>{t('referral.inviteModal.submit')}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={handleSkip} disabled={isSubmitting} style={styles.skipButton}>
        <Text style={[styles.skipButtonText, { color: colors.textMuted }]}>
          {t('referral.inviteModal.skip')}
        </Text>
      </TouchableOpacity>
    </>
  );

  const renderSuccess = () => (
    <View style={styles.successContainer}>
      <Ionicons name="checkmark-circle" size={56} color="#22c55e" />
      <Text style={[styles.successTitle, { color: colors.foreground }]}>
        {t('referral.inviteModal.successTitle')}
      </Text>
      <Text style={[styles.successMessage, { color: colors.textMuted }]}>
        {t('referral.inviteModal.successMessage')}
      </Text>
    </View>
  );

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetContainer,
        { backgroundColor: colors.cardBackground, paddingBottom: insets.bottom + spacingPixels[4] },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      onClose={resetState}
    >
      <View style={styles.content}>{viewState === 'form' ? renderForm() : renderSuccess()}</View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheetContainer: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: spacingPixels[2],
  },
  content: {
    padding: spacingPixels[5],
  },
  header: {
    marginBottom: spacingPixels[4],
  },
  title: {
    fontSize: fontSizePixels.xl,
    fontWeight: '700',
    marginBottom: spacingPixels[1],
  },
  subtitle: {
    fontSize: fontSizePixels.sm,
    lineHeight: 20,
  },
  emailList: {
    maxHeight: 280,
  },
  emailRow: {
    marginBottom: spacingPixels[3],
  },
  inputContainer: {
    flex: 1,
  },
  label: {
    fontSize: fontSizePixels.sm,
    fontWeight: '500',
    marginBottom: spacingPixels[1],
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    paddingHorizontal: spacingPixels[3],
    fontSize: fontSizePixels.base,
  },
  removeButton: {
    marginLeft: spacingPixels[2],
    padding: spacingPixels[1],
  },
  errorText: {
    color: '#ef4444',
    fontSize: fontSizePixels.xs,
    marginTop: 4,
  },
  genericError: {
    marginBottom: spacingPixels[3],
    textAlign: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
    paddingVertical: spacingPixels[1],
  },
  addButtonText: {
    fontSize: fontSizePixels.sm,
    fontWeight: '500',
    marginLeft: spacingPixels[1],
  },
  submitButton: {
    height: 48,
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[2],
  },
  submitButtonText: {
    color: '#fff',
    fontSize: fontSizePixels.base,
    fontWeight: '600',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
  },
  skipButtonText: {
    fontSize: fontSizePixels.sm,
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: spacingPixels[8],
  },
  successTitle: {
    fontSize: fontSizePixels.lg,
    fontWeight: '700',
    marginTop: spacingPixels[3],
  },
  successMessage: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
  },
});
