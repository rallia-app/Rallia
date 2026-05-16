/**
 * AvailabilitiesStep Component
 *
 * Last step of onboarding — weekly availability grid.
 *
 * Layout: 6 time-block rows × 7 day cells with a column-header row of day
 * letters. Day letters and time-block labels are tappable to bulk-toggle a
 * row or column (smart toggle: if every cell is filled, the tap clears the
 * line; otherwise it fills it). A preset chip row above the grid one-taps
 * common patterns (after-work, weekends, etc.) so most users land at a
 * sensible state in 1–2 taps and then tweak from there.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Switch, ScrollView } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';
import type { PeriodEnum } from '@rallia/shared-types';
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

type TimeSlot = PeriodEnum;
type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
type DayAvailability = Record<TimeSlot, boolean>;
type WeeklyAvailability = Record<DayOfWeek, DayAvailability>;

interface AvailabilitiesStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
}

const DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEKEND: DayOfWeek[] = ['Sat', 'Sun'];
const TIME_SLOTS: TimeSlot[] = ['early', 'morning', 'midday', 'afternoon', 'evening', 'late'];

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
  early: 'onboarding.availabilityStep.early',
  morning: 'onboarding.availabilityStep.morning',
  midday: 'onboarding.availabilityStep.midday',
  afternoon: 'onboarding.availabilityStep.afternoon',
  evening: 'onboarding.availabilityStep.evening',
  late: 'onboarding.availabilityStep.late',
};

const SLOT_TO_RANGE_KEY: Record<TimeSlot, TranslationKey> = {
  early: 'onboarding.availabilityStep.earlyRange',
  morning: 'onboarding.availabilityStep.morningRange',
  midday: 'onboarding.availabilityStep.middayRange',
  afternoon: 'onboarding.availabilityStep.afternoonRange',
  evening: 'onboarding.availabilityStep.eveningRange',
  late: 'onboarding.availabilityStep.lateRange',
};

// Preset patterns layer onto the current selection (additive union). Users
// can stack multiple presets, then tweak individual cells. To start fresh,
// they use the "Clear" chip.
interface Preset {
  key: 'afterWork' | 'weekendsAny' | 'weekdayLunches' | 'mornings';
  labelKey: TranslationKey;
  apply: (days: DayOfWeek[]) => Partial<Record<DayOfWeek, TimeSlot[]>>;
}

const PRESETS: Preset[] = [
  {
    key: 'afterWork',
    labelKey: 'onboarding.availabilityStep.presets.afterWork',
    apply: () => Object.fromEntries(WEEKDAYS.map(d => [d, ['evening', 'late']])),
  },
  {
    key: 'weekendsAny',
    labelKey: 'onboarding.availabilityStep.presets.weekendsAny',
    apply: () => Object.fromEntries(WEEKEND.map(d => [d, [...TIME_SLOTS]])),
  },
  {
    key: 'weekdayLunches',
    labelKey: 'onboarding.availabilityStep.presets.weekdayLunches',
    apply: () => Object.fromEntries(WEEKDAYS.map(d => [d, ['midday']])),
  },
  {
    key: 'mornings',
    labelKey: 'onboarding.availabilityStep.presets.mornings',
    apply: () => Object.fromEntries(DAYS.map(d => [d, ['early', 'morning']])),
  },
];

export const AvailabilitiesStep: React.FC<AvailabilitiesStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
  isDark: _isDark,
}) => {
  const totalSelections = useMemo(() => {
    return Object.values(formData.availabilities).reduce(
      (count, day) => count + Object.values(day).filter(Boolean).length,
      0
    );
  }, [formData.availabilities]);

  const MIN_SELECTIONS = 3;
  const hasMinimum = totalSelections >= MIN_SELECTIONS;

  const toggleAvailability = (day: DayOfWeek, slot: TimeSlot) => {
    selectionHaptic();
    const current = formData.availabilities;
    onUpdateFormData({
      availabilities: {
        ...current,
        [day]: { ...current[day], [slot]: !current[day][slot] },
      },
    });
  };

  // Smart toggle: if all 6 blocks of a day are filled, clear them; otherwise
  // fill all 6. Lets users go from empty to "every block this day" in one tap.
  const toggleDay = (day: DayOfWeek) => {
    selectionHaptic();
    const current = formData.availabilities;
    const allFilled = TIME_SLOTS.every(slot => current[day][slot]);
    const next: DayAvailability = TIME_SLOTS.reduce(
      (acc, slot) => ({ ...acc, [slot]: !allFilled }),
      {} as DayAvailability
    );
    onUpdateFormData({
      availabilities: { ...current, [day]: next },
    });
  };

  // Same idea, the other axis: tapping a time-block label toggles that block
  // across all 7 days.
  const toggleTimeBlock = (slot: TimeSlot) => {
    selectionHaptic();
    const current = formData.availabilities;
    const allFilled = DAYS.every(day => current[day][slot]);
    const next: WeeklyAvailability = DAYS.reduce(
      (acc, day) => ({
        ...acc,
        [day]: { ...current[day], [slot]: !allFilled },
      }),
      {} as WeeklyAvailability
    );
    onUpdateFormData({ availabilities: next });
  };

  // Presets are toggleable: tap once to apply the pattern, tap again to
  // clear those exact cells. "Applied" = every cell in the pattern is
  // currently filled; if any is missing, the tap fills the gap.
  const isPresetApplied = (preset: Preset, state: WeeklyAvailability) => {
    const pattern = preset.apply(DAYS);
    return (Object.entries(pattern) as Array<[DayOfWeek, TimeSlot[]]>).every(([day, slots]) =>
      slots.every(slot => state[day]?.[slot])
    );
  };

  const togglePreset = (preset: Preset) => {
    selectionHaptic();
    const current = formData.availabilities as WeeklyAvailability;
    const pattern = preset.apply(DAYS);
    const applied = isPresetApplied(preset, current);
    const next: WeeklyAvailability = { ...current };
    (Object.entries(pattern) as Array<[DayOfWeek, TimeSlot[]]>).forEach(([day, slots]) => {
      next[day] = { ...current[day] };
      slots.forEach(slot => {
        next[day][slot] = !applied;
      });
    });
    onUpdateFormData({ availabilities: next });
  };

  const clearAll = () => {
    selectionHaptic();
    const empty: DayAvailability = TIME_SLOTS.reduce(
      (acc, slot) => ({ ...acc, [slot]: false }),
      {} as DayAvailability
    );
    const next: WeeklyAvailability = DAYS.reduce(
      (acc, day) => ({ ...acc, [day]: { ...empty } }),
      {} as WeeklyAvailability
    );
    onUpdateFormData({ availabilities: next });
  };

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.availability')}
      </Text>
      <Text size="base" color={colors.textSecondary} style={styles.subtitle}>
        {t('onboarding.availabilitySubtitle')}
      </Text>

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

      {/* Preset chips — tap to toggle a common pattern on/off. Active chips
          render with the primary fill so the user can see at a glance which
          presets are currently part of their selection. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presetRow}
      >
        {PRESETS.map(preset => {
          const active = isPresetApplied(preset, formData.availabilities as WeeklyAvailability);
          return (
            <TouchableOpacity
              key={preset.key}
              style={[
                styles.presetChip,
                {
                  backgroundColor: active ? colors.buttonActive : colors.buttonInactive,
                  borderColor: active ? colors.buttonActive : colors.border,
                },
              ]}
              onPress={() => togglePreset(preset)}
              activeOpacity={0.7}
              accessibilityRole="switch"
              accessibilityState={{ checked: active }}
            >
              {active && (
                <Ionicons
                  name="checkmark"
                  size={14}
                  color={colors.buttonTextActive}
                  style={styles.presetChipIcon}
                />
              )}
              <Text
                size="xs"
                weight="semibold"
                color={active ? colors.buttonTextActive : colors.text}
              >
                {t(preset.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
        {totalSelections > 0 && (
          <TouchableOpacity
            style={[
              styles.presetChip,
              { backgroundColor: 'transparent', borderColor: colors.border },
            ]}
            onPress={clearAll}
            activeOpacity={0.7}
          >
            <Text size="xs" weight="semibold" color={colors.textMuted}>
              {t('onboarding.availabilityStep.presets.clear')}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={styles.gridContainer}>
        <View style={styles.headerRow}>
          <View style={styles.timeLabelCell} />
          {DAYS.map(day => (
            <TouchableOpacity
              key={`header-${day}`}
              style={styles.headerCell}
              onPress={() => toggleDay(day)}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={`${t(`playerDirectory.dayLetters.${DAY_TO_I18N_KEY[day]}` as TranslationKey)} — ${t('onboarding.availabilityStep.toggleDayHint')}`}
            >
              <Text size="xs" weight="semibold" color={colors.textMuted}>
                {t(`playerDirectory.dayLetters.${DAY_TO_I18N_KEY[day]}` as TranslationKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {TIME_SLOTS.map(slot => (
          <View key={slot} style={styles.row}>
            <TouchableOpacity
              style={styles.timeLabelCell}
              onPress={() => toggleTimeBlock(slot)}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={`${t(SLOT_TO_I18N_KEY[slot])} — ${t('onboarding.availabilityStep.toggleBlockHint')}`}
            >
              <Text size="sm" weight="semibold" color={colors.text}>
                {t(SLOT_TO_I18N_KEY[slot])}
              </Text>
              <Text size="xs" color={colors.textMuted} style={styles.timeRangeText}>
                {t(SLOT_TO_RANGE_KEY[slot])}
              </Text>
            </TouchableOpacity>
            {DAYS.map(day => {
              const isSelected = formData.availabilities[day]?.[slot] ?? false;
              return (
                <TouchableOpacity
                  key={`${day}-${slot}`}
                  style={[
                    styles.dayCell,
                    {
                      backgroundColor: isSelected ? colors.buttonActive : colors.buttonInactive,
                      borderColor: isSelected ? colors.buttonActive : colors.border,
                    },
                  ]}
                  onPress={() => toggleAvailability(day, slot)}
                  activeOpacity={0.8}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`${t(`onboarding.availabilityStep.days.${DAY_TO_I18N_KEY[day]}` as TranslationKey)} ${t(SLOT_TO_I18N_KEY[slot])}`}
                />
              );
            })}
          </View>
        ))}
      </View>

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
    </SheetScrollView>
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
    marginBottom: spacingPixels[3],
  },
  presetRow: {
    paddingVertical: spacingPixels[1],
    gap: spacingPixels[2],
    marginBottom: spacingPixels[4],
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  presetChipIcon: {
    marginRight: spacingPixels[1],
  },
  timeRangeText: {
    marginTop: 2,
    lineHeight: 14,
  },
  gridContainer: {
    marginBottom: spacingPixels[6],
  },
  headerRow: {
    flexDirection: 'row',
    marginBottom: spacingPixels[2],
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    marginBottom: spacingPixels[2],
    alignItems: 'center',
  },
  timeLabelCell: {
    width: 96,
    paddingRight: spacingPixels[2],
    justifyContent: 'center',
  },
  headerCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacingPixels[1],
  },
  dayCell: {
    flex: 1,
    height: 36,
    borderRadius: radiusPixels.md,
    marginHorizontal: spacingPixels[1] / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
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
