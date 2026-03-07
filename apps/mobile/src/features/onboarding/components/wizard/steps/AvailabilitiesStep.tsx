/**
 * AvailabilitiesStep Component
 *
 * Last step of onboarding - weekly availability grid.
 * Migrated from PlayerAvailabilitiesOverlay with theme-aware colors.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';
import type { OnboardingFormData } from '../../../hooks/useOnboardingWizard';

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
}

type TimeSlot = 'AM' | 'PM' | 'EVE';
type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

interface AvailabilitiesStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

const DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME_SLOTS: TimeSlot[] = ['AM', 'PM', 'EVE'];

// Map short day labels to translation key suffixes (same as UserProfile / profile availability)
const DAY_TO_I18N_KEY: Record<DayOfWeek, string> = {
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
  Sun: 'sunday',
};

const SLOT_TO_I18N_KEY: Record<TimeSlot, TranslationKey> = {
  AM: 'onboarding.availabilityStep.am',
  PM: 'onboarding.availabilityStep.pm',
  EVE: 'onboarding.availabilityStep.eve',
};

export const AvailabilitiesStep: React.FC<AvailabilitiesStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
  isDark: _isDark,
}) => {
  // Calculate total selections for display
  const totalSelections = useMemo(() => {
    return Object.values(formData.availabilities).reduce(
      (count, day) => count + Object.values(day).filter(Boolean).length,
      0
    );
  }, [formData.availabilities]);

  const MIN_SELECTIONS = 5;
  const hasMinimum = totalSelections >= MIN_SELECTIONS;

  const toggleAvailability = (day: DayOfWeek, slot: TimeSlot) => {
    selectionHaptic();
    const currentAvailabilities = formData.availabilities;
    const dayAvailability = currentAvailabilities[day] || { AM: false, PM: false, EVE: false };

    onUpdateFormData({
      availabilities: {
        ...currentAvailabilities,
        [day]: {
          ...dayAvailability,
          [slot]: !dayAvailability[slot],
        },
      },
    });
  };

  return (
    <BottomSheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Title - aligned with profile availability wording */}
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.availability')}
      </Text>
      <Text size="base" color={colors.textSecondary} style={styles.subtitle}>
        {t('onboarding.availabilitySubtitle')}
      </Text>

      {/* Selection Counter */}
      <View style={styles.counterContainer}>
        <Text
          size="sm"
          weight="semibold"
          color={hasMinimum ? colors.buttonActive : colors.textMuted}
        >
          {totalSelections > MIN_SELECTIONS
            ? t('onboarding.availabilityStep.selected').replace('{count}', String(totalSelections))
            : t('onboarding.availabilityStep.minimumSelected')
                .replace('{count}', String(totalSelections))
                .replace('{minimum}', String(MIN_SELECTIONS))}
        </Text>
      </View>

      {/* Availability Grid */}
      <View style={styles.gridContainer}>
        {/* Day Rows */}
        {DAYS.map(day => {
          const dayAvailability = formData.availabilities[day] || {
            AM: false,
            PM: false,
            EVE: false,
          };

          return (
            <View key={day} style={styles.row}>
              <View style={styles.dayCell}>
                <Text size="sm" weight="medium" color={colors.text}>
                  {t(`onboarding.availabilityStep.days.${DAY_TO_I18N_KEY[day]}` as TranslationKey)}
                </Text>
              </View>
              {TIME_SLOTS.map(slot => {
                const isSelected = dayAvailability[slot];
                return (
                  <TouchableOpacity
                    key={`${day}-${slot}`}
                    style={[
                      styles.timeSlotCell,
                      {
                        backgroundColor: isSelected ? colors.buttonActive : colors.buttonInactive,
                        borderColor: isSelected ? colors.buttonActive : 'transparent',
                      },
                    ]}
                    onPress={() => toggleAvailability(day, slot)}
                    activeOpacity={0.8}
                  >
                    <Text
                      size="xs"
                      weight="semibold"
                      color={isSelected ? colors.buttonTextActive : colors.textSecondary}
                    >
                      {t(SLOT_TO_I18N_KEY[slot])}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </View>

      {/* Privacy Toggle */}
      <View style={[styles.privacySection, { borderTopColor: colors.border }]}>
        <View style={styles.privacyHeader}>
          <Ionicons
            name={formData.privacyShowAvailability ? 'globe-outline' : 'lock-closed-outline'}
            size={20}
            color={colors.text}
          />
          <Text weight="semibold" style={[styles.privacyTitle, { color: colors.text }]}>
            {t('profile.availabilities.privacyTitle' as TranslationKey)}
          </Text>
        </View>
        <Text style={[styles.privacyDescription, { color: colors.textSecondary }]}>
          {formData.privacyShowAvailability
            ? t('profile.availabilities.publicDescription' as TranslationKey)
            : t('profile.availabilities.privateDescription' as TranslationKey)}
        </Text>
        <View style={styles.privacyToggleRow}>
          <Text style={{ color: colors.text }}>
            {formData.privacyShowAvailability
              ? t('profile.availabilities.public' as TranslationKey)
              : t('profile.availabilities.private' as TranslationKey)}
          </Text>
          <Switch
            value={formData.privacyShowAvailability}
            onValueChange={value => {
              selectionHaptic();
              onUpdateFormData({ privacyShowAvailability: value });
            }}
            trackColor={{ false: colors.buttonInactive, true: colors.buttonActive }}
            thumbColor={colors.cardBackground}
          />
        </View>
      </View>
    </BottomSheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    flexGrow: 1,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
    lineHeight: 28,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[3],
  },
  counterContainer: {
    alignItems: 'center',
    marginBottom: spacingPixels[4],
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
  headerCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeSlotCell: {
    flex: 1,
    borderRadius: radiusPixels.md,
    paddingVertical: spacingPixels[3],
    marginHorizontal: spacingPixels[1],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
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

export default AvailabilitiesStep;
