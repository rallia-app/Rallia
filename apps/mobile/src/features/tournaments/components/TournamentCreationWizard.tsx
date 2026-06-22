/**
 * TournamentCreationWizard
 *
 * V1 of the leagues & tournaments vertical slice plan: smallest meaningful
 * tournament-creation flow. Two steps (Details → Visibility), single screen,
 * no draft persistence, no post-success invite. No facility/venue attribution
 * in the MVP — the schema and tournament_update RPC support it for later.
 *
 * Mirrors MatchCreationWizard styling conventions:
 *   - Fixed-width header sides (40) so the sport badge stays centered
 *   - SheetScrollView per step, padding spacing[4], paddingBottom spacing[8]
 *   - stepHeader / fieldGroup / label structure
 *   - OptionCard pattern (icon + checkmark on selected)
 *   - Footer nextButton: paddingVertical[4], borderRadius lg, row layout
 *   - Disabled state via opacity 0.6
 *   - Success view: padding[6]/[4], absolute close button, successButtons wrapper
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V1
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  Modal,
  Keyboard,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getTournamentLogoUrl,
} from '@rallia/shared-utils';
import { useTheme, useCreateTournament, useUpdateTournament } from '@rallia/shared-hooks';
import type { Enums } from '@rallia/shared-types';
import type { TournamentUpdatePatch } from '@rallia/shared-services';

import { useTranslation, type TranslationKey } from '../../../hooks';
import { pickImageWithCropper } from '../../../utils/imagePicker';
import { uploadImage, deleteImage } from '../../../services/imageUpload';
import { useSport } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';
import * as Analytics from '../../../services/analytics';

const BASE_WHITE = '#ffffff';
const TOTAL_STEPS = 2;
const BRACKET_SIZES = [4, 8, 16, 32] as const;
type BracketSize = (typeof BRACKET_SIZES)[number];

type Visibility = Exclude<Enums<'tournament_visibility'>, 'community'>; // V1: private/public only
type RegistrationMode = Enums<'tournament_registration_mode'>;
type MatchFormat = Enums<'match_format'>;
type EntryFormat = Enums<'entry_format'>;

const ENTRY_FORMATS: readonly EntryFormat[] = ['singles', 'doubles', 'mixed_doubles'];
const ENTRY_FORMAT_KEYS: Record<EntryFormat, string> = {
  singles: 'tournamentDetail.values.singles',
  doubles: 'tournamentDetail.values.doubles',
  mixed_doubles: 'tournamentDetail.values.mixedDoubles',
};

const TENNIS_FORMATS: readonly MatchFormat[] = ['one_set', 'two_of_three', 'three_of_five'];
const PICKLEBALL_FORMATS: readonly MatchFormat[] = [
  'pickleball_to_11',
  'pickleball_to_15',
  'pickleball_to_21',
];
const MATCH_FORMAT_KEYS: Record<MatchFormat, { label: string; hint: string }> = {
  one_set: {
    label: 'tournamentCreation.fields.matchFormatOneSet',
    hint: 'tournamentCreation.fields.matchFormatOneSetHint',
  },
  two_of_three: {
    label: 'tournamentCreation.fields.matchFormatTwoOfThree',
    hint: 'tournamentCreation.fields.matchFormatTwoOfThreeHint',
  },
  three_of_five: {
    label: 'tournamentCreation.fields.matchFormatThreeOfFive',
    hint: 'tournamentCreation.fields.matchFormatThreeOfFiveHint',
  },
  pickleball_to_11: {
    label: 'tournamentCreation.fields.matchFormatTo11',
    hint: 'tournamentCreation.fields.matchFormatTo11Hint',
  },
  pickleball_to_15: {
    label: 'tournamentCreation.fields.matchFormatTo15',
    hint: 'tournamentCreation.fields.matchFormatTo15Hint',
  },
  pickleball_to_21: {
    label: 'tournamentCreation.fields.matchFormatTo21',
    hint: 'tournamentCreation.fields.matchFormatTo21Hint',
  },
};

const formatOptionsForSport = (sportName: string | undefined): readonly MatchFormat[] =>
  sportName === 'pickleball' ? PICKLEBALL_FORMATS : TENNIS_FORMATS;

const STEP_ANALYTICS_NAMES = ['details', 'visibility'] as const;

const defaultFormatForSport = (sportName: string | undefined): MatchFormat =>
  sportName === 'pickleball' ? 'pickleball_to_11' : 'two_of_three';

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
  progressActive: string;
  progressInactive: string;
  inputBackground: string;
  inputBorder: string;
  error: string;
  success: string;
}

/**
 * Payload to launch the wizard in edit mode (initialData pattern). Carries the
 * tournament fields to prefill plus its sport (edit can't change sport).
 */
export interface TournamentEditData {
  id: string;
  version: number;
  status: Enums<'tournament_status'>;
  name: string;
  description: string | null;
  rules: string | null;
  logoUrl: string | null;
  visibility: Enums<'tournament_visibility'>;
  startDate: string; // ISO
  endDate: string; // ISO
  maxParticipants: number;
  matchFormat: MatchFormat;
  sport: { id: string; name: string; display_name: string };
}

export interface TournamentCreationWizardProps {
  onClose: () => void;
  onBackToLanding: () => void;
  onSuccess: (tournamentId: string) => void;
  /** Success-screen "Share invite link" — navigates to detail with the invite sheet open. */
  onShareInvite?: (tournamentId: string) => void;
  /** When present, the wizard runs in edit mode against this tournament. */
  editTournament?: TournamentEditData;
}

// =============================================================================
// HEADER & PROGRESS
// =============================================================================

