import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text, useToast } from '@rallia/shared-components';
import { OnboardingService, Logger, supabase } from '@rallia/shared-services';
import type { DayEnum, PeriodEnum, OnboardingAvailability } from '@rallia/shared-types';
import ProgressIndicator from '../ProgressIndicator';
import { selectionHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation, type TranslationKey } from '../../../../hooks';
import { radiusPixels, spacingPixels } from '@rallia/design-system';

type TimeSlot = 'AM' | 'PM' | 'EVE';
type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

interface DayAvailability {
  AM: boolean;
  PM: boolean;
  EVE: boolean;
}

export type WeeklyAvailability = Record<DayOfWeek, DayAvailability>;

export function PlayerAvailabilitiesActionSheet({ payload }: SheetProps<'player-availabilities'>) {
  const mode = payload?.mode || 'onboarding';
  const onClose = () => SheetManager.hide('player-availabilities');
  const onBack = payload?.onBack;
  const onContinue = payload?.onContinue;
  const onSave = payload?.onSave;
  const currentStep = payload?.currentStep || 1;
  const totalSteps = payload?.totalSteps || 8;
  const initialData = payload?.initialData;
  const initialPrivacyShowAvailability = payload?.initialPrivacyShowAvailability ?? true;
  const _selectedSportIds = payload?.selectedSportIds;
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const days: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const timeSlots: TimeSlot[] = ['AM', 'PM', 'EVE'];

  // Map short day labels to translation keys (monday, tuesday, ...)
  const dayTranslationKey: Record<DayOfWeek, string> = {
    Mon: 'monday',
    Tue: 'tuesday',
    Wed: 'wednesday',
    Thu: 'thursday',
    Fri: 'friday',
    Sat: 'saturday',
    Sun: 'sunday',
  };

  // Default availabilities for onboarding mode (all unselected)
  const defaultAvailabilities: WeeklyAvailability = {
    Mon: { AM: false, PM: false, EVE: false },
    Tue: { AM: false, PM: false, EVE: false },
    Wed: { AM: false, PM: false, EVE: false },
    Thu: { AM: false, PM: false, EVE: false },
    Fri: { AM: false, PM: false, EVE: false },
    Sat: { AM: false, PM: false, EVE: false },
    Sun: { AM: false, PM: false, EVE: false },
  };

  // Initialize availabilities: use initialData for edit mode, defaults for onboarding
  const [availabilities, setAvailabilities] = useState<WeeklyAvailability>(
    initialData || defaultAvailabilities
  );
  const [isSaving, setIsSaving] = useState(false);
  const [privacyShowAvailability, setPrivacyShowAvailability] = useState(
    initialPrivacyShowAvailability
  );

  const toggleAvailability = (day: DayOfWeek, slot: TimeSlot) => {
    selectionHaptic();
    setAvailabilities(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [slot]: !prev[day][slot],
      },
    }));
  };

  const handleContinue = async () => {
    mediumHaptic();

    // Prevent double-tap
    if (isSaving) return;

    // Edit mode: use the onSave callback
    if (mode === 'edit' && onSave) {
      onSave(availabilities, privacyShowAvailability);
      SheetManager.hide('player-availabilities');
      return;
    }

    // Onboarding mode: save to database
    if (onContinue) {
      setIsSaving(true);
      try {
        // Map UI data to database format
        const dayMap: Record<DayOfWeek, DayEnum> = {
          Mon: 'monday',
          Tue: 'tuesday',
          Wed: 'wednesday',
          Thu: 'thursday',
          Fri: 'friday',
          Sat: 'saturday',
          Sun: 'sunday',
        };

        const timeSlotMap: Record<TimeSlot, PeriodEnum> = {
          AM: 'morning',
          PM: 'afternoon',
          EVE: 'evening',
        };

        // Convert availability grid to database format
        // Create one entry per day/period combination (not per sport)
        const availabilityData: OnboardingAvailability[] = [];

        days.forEach(day => {
          timeSlots.forEach(slot => {
            if (availabilities[day][slot]) {
              availabilityData.push({
                day: dayMap[day],
                period: timeSlotMap[slot],
                is_active: true,
              });
            }
          });
        });

        // Save availability to database
        const { error } = await OnboardingService.saveAvailability(availabilityData);

        if (error) {
          Logger.error('Failed to save player availability', error as Error, { availabilityData });
          setIsSaving(false);
          toast.error(t('onboarding.validation.failedToSaveAvailability'));
          return;
        }

        Logger.debug('player_availabilities_saved', { availabilityData });

        // Save the privacy setting to the player table
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { error: privacyError } = await supabase
            .from('player')
            .update({ privacy_show_availability: privacyShowAvailability })
            .eq('id', user.id);

          if (privacyError) {
            Logger.warn('Failed to save availability privacy setting', { error: privacyError });
            // Don't block the flow if this fails - just log it
          } else {
            Logger.debug('availability_privacy_saved', { privacyShowAvailability });
          }
        }

        // Mark onboarding as completed
        const { error: completeError } = await OnboardingService.completeOnboarding();

        if (completeError) {
          Logger.warn('Failed to mark onboarding as completed', { error: completeError });
          // Don't block the flow if this fails - just log it
        } else {
          Logger.info('onboarding_completed', {
            message: 'Onboarding marked as completed in profile',
          });
        }

        onContinue(availabilities);
      } catch (error) {
        Logger.error('Unexpected error saving availability', error as Error);
        setIsSaving(false);
        toast.error(t('onboarding.validation.unexpectedError'));
      }
    }
  };

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
              {t('onboarding.availabilityStep.title')}
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
          {/* Show progress indicator only in onboarding mode */}
          {mode === 'onboarding' && (
            <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} />
          )}

          {/* Back Button - Only show in onboarding mode */}
          {mode === 'onboarding' && onBack && (
            <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          )}

          {/* Subtitle */}
          <Text style={[styles.subtitle, { color: colors.text }]}>
            {t('onboarding.availabilityStep.subtitle')}
          </Text>

          {/* Availability Grid */}
          <View style={styles.gridContainer}>
            {/* Day Rows */}
            {days.map(day => (
              <View key={day} style={styles.row}>
                <View style={styles.dayCell}>
                  <Text style={[styles.dayText, { color: colors.text }]}>
                    {t(
                      `onboarding.availabilityStep.days.${dayTranslationKey[day]}` as TranslationKey
                    )}
                  </Text>
                </View>
                {timeSlots.map(slot => (
                  <TouchableOpacity
                    key={`${day}-${slot}`}
                    style={[
                      styles.timeSlotCell,
                      { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                      availabilities[day][slot] && [
                        styles.timeSlotCellSelected,
                        { backgroundColor: colors.primary, borderColor: colors.primary },
                      ],
                    ]}
                    onPress={() => toggleAvailability(day, slot)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.timeSlotText,
                        {
                          color: availabilities[day][slot]
                            ? colors.primaryForeground
                            : colors.textMuted,
                        },
                      ]}
                    >
                      {t(`onboarding.availabilityStep.${slot.toLowerCase()}` as TranslationKey)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>

          {/* Privacy Toggle - Shows in both onboarding and edit modes */}
          <View style={[styles.privacySection, { borderTopColor: colors.border }]}>
            <View style={styles.privacyHeader}>
              <Ionicons
                name={privacyShowAvailability ? 'globe-outline' : 'lock-closed-outline'}
                size={20}
                color={colors.text}
              />
              <Text weight="semibold" style={[styles.privacyTitle, { color: colors.text }]}>
                {t('profile.availabilities.privacyTitle')}
              </Text>
            </View>
            <Text style={[styles.privacyDescription, { color: colors.textMuted }]}>
              {privacyShowAvailability
                ? t('profile.availabilities.publicDescription')
                : t('profile.availabilities.privateDescription')}
            </Text>
            <View style={styles.privacyToggleRow}>
              <Text style={{ color: colors.text }}>
                {privacyShowAvailability
                  ? t('profile.availabilities.public')
                  : t('profile.availabilities.private')}
              </Text>
              <Switch
                value={privacyShowAvailability}
                onValueChange={value => {
                  selectionHaptic();
                  setPrivacyShowAvailability(value);
                }}
                trackColor={{ false: colors.inputBackground, true: colors.primary }}
                thumbColor={colors.card}
              />
            </View>
          </View>
        </ScrollView>

        {/* Sticky Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              isSaving && { opacity: 0.6 },
            ]}
            onPress={handleContinue}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text weight="semibold" style={{ color: colors.primaryForeground }}>
                {mode === 'edit'
                  ? t('onboarding.availabilityStep.saveButton')
                  : t('onboarding.availabilityStep.complete')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

export default PlayerAvailabilitiesActionSheet;

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
    alignItems: 'center',
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
  backButton: {
    alignSelf: 'flex-start',
    padding: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  gridContainer: {
    marginBottom: spacingPixels[6],
  },
  row: {
    flexDirection: 'row',
    marginBottom: spacingPixels[2],
    alignItems: 'center',
  },
  dayCell: {
    width: 50,
    justifyContent: 'center',
  },
  dayText: {
    fontSize: 14,
    fontWeight: '500',
  },
  headerCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timeSlotCell: {
    flex: 1,
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[3],
    marginHorizontal: spacingPixels[1],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  timeSlotCellSelected: {
    // backgroundColor and borderColor applied inline
  },
  timeSlotText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timeSlotTextSelected: {
    // color applied inline
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
  privacySection: {
    marginTop: spacingPixels[2],
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  privacyTitle: {
    fontSize: 16,
  },
  privacyDescription: {
    fontSize: 13,
    marginBottom: spacingPixels[3],
  },
  privacyToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