const WizardHeader: React.FC<{
  currentStep: number;
  isEditMode: boolean;
  onBack: () => void;
  onBackToLanding: () => void;
  onClose: () => void;
  sportName: string;
  sportKey: string;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({
  currentStep,
  isEditMode,
  onBack,
  onBackToLanding,
  onClose,
  sportName,
  sportKey,
  colors,
  t,
}) => (
  <View style={[styles.header, { borderBottomColor: colors.border }]}>
    {/* Step 1 in edit mode has no landing to go back to — the close (X) handles
        dismiss — so the back chevron is hidden there. The empty spacer keeps the
        sport badge centered. */}
    <View style={styles.headerLeft}>
      {!(isEditMode && currentStep === 1) && (
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            lightHaptic();
            if (currentStep === 1) onBackToLanding();
            else onBack();
          }}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back' as TranslationKey)}
        >
          <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
        </TouchableOpacity>
      )}
    </View>

    <View style={[styles.sportBadge, { backgroundColor: colors.buttonActive }]}>
      <SportIcon sportName={sportKey} size={14} color={BASE_WHITE} />
      <Text size="sm" weight="semibold" color={BASE_WHITE}>
        {sportName}
      </Text>
    </View>

    <View style={styles.headerRight}>
      <TouchableOpacity
        onPress={() => {
          Keyboard.dismiss();
          lightHaptic();
          onClose();
        }}
        style={styles.headerButton}
        accessibilityRole="button"
        accessibilityLabel={t('common.close' as TranslationKey)}
      >
        <Ionicons name="close-outline" size={24} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  </View>
);

const ProgressBar: React.FC<{
  currentStep: number;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({ currentStep, colors, t }) => {
  const pct = (currentStep / TOTAL_STEPS) * 100;
  const stepNames = [
    t('tournamentCreation.stepNames.details' as TranslationKey),
    t('tournamentCreation.stepNames.visibility' as TranslationKey),
  ];
  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressHeader}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {t('tournamentCreation.step' as TranslationKey)
            .replace('{current}', String(currentStep))
            .replace('{total}', String(TOTAL_STEPS))}
        </Text>
        <Text size="sm" weight="bold" color={colors.progressActive}>
          {stepNames[currentStep - 1]}
        </Text>
      </View>
      <View style={[styles.progressBarBg, { backgroundColor: colors.progressInactive }]}>
        <View
          style={[
            styles.progressBarFill,
            { backgroundColor: colors.progressActive, width: `${pct}%` },
          ]}
        />
      </View>
    </View>
  );
};

// =============================================================================
// REUSABLE OPTION CARD (mirrors PreferencesStep.tsx)
// =============================================================================

interface OptionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  colors: ThemeColors;
  compact?: boolean;
}

const OptionCard: React.FC<OptionCardProps> = ({
  icon,
  title,
  description,
  selected,
  onPress,
  colors,
  compact = false,
}) => (
  <TouchableOpacity
    style={[
      compact ? styles.optionCardCompact : styles.optionCard,
      {
        backgroundColor: selected ? `${colors.buttonActive}15` : colors.buttonInactive,
        borderColor: selected ? colors.buttonActive : colors.border,
      },
    ]}
    onPress={() => {
      lightHaptic();
      onPress();
    }}
    activeOpacity={0.7}
  >
    {compact ? (
      <View style={styles.optionContentCompact}>
        <Ionicons name={icon} size={24} color={selected ? colors.buttonActive : colors.textMuted} />
        <Text
          size="sm"
          weight={selected ? 'semibold' : 'regular'}
          color={selected ? colors.buttonActive : colors.text}
          style={styles.compactTitle}
        >
          {title}
        </Text>
      </View>
    ) : (
      <>
        <View style={styles.optionContent}>
          <Ionicons
            name={icon}
            size={20}
            color={selected ? colors.buttonActive : colors.textMuted}
          />
          <View style={styles.optionTextContainer}>
            <Text
              size="base"
              weight={selected ? 'semibold' : 'regular'}
              color={selected ? colors.buttonActive : colors.text}
            >
              {title}
            </Text>
            {description && (
              <Text size="xs" color={colors.textMuted}>
                {description}
              </Text>
            )}
          </View>
        </View>
        {selected && <Ionicons name="checkmark-circle" size={20} color={colors.buttonActive} />}
      </>
    )}
  </TouchableOpacity>
);

const FieldLabel: React.FC<{ children: string; colors: ThemeColors }> = ({ children, colors }) => (
  <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
    {children}
  </Text>
);

// =============================================================================
// STEPS
// =============================================================================

const DateField: React.FC<{
  label: string;
  date: Date | null;
  onPress: () => void;
  placeholder: string;
  error?: string;
  colors: ThemeColors;
  locale: string;
  testID?: string;
}> = ({ label, date, onPress, placeholder, error, colors, locale, testID }) => {
  const formatted = date
    ? date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
    : placeholder;
  return (
    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>{label}</FieldLabel>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={[
          styles.dateButton,
          {
            backgroundColor: colors.inputBackground,
            borderColor: error ? colors.error : colors.inputBorder,
          },
        ]}
        accessibilityRole="button"
        testID={testID}
      >
        <Text size="base" color={date ? colors.text : colors.textMuted}>
          {formatted}
        </Text>
        <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
      </TouchableOpacity>
      {error && (
        <Text size="xs" color={colors.error} style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
};

const DetailsStep: React.FC<{
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  /** Rules are edit-only (set on the tournament sheet after creation). */
  rules: string;
  setRules: (v: string) => void;
  /** Poster/logo is edit-only too (uploaded to the tournament-logos bucket). */
  logoUrl: string | null;
  posterUploading: boolean;
  onPickPoster: () => void;
  onRemovePoster: () => void;
  bracketSize: BracketSize;
  setBracketSize: (v: BracketSize) => void;
  matchFormat: MatchFormat;
  setMatchFormat: (v: MatchFormat) => void;
  formatOptions: readonly MatchFormat[];
  entryFormat: EntryFormat;
  setEntryFormat: (v: EntryFormat) => void;
  /** Entry format is fixed at creation; hidden when editing. */
  canPickEntryFormat: boolean;
  /** Bracket size & format are only editable while the tournament is a draft. */
  canEditStructure: boolean;
  startDate: Date | null;
  endDate: Date | null;
  setStartDate: (d: Date) => void;
  setEndDate: (d: Date) => void;
  errors: Record<string, string | undefined>;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
  locale: string;
  isDark: boolean;
  /** Edit mode allows a start date in the past (the tournament may have begun). */
  isEditMode: boolean;
}> = ({
  name,
  setName,
  description,
  setDescription,
  rules,
  setRules,
  logoUrl,
  posterUploading,
  onPickPoster,
  onRemovePoster,
  bracketSize,
  setBracketSize,
  matchFormat,
  setMatchFormat,
  formatOptions,
  entryFormat,
  setEntryFormat,
  canPickEntryFormat,
  canEditStructure,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  errors,
  colors,
  t,
  locale,
  isDark,
  isEditMode,
}) => {
  const [pickerOpen, setPickerOpen] = useState<'start' | 'end' | null>(null);
  // Tracks the value the spinner currently shows, so "Done" commits it even
  // when the user never scrolls (iOS onChange only fires on an actual change).
  const [pickerValue, setPickerValue] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const minimumDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const openPicker = useCallback(
    (which: 'start' | 'end') => {
      const seed =
        which === 'start' ? (startDate ?? minimumDate) : (endDate ?? startDate ?? minimumDate);
      setPickerValue(seed);
      setPickerOpen(which);
    },
    [startDate, endDate, minimumDate]
  );

  const commitDate = useCallback(
    (which: 'start' | 'end', value: Date) => {
      if (which === 'start') setStartDate(value);
      else setEndDate(value);
    },
    [setStartDate, setEndDate]
  );

  const onChange = useCallback(
    (_event: unknown, selected?: Date) => {
      // Android's default picker has no "Done" — commit and close on change.
      if (Platform.OS === 'android') {
        setPickerOpen(null);
        if (selected && pickerOpen) commitDate(pickerOpen, selected);
        return;
      }
      if (selected) setPickerValue(selected);
    },
    [pickerOpen, commitDate]
  );

  return (
    <SheetScrollView
      style={styles.stepContainer}
      contentContainerStyle={styles.stepContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={styles.stepHeader}>
        <Text size="lg" weight="bold" color={colors.text}>
          {t('tournamentCreation.step1Title' as TranslationKey)}
        </Text>
        <Text size="sm" color={colors.textMuted}>
          {t('tournamentCreation.step1Description' as TranslationKey)}
        </Text>
      </View>

      <View style={styles.fieldGroup}>
        <FieldLabel colors={colors}>
          {t('tournamentCreation.fields.name' as TranslationKey)}
        </FieldLabel>
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: errors.name ? colors.error : colors.inputBorder,
              color: colors.text,
            },
          ]}
          placeholder={t('tournamentCreation.fields.namePlaceholder' as TranslationKey)}
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          maxLength={100}
          autoCapitalize="sentences"
          autoCorrect={false}
          returnKeyType="done"
          testID="tournament-name-input"
        />
        {errors.name && (
          <Text size="xs" color={colors.error} style={styles.errorText}>
            {errors.name}
          </Text>
        )}
      </View>

      <View style={styles.fieldGroup}>
        <FieldLabel colors={colors}>
          {t('tournamentCreation.fields.description' as TranslationKey)}
        </FieldLabel>
        <TextInput
          style={[
            styles.textInput,
            styles.textArea,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.text,
            },
          ]}
          placeholder={t('tournamentCreation.fields.descriptionPlaceholder' as TranslationKey)}
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={setDescription}
          maxLength={500}
          multiline
          autoCapitalize="sentences"
        />
      </View>

      <View style={styles.fieldGroup}>
        <FieldLabel colors={colors}>
          {t('tournamentCreation.fields.rules' as TranslationKey)}
        </FieldLabel>
        <TextInput
          style={[
            styles.textInput,
            styles.textArea,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.text,
            },
          ]}
          placeholder={t('tournamentCreation.fields.rulesPlaceholder' as TranslationKey)}
          placeholderTextColor={colors.textMuted}
          value={rules}
          onChangeText={setRules}
          maxLength={2000}
          multiline
          autoCapitalize="sentences"
        />
      </View>

      <View style={styles.fieldGroup}>
        <FieldLabel colors={colors}>
          {t('tournamentCreation.fields.poster' as TranslationKey)}
        </FieldLabel>
        {logoUrl ? (
          <View>
            <Image
              source={{
                uri: logoUrl.startsWith('http')
                  ? (getTournamentLogoUrl(logoUrl) ?? logoUrl)
                  : logoUrl,
              }}
              style={styles.posterPreview}
              resizeMode="cover"
            />
            <TouchableOpacity
              style={[styles.posterRemoveBtn, { backgroundColor: colors.cardBackground }]}
              onPress={onRemovePoster}
              disabled={posterUploading}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('tournamentCreation.fields.posterRemove' as TranslationKey)}
            >
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.posterChangeBtn}
              onPress={onPickPoster}
              disabled={posterUploading}
            >
              {posterUploading ? (
                <ActivityIndicator color={colors.textSecondary} />
              ) : (
                <Text size="xs" weight="semibold" color={colors.textSecondary}>
                  {t('tournamentCreation.fields.posterChange' as TranslationKey)}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.posterAddBtn,
              { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
            ]}
            onPress={onPickPoster}
            disabled={posterUploading}
            activeOpacity={0.7}
          >
            {posterUploading ? (
              <ActivityIndicator color={colors.textSecondary} />
            ) : (
              <>
                <Ionicons name="image-outline" size={22} color={colors.textSecondary} />
                <Text size="sm" weight="medium" color={colors.textSecondary}>
                  {t('tournamentCreation.fields.posterAdd' as TranslationKey)}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {canEditStructure && (
        <>
          {canPickEntryFormat && (
            <View style={styles.fieldGroup}>
              <FieldLabel colors={colors}>
                {t('tournamentCreation.fields.entryFormat' as TranslationKey)}
              </FieldLabel>
              <View style={styles.optionsRow}>
                {ENTRY_FORMATS.map(format => {
                  const selected = format === entryFormat;
                  return (
                    <TouchableOpacity
                      key={format}
                      testID={`entry-format-${format}`}
                      onPress={() => {
                        lightHaptic();
                        setEntryFormat(format);
                      }}
                      activeOpacity={0.7}
                      style={[
                        styles.bracketChip,
                        {
                          backgroundColor: selected
                            ? `${colors.buttonActive}15`
                            : colors.buttonInactive,
                          borderColor: selected ? colors.buttonActive : colors.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text
                        size="base"
                        weight={selected ? 'semibold' : 'regular'}
                        color={selected ? colors.buttonActive : colors.text}
                      >
                        {t(ENTRY_FORMAT_KEYS[format] as TranslationKey)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {entryFormat !== 'singles' && (
                <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
                  {t('tournamentCreation.fields.entryFormatDoublesHint' as TranslationKey)}
                </Text>
              )}
            </View>
          )}

          <View style={styles.fieldGroup}>
            <FieldLabel colors={colors}>
              {t(
                (entryFormat === 'singles'
                  ? 'tournamentCreation.fields.maxParticipants'
                  : 'tournamentCreation.fields.maxTeams') as TranslationKey
              )}
            </FieldLabel>
            <View style={styles.optionsRow}>
              {BRACKET_SIZES.map(n => {
                const selected = n === bracketSize;
                return (
                  <TouchableOpacity
                    key={n}
                    onPress={() => {
                      lightHaptic();
                      setBracketSize(n);
                    }}
                    activeOpacity={0.7}
                    style={[
                      styles.bracketChip,
                      {
                        backgroundColor: selected
                          ? `${colors.buttonActive}15`
                          : colors.buttonInactive,
                        borderColor: selected ? colors.buttonActive : colors.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      size="base"
                      weight={selected ? 'semibold' : 'regular'}
                      color={selected ? colors.buttonActive : colors.text}
                    >
                      {n}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
              {t(
                (entryFormat === 'singles'
                  ? 'tournamentCreation.fields.maxParticipantsHint'
                  : 'tournamentCreation.fields.maxTeamsHint') as TranslationKey
              )}
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <FieldLabel colors={colors}>
              {t('tournamentCreation.fields.matchFormat' as TranslationKey)}
            </FieldLabel>
            <View style={styles.optionsRow}>
              {formatOptions.map(format => {
                const selected = format === matchFormat;
                return (
                  <TouchableOpacity
                    key={format}
                    onPress={() => {
                      lightHaptic();
                      setMatchFormat(format);
                    }}
                    activeOpacity={0.7}
                    style={[
                      styles.bracketChip,
                      {
                        backgroundColor: selected
                          ? `${colors.buttonActive}15`
                          : colors.buttonInactive,
                        borderColor: selected ? colors.buttonActive : colors.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      size="base"
                      weight={selected ? 'semibold' : 'regular'}
                      color={selected ? colors.buttonActive : colors.text}
                    >
                      {t(MATCH_FORMAT_KEYS[format].label as TranslationKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
              {t(MATCH_FORMAT_KEYS[matchFormat].hint as TranslationKey)}
            </Text>
          </View>
        </>
      )}

      {!canEditStructure && (
        <View style={styles.fieldGroup}>
          <Text size="xs" color={colors.textMuted}>
            {t('tournamentDetail.editModal.draftOnlyHint' as TranslationKey)}
          </Text>
        </View>
      )}

      <DateField
        label={t('tournamentCreation.fields.startDate' as TranslationKey)}
        date={startDate}
        onPress={() => openPicker('start')}
        placeholder={t('tournamentCreation.fields.startDatePlaceholder' as TranslationKey)}
        error={errors.startDate}
        colors={colors}
        locale={locale}
        testID="tournament-start-date"
      />

      <DateField
        label={t('tournamentCreation.fields.endDate' as TranslationKey)}
        date={endDate}
        onPress={() => openPicker('end')}
        placeholder={t('tournamentCreation.fields.endDatePlaceholder' as TranslationKey)}
        error={errors.endDate}
        colors={colors}
        locale={locale}
        testID="tournament-end-date"
      />

      {Platform.OS === 'ios' ? (
        <Modal visible={pickerOpen !== null} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalSheet, { backgroundColor: colors.cardBackground }]}>
              {/* Mount the native picker only when a field is tapped. RN renders
                  Modal children even while hidden, so an always-mounted
                  DateTimePicker would stall every wizard open. */}
              {pickerOpen !== null && (
                <DateTimePicker
                  value={pickerValue}
                  mode="date"
                  display="spinner"
                  minimumDate={
                    pickerOpen === 'end' && startDate
                      ? startDate
                      : isEditMode
                        ? undefined
                        : minimumDate
                  }
                  onChange={onChange}
                  themeVariant={isDark ? 'dark' : 'light'}
                />
              )}
              <TouchableOpacity
                onPress={() => {
                  if (pickerOpen) commitDate(pickerOpen, pickerValue);
                  setPickerOpen(null);
                }}
                style={[styles.modalDoneButton, { backgroundColor: colors.buttonActive }]}
                accessibilityRole="button"
                testID="tournament-date-done"
              >
                <Text size="base" weight="semibold" color={colors.buttonTextActive}>
                  {t('common.done' as TranslationKey)}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : pickerOpen !== null ? (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          display="default"
          minimumDate={pickerOpen === 'end' && startDate ? startDate : minimumDate}
          onChange={onChange}
        />
      ) : null}
    </SheetScrollView>
  );
};

const VisibilityStep: React.FC<{
  visibility: Enums<'tournament_visibility'>;
  setVisibility: (v: Visibility) => void;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({ visibility, setVisibility, colors, t }) => (
  <SheetScrollView
    style={styles.stepContainer}
    contentContainerStyle={styles.stepContent}
    showsVerticalScrollIndicator={false}
    keyboardShouldPersistTaps="handled"
  >
    <View style={styles.stepHeader}>
      <Text size="lg" weight="bold" color={colors.text}>
        {t('tournamentCreation.visibilityStepTitle' as TranslationKey)}
      </Text>
      <Text size="sm" color={colors.textMuted}>
        {t('tournamentCreation.visibilityStepDescription' as TranslationKey)}
      </Text>
    </View>

    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('tournamentCreation.fields.visibility' as TranslationKey)}
      </FieldLabel>
      <View style={styles.optionsColumn}>
        <OptionCard
          icon="lock-closed-outline"
          title={t('tournamentCreation.fields.visibilityPrivate' as TranslationKey)}
          description={t(
            'tournamentCreation.fields.visibilityPrivateDescription' as TranslationKey
          )}
          selected={visibility === 'private'}
          onPress={() => setVisibility('private')}
          colors={colors}
        />
        <OptionCard
          icon="globe-outline"
          title={t('tournamentCreation.fields.visibilityPublic' as TranslationKey)}
          description={t('tournamentCreation.fields.visibilityPublicDescription' as TranslationKey)}
          selected={visibility === 'public'}
          onPress={() => setVisibility('public')}
          colors={colors}
        />
      </View>
    </View>

    {/*
      The registration-mode picker (open / approval / invite_only) is hidden:
      only 'open' is shippable, so there's no selection to make. The wizard
      forces registrationMode='open' (see useState below). Restore the picker
      here when the organizer-side flows for the other modes are built
      (approve/reject pending registrations; issue/redeem invites) — the
      tournament_register RPC already branches on all three modes server-side.
      See tournamentService.registerForTournament.
    */}
  </SheetScrollView>
);

// =============================================================================
// MAIN
// =============================================================================

export const TournamentCreationWizard: React.FC<TournamentCreationWizardProps> = ({
  onClose,
  onBackToLanding,
  onSuccess,
  onShareInvite,
  editTournament,
}) => {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { selectedSport } = useSport();
  const toast = useToast();
  const isDark = theme === 'dark';
  const isEditMode = !!editTournament;

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ThemeColors>(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonInactive: themeColors.muted,
      buttonTextActive: BASE_WHITE,
      progressActive: isDark ? primary[500] : primary[600],
      progressInactive: themeColors.muted,
      inputBackground: isDark ? neutral[800] : neutral[100],
      inputBorder: isDark ? neutral[700] : neutral[200],
      error: '#dc2626',
      success: '#16a34a',
    }),
    [themeColors, isDark]
  );

  // In edit mode the sport is fixed by the tournament; otherwise it follows the
  // selected sport context. Mirrors MatchCreationWizard's editMatch handling.
  const sportName = editTournament?.sport.name ?? selectedSport?.name;
  const formatOptions = formatOptionsForSport(sportName);
  // Bracket size & match format lock once a tournament leaves draft.
  const canEditStructure = !isEditMode || editTournament?.status === 'draft';

  const [currentStep, setCurrentStep] = useState(1);
  const [name, setName] = useState(editTournament?.name ?? '');
  const [description, setDescription] = useState(editTournament?.description ?? '');
  const [rules, setRules] = useState(editTournament?.rules ?? '');
  const [logoUrl, setLogoUrl] = useState<string | null>(editTournament?.logoUrl ?? null);
  const [posterUploading, setPosterUploading] = useState(false);
  const [bracketSize, setBracketSize] = useState<BracketSize>(
    (editTournament?.maxParticipants as BracketSize) ?? 8
  );
  const [matchFormat, setMatchFormat] = useState<MatchFormat>(
    () => editTournament?.matchFormat ?? defaultFormatForSport(sportName)
  );
  // Entry format is fixed at creation (the server's tournament_update doesn't
  // accept it), so edit mode never surfaces the picker.
  const [entryFormat, setEntryFormat] = useState<EntryFormat>('singles');
  const [startDate, setStartDate] = useState<Date | null>(
    editTournament ? new Date(editTournament.startDate) : null
  );
  const [endDate, setEndDate] = useState<Date | null>(
    editTournament ? new Date(editTournament.endDate) : null
  );
  // Holds the full enum (incl. 'community') so an untouched non-private/public
  // tournament isn't silently flipped on save; the create path only ever sets
  // private/public via the option cards.
  const [visibility, setVisibility] = useState<Enums<'tournament_visibility'>>(
    editTournament?.visibility ?? 'private'
  );
  // Fixed to 'open' — the registration-mode picker is hidden in VisibilityStep
  // until the approval/invite_only organizer flows exist. Kept as state so the
  // create payload and resetForm wiring stay intact for an easy restore.
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('open');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Poster upload to the public tournament-logos bucket. Errors use Alert (not
  // toast) because the wizard runs inside a sheet, where toasts render behind it.
  // Pick + crop only — the upload is deferred to submit (handleSubmit) so an
  // abandoned/cancelled form never orphans an uploaded file. logoUrl holds the
  // local URI until then.
  const handlePickPoster = useCallback(async () => {
    const { uri } = await pickImageWithCropper({ aspectRatio: [16, 9], quality: 0.85 });
    if (!uri) return;
    lightHaptic();
    setLogoUrl(uri);
  }, []);

  const handleRemovePoster = useCallback(() => {
    lightHaptic();
    setLogoUrl(null);
  }, []);

  const startTimeRef = useRef(Date.now());
  const startedTrackedRef = useRef(false);
  useEffect(() => {
    if (!isEditMode && !startedTrackedRef.current && selectedSport?.id) {
      startedTrackedRef.current = true;
      Analytics.tournamentCreationStarted({
        sportId: selectedSport.id,
        sportName: selectedSport.name ?? '',
      });
    }
  }, [selectedSport, isEditMode]);

  const { createTournamentAsync, isCreating } = useCreateTournament({
    onError: err => {
      const msg = err.message || '';
      const key = msg.includes('SPORT_MISMATCH')
        ? 'tournamentCreation.errors.sportMismatch'
        : msg.includes('RATE_LIMITED')
          ? 'tournamentCreation.errors.rateLimited'
          : 'tournamentCreation.errors.generic';
      warningHaptic();
      toast.error(t(key as TranslationKey));
    },
  });

  const { mutateAsync: updateTournamentAsync, isPending: isUpdating } = useUpdateTournament({
    onError: e => {
      const msg = e.message || '';
      const key = msg.includes('OPTIMISTIC_LOCK_CONFLICT')
        ? 'tournamentDetail.errors.lockConflict'
        : msg.includes('FIELD_NOT_EDITABLE')
          ? 'tournamentDetail.editModal.errors.notEditable'
          : msg.includes('INVALID_DATES')
            ? 'tournamentCreation.validation.endBeforeStart'
            : 'tournamentDetail.editModal.errors.generic';
      warningHaptic();
      toast.error(t(key as TranslationKey));
    },
  });

  const handleSetStartDate = useCallback(
    (d: Date) => {
      setStartDate(d);
      if (!endDate || endDate < d) setEndDate(d);
    },
    [endDate]
  );

  const validateStep = useCallback(
    (step: number): boolean => {
      const next: Record<string, string | undefined> = {};
      if (step === 1) {
        const trimmed = name.trim();
        if (!trimmed) next.name = t('tournamentCreation.validation.nameRequired' as TranslationKey);
        else if (trimmed.length > 100)
          next.name = t('tournamentCreation.validation.nameTooLong' as TranslationKey);

        if (!startDate || !endDate) {
          next.startDate = !startDate
            ? t('tournamentCreation.validation.datesRequired' as TranslationKey)
            : undefined;
          next.endDate = !endDate
            ? t('tournamentCreation.validation.datesRequired' as TranslationKey)
            : undefined;
        } else {
          if (endDate < startDate)
            next.endDate = t('tournamentCreation.validation.endBeforeStart' as TranslationKey);
          // Past-start guard applies to new tournaments only — an existing
          // tournament may already have started (registration_closed / live).
          if (!isEditMode) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (startDate < today)
              next.startDate = t('tournamentCreation.validation.startInPast' as TranslationKey);
          }
        }
      }
      setErrors(next);
      return Object.values(next).every(v => !v);
    },
    [name, startDate, endDate, isEditMode, t]
  );

  const goNext = useCallback(() => {
    if (!validateStep(currentStep)) {
      warningHaptic();
      return;
    }
    Analytics.tournamentCreationStepCompleted({
      stepIndex: currentStep,
      stepName: STEP_ANALYTICS_NAMES[currentStep - 1],
      sportName: sportName ?? '',
    });
    lightHaptic();
    setCurrentStep(s => Math.min(TOTAL_STEPS, s + 1));
  }, [currentStep, validateStep, sportName]);

  const goBack = useCallback(() => {
    setCurrentStep(s => Math.max(1, s - 1));
  }, []);

  const trackAbandoned = useCallback(() => {
    if (showSuccess) return;
    Analytics.tournamentCreationAbandoned({
      lastStep: currentStep,
      durationSeconds: Math.round((Date.now() - startTimeRef.current) / 1000),
      sportName: sportName ?? '',
    });
  }, [showSuccess, currentStep, sportName]);

  const handleClose = useCallback(() => {
    trackAbandoned();
    onClose();
  }, [trackAbandoned, onClose]);

  const handleBackToLanding = useCallback(() => {
    trackAbandoned();
    onBackToLanding();
  }, [trackAbandoned, onBackToLanding]);

  const handleSubmit = useCallback(async () => {
    if (!validateStep(1)) {
      setCurrentStep(1);
      return;
    }
    if (!startDate || !endDate) return;

    // Upload a freshly-picked poster now (on submit) rather than at selection,
    // so abandoning the form never orphans an uploaded file. logoUrl is a local
    // URI for a new pick, or an existing remote URL (https) when unchanged.
    let resolvedLogoUrl = logoUrl;
    if (logoUrl && !/^https?:\/\//.test(logoUrl)) {
      setPosterUploading(true);
      const { url } = await uploadImage(logoUrl, 'tournament-logos');
      setPosterUploading(false);
      if (!url) {
        warningHaptic();
        Alert.alert(
          t('tournamentCreation.errors.posterUploadFailedTitle' as TranslationKey),
          t('tournamentCreation.errors.posterUploadFailed' as TranslationKey)
        );
        return;
      }
      resolvedLogoUrl = url;
    }

    // ---- Edit mode: diff against the original and PATCH only what changed ----
    if (isEditMode && editTournament) {
      const patch: TournamentUpdatePatch = {};
      const trimmedName = name.trim();
      if (trimmedName !== editTournament.name) patch.name = trimmedName;
      const desc = description.trim();
      if (desc !== (editTournament.description ?? ''))
        patch.description = desc.length ? desc : null;
      const trimmedRules = rules.trim();
      if (trimmedRules !== (editTournament.rules ?? ''))
        patch.rules = trimmedRules.length ? trimmedRules : null;
      if (resolvedLogoUrl !== (editTournament.logoUrl ?? null)) patch.logoUrl = resolvedLogoUrl;
      if (visibility !== editTournament.visibility) patch.visibility = visibility;
      if (startDate.toISOString() !== new Date(editTournament.startDate).toISOString())
        patch.startDate = startDate.toISOString();
      if (endDate.toISOString() !== new Date(editTournament.endDate).toISOString())
        patch.endDate = endDate.toISOString();
      if (canEditStructure) {
        if (bracketSize !== editTournament.maxParticipants) patch.maxParticipants = bracketSize;
        if (matchFormat !== editTournament.matchFormat) patch.matchFormat = matchFormat;
      }

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      try {
        await updateTournamentAsync({
          tournamentId: editTournament.id,
          versionWas: editTournament.version,
          patch,
        });
        successHaptic();
        // Only after the update commits: clean up the previous poster file when
        // it was replaced or removed, so the bucket doesn't accumulate orphans.
        // Done post-success so a failed update never strips a still-referenced file.
        const oldPoster = editTournament.logoUrl;
        if (oldPoster && oldPoster !== resolvedLogoUrl && oldPoster.startsWith('http')) {
          void deleteImage(oldPoster, 'tournament-logos');
        }
        onSuccess(editTournament.id);
      } catch {
        // Error toast handled by hook's onError.
      }
      return;
    }

    // ---- Create mode ----
    if (!selectedSport?.id) return;
    try {
      const tournament = await createTournamentAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        rules: rules.trim() || undefined,
        logoUrl: resolvedLogoUrl ?? undefined,
        sportId: selectedSport.id,
        maxParticipants: bracketSize,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        visibility: visibility as Visibility,
        registrationMode,
        matchFormat,
        entryFormat,
      });
      successHaptic();
      Analytics.tournamentCreated({
        tournamentId: tournament.id,
        sportId: selectedSport.id,
        sportName: selectedSport.name ?? '',
        maxParticipants: bracketSize,
        matchFormat,
        visibility,
      });
      setCreatedId(tournament.id);
      setShowSuccess(true);
    } catch {
      // Error toast handled by hook's onError.
    }
  }, [
    isEditMode,
    editTournament,
    canEditStructure,
    selectedSport,
    name,
    description,
    rules,
    logoUrl,
    bracketSize,
    matchFormat,
    startDate,
    endDate,
    visibility,
    registrationMode,
    createTournamentAsync,
    updateTournamentAsync,
    onClose,
    onSuccess,
    validateStep,
    t,
  ]);

  const handleCreateAnother = useCallback(() => {
    setName('');
    setDescription('');
    setRules('');
    setLogoUrl(null);
    setPosterUploading(false);
    setBracketSize(8);
    setMatchFormat(defaultFormatForSport(sportName));
    setEntryFormat('singles');
    setStartDate(null);
    setEndDate(null);
    setVisibility('private');
    setRegistrationMode('open');
    setErrors({});
    setShowSuccess(false);
    setCreatedId(null);
    setCurrentStep(1);
  }, [sportName]);

  // Success view
  if (showSuccess) {
    return (
      <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.successContainer}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.successCloseButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.close' as TranslationKey)}
          >
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={[styles.successIcon, { backgroundColor: colors.success }]}>
            <Ionicons name="trophy-outline" size={48} color={BASE_WHITE} />
          </View>
          <Text size="xl" weight="bold" color={colors.text} style={styles.successTitle}>
            {t('tournamentCreation.success' as TranslationKey)}
          </Text>
          <Text size="base" color={colors.textMuted} style={styles.successDescription}>
            {t('tournamentCreation.successDescription' as TranslationKey)}
          </Text>

          <View style={styles.successButtons}>
            {!isEditMode && onShareInvite && (
              <TouchableOpacity
                onPress={() => {
                  if (createdId) onShareInvite(createdId);
                }}
                style={[styles.successButton, { backgroundColor: colors.buttonActive }]}
                accessibilityRole="button"
                testID="tournament-success-share"
              >
                <Ionicons name="share-social-outline" size={20} color={colors.buttonTextActive} />
                <Text size="base" weight="semibold" color={colors.buttonTextActive}>
                  {t('tournamentCreation.shareInvite' as TranslationKey)}
                </Text>
              </TouchableOpacity>
            )}
            {(() => {
              // Share (when present) takes the primary slot; View drops to secondary.
              const viewIsPrimary = isEditMode || !onShareInvite;
              const fg = viewIsPrimary ? colors.buttonTextActive : colors.buttonActive;
              return (
                <TouchableOpacity
                  onPress={() => {
                    if (createdId) onSuccess(createdId);
                  }}
                  style={[
                    styles.successButton,
                    {
                      backgroundColor: viewIsPrimary ? colors.buttonActive : colors.buttonInactive,
                    },
                  ]}
                  accessibilityRole="button"
                  testID="tournament-success-view"
                >
                  <Ionicons name="eye-outline" size={20} color={fg} />
                  <Text size="base" weight="semibold" color={fg}>
                    {t('tournamentCreation.viewTournament' as TranslationKey)}
                  </Text>
                </TouchableOpacity>
              );
            })()}
            <TouchableOpacity
              onPress={handleCreateAnother}
              style={[styles.successButton, { backgroundColor: colors.buttonInactive }]}
              accessibilityRole="button"
            >
              <Ionicons name="add-outline" size={20} color={colors.buttonActive} />
              <Text size="base" weight="semibold" color={colors.buttonActive}>
                {t('tournamentCreation.createAnother' as TranslationKey)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Wizard
  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      <WizardHeader
        currentStep={currentStep}
        isEditMode={isEditMode}
        onBack={goBack}
        onBackToLanding={handleBackToLanding}
        onClose={handleClose}
        sportName={
          editTournament?.sport.display_name ??
          selectedSport?.display_name ??
          selectedSport?.name ??
          ''
        }
        sportKey={editTournament?.sport.name ?? selectedSport?.name ?? 'tennis'}
        colors={colors}
        t={t}
      />
      <ProgressBar currentStep={currentStep} colors={colors} t={t} />

      <View style={styles.body}>
        {currentStep === 1 && (
          <DetailsStep
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            rules={rules}
            setRules={setRules}
            logoUrl={logoUrl}
            posterUploading={posterUploading}
            onPickPoster={handlePickPoster}
            onRemovePoster={handleRemovePoster}
            bracketSize={bracketSize}
            setBracketSize={setBracketSize}
            matchFormat={matchFormat}
            setMatchFormat={setMatchFormat}
            formatOptions={formatOptions}
            entryFormat={entryFormat}
            setEntryFormat={setEntryFormat}
            canPickEntryFormat={!isEditMode}
            canEditStructure={canEditStructure}
            startDate={startDate}
            endDate={endDate}
            setStartDate={handleSetStartDate}
            setEndDate={setEndDate}
            errors={errors}
            colors={colors}
            t={t}
            locale={locale}
            isDark={isDark}
            isEditMode={isEditMode}
          />
        )}
        {currentStep === 2 && (
          <VisibilityStep
            visibility={visibility}
            setVisibility={setVisibility}
            colors={colors}
            t={t}
          />
        )}
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          onPress={currentStep === TOTAL_STEPS ? handleSubmit : goNext}
          disabled={isCreating || isUpdating}
          style={[
            styles.nextButton,
            { backgroundColor: colors.buttonActive },
            (isCreating || isUpdating) && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          testID="tournament-wizard-submit"
        >
          <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
            {currentStep === TOTAL_STEPS
              ? isEditMode
                ? isUpdating
                  ? t('tournamentDetail.editModal.saving' as TranslationKey)
                  : t('tournamentDetail.editModal.save' as TranslationKey)
                : isCreating
                  ? t('tournamentCreation.creating' as TranslationKey)
                  : t('tournamentCreation.createTournament' as TranslationKey)
              : t('tournamentCreation.next' as TranslationKey)}
          </Text>
          {currentStep !== TOTAL_STEPS && (
            <Ionicons name="arrow-forward-outline" size={20} color={colors.buttonTextActive} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// =============================================================================
// STYLES — mirrors MatchCreationWizard + PreferencesStep conventions
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  sportBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1.5],
  },
  progressContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  progressBarBg: {
    height: 4,
    borderRadius: radiusPixels.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radiusPixels.full,
  },
  body: {
    flex: 1,
  },
  stepContainer: {
    flex: 1,
  },
  stepContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  stepHeader: {
    marginBottom: spacingPixels[6],
  },
  fieldGroup: {
    marginBottom: spacingPixels[5],
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  fieldHint: {
    marginTop: spacingPixels[2],
  },
  errorText: {
    marginTop: spacingPixels[1],
  },
  textInput: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    fontSize: 16,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  posterAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    height: 120,
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  posterPreview: {
    width: '100%',
    height: 160,
    borderRadius: radiusPixels.lg,
  },
  posterRemoveBtn: {
    position: 'absolute',
    top: spacingPixels[2],
    right: spacingPixels[2],
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterChangeBtn: {
    alignSelf: 'center',
    paddingVertical: spacingPixels[2],
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  optionsColumn: {
    gap: spacingPixels[2],
  },
  optionsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacingPixels[3],
  },
  optionTextContainer: {
    flex: 1,
  },
  optionCardCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    flex: 1,
    minHeight: 70,
  },
  optionContentCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
  },
  compactTitle: {
    textAlign: 'center',
  },
  bracketChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
    paddingBottom: spacingPixels[4],
    position: 'relative',
  },
  successCloseButton: {
    position: 'absolute',
    top: spacingPixels[4],
    right: spacingPixels[4],
    padding: spacingPixels[1],
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  successTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  successDescription: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  successButtons: {
    gap: spacingPixels[3],
    width: '100%',
  },
  successButton: {
    flexDirection: 'row',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[6],
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  modalDoneButton: {
    marginTop: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
  },
});

export default TournamentCreationWizard;
