/**
 * TournamentCreationWizard
 *
 * V1 of the leagues & tournaments vertical slice plan: smallest meaningful
 * tournament-creation flow. Three steps (Basics → Schedule → Visibility),
 * single screen, no draft persistence, no analytics, no post-success invite.
 *
 * Mirrors the structure of MatchCreationWizard but intentionally tighter:
 * - Plain useState form state, not react-hook-form
 * - Inline step components in the same file
 * - Steps render conditionally (no horizontal slide)
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V1
 */

import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  Modal,
  Keyboard,
} from 'react-native';
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
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useTheme, useCreateTournament } from '@rallia/shared-hooks';
import type { Enums } from '@rallia/shared-types';

import { useTranslation, type TranslationKey } from '../../../hooks';
import { useSport } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';

const BASE_WHITE = '#ffffff';
const TOTAL_STEPS = 3;
const BRACKET_SIZES = [4, 8, 16, 32] as const;
type BracketSize = (typeof BRACKET_SIZES)[number];

type Visibility = Exclude<Enums<'tournament_visibility'>, 'community'>; // V1: private/public only
type RegistrationMode = Enums<'tournament_registration_mode'>;

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  progressActive: string;
  progressInactive: string;
  inputBackground: string;
  inputBorder: string;
  inputBorderFocused: string;
  error: string;
  success: string;
}

export interface TournamentCreationWizardProps {
  onClose: () => void;
  onBackToLanding: () => void;
  onSuccess: (tournamentId: string) => void;
}

// =============================================================================
// HEADER & PROGRESS
// =============================================================================

const WizardHeader: React.FC<{
  currentStep: number;
  onBack: () => void;
  onBackToLanding: () => void;
  onClose: () => void;
  sportName: string;
  sportKey: string;
  colors: ThemeColors;
}> = ({ currentStep, onBack, onBackToLanding, onClose, sportName, sportKey, colors }) => (
  <View style={[styles.header, { borderBottomColor: colors.border }]}>
    <View style={styles.headerSide}>
      <TouchableOpacity
        onPress={() => {
          Keyboard.dismiss();
          lightHaptic();
          if (currentStep === 1) onBackToLanding();
          else onBack();
        }}
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
      </TouchableOpacity>
    </View>

    <View style={[styles.sportBadge, { backgroundColor: colors.buttonActive }]}>
      <SportIcon sportName={sportKey} size={14} color={BASE_WHITE} />
      <Text size="sm" weight="semibold" color={BASE_WHITE}>
        {sportName}
      </Text>
    </View>

    <View style={[styles.headerSide, styles.headerRight]}>
      <TouchableOpacity
        onPress={() => {
          Keyboard.dismiss();
          lightHaptic();
          onClose();
        }}
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Close"
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
    t('tournamentCreation.stepNames.basics' as TranslationKey),
    t('tournamentCreation.stepNames.schedule' as TranslationKey),
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
// STEPS
// =============================================================================

const SegmentedChips = <T extends string | number>({
  options,
  value,
  onChange,
  renderLabel,
  colors,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  renderLabel: (v: T) => string;
  colors: ThemeColors;
}) => (
  <View style={styles.chipsRow}>
    {options.map(opt => {
      const selected = opt === value;
      return (
        <TouchableOpacity
          key={String(opt)}
          onPress={() => {
            lightHaptic();
            onChange(opt);
          }}
          style={[
            styles.chip,
            {
              backgroundColor: selected ? colors.buttonActive : colors.buttonInactive,
              borderColor: selected ? colors.buttonActive : colors.inputBorder,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected }}
        >
          <Text
            size="sm"
            weight={selected ? 'semibold' : 'medium'}
            color={selected ? colors.buttonTextActive : colors.text}
          >
            {renderLabel(opt)}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const FieldLabel: React.FC<{ children: string; colors: ThemeColors }> = ({ children, colors }) => (
  <Text size="sm" weight="semibold" color={colors.text} style={styles.fieldLabel}>
    {children}
  </Text>
);

const BasicsStep: React.FC<{
  name: string;
  setName: (v: string) => void;
  bracketSize: BracketSize;
  setBracketSize: (v: BracketSize) => void;
  errors: Record<string, string | undefined>;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({ name, setName, bracketSize, setBracketSize, errors, colors, t }) => (
  <View style={styles.stepContent}>
    <Text size="lg" weight="bold" color={colors.text} style={styles.stepTitle}>
      {t('tournamentCreation.step1Title' as TranslationKey)}
    </Text>
    <Text size="sm" color={colors.textMuted} style={styles.stepDescription}>
      {t('tournamentCreation.step1Description' as TranslationKey)}
    </Text>

    <FieldLabel colors={colors}>{t('tournamentCreation.fields.name' as TranslationKey)}</FieldLabel>
    <TextInput
      style={[
        styles.input,
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
      maxLength={120}
      autoCapitalize="sentences"
      autoCorrect={false}
      returnKeyType="done"
    />
    {errors.name && (
      <Text size="xs" color={colors.error} style={styles.errorText}>
        {errors.name}
      </Text>
    )}

    <FieldLabel colors={colors}>
      {t('tournamentCreation.fields.maxParticipants' as TranslationKey)}
    </FieldLabel>
    <SegmentedChips
      options={BRACKET_SIZES}
      value={bracketSize}
      onChange={setBracketSize}
      renderLabel={n => String(n)}
      colors={colors}
    />
    <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
      {t('tournamentCreation.fields.maxParticipantsHint' as TranslationKey)}
    </Text>
  </View>
);

const DateRow: React.FC<{
  label: string;
  date: Date | null;
  onPress: () => void;
  placeholder: string;
  error?: string;
  colors: ThemeColors;
  locale: string;
}> = ({ label, date, onPress, placeholder, error, colors, locale }) => {
  const formatted = date
    ? date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
    : placeholder;
  return (
    <View>
      <FieldLabel colors={colors}>{label}</FieldLabel>
      <TouchableOpacity
        onPress={onPress}
        style={[
          styles.input,
          styles.dateButton,
          {
            backgroundColor: colors.inputBackground,
            borderColor: error ? colors.error : colors.inputBorder,
          },
        ]}
        accessibilityRole="button"
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

const ScheduleStep: React.FC<{
  startDate: Date | null;
  endDate: Date | null;
  setStartDate: (d: Date) => void;
  setEndDate: (d: Date) => void;
  errors: Record<string, string | undefined>;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
  locale: string;
}> = ({ startDate, endDate, setStartDate, setEndDate, errors, colors, t, locale }) => {
  const [pickerOpen, setPickerOpen] = useState<'start' | 'end' | null>(null);
  const minimumDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const onChange = useCallback(
    (_event: unknown, selected?: Date) => {
      if (Platform.OS === 'android') {
        setPickerOpen(null);
      }
      if (!selected) return;
      if (pickerOpen === 'start') setStartDate(selected);
      if (pickerOpen === 'end') setEndDate(selected);
    },
    [pickerOpen, setStartDate, setEndDate]
  );

  return (
    <View style={styles.stepContent}>
      <Text size="lg" weight="bold" color={colors.text} style={styles.stepTitle}>
        {t('tournamentCreation.step2Title' as TranslationKey)}
      </Text>
      <Text size="sm" color={colors.textMuted} style={styles.stepDescription}>
        {t('tournamentCreation.step2Description' as TranslationKey)}
      </Text>

      <DateRow
        label={t('tournamentCreation.fields.startDate' as TranslationKey)}
        date={startDate}
        onPress={() => setPickerOpen('start')}
        placeholder={t('tournamentCreation.fields.startDatePlaceholder' as TranslationKey)}
        error={errors.startDate}
        colors={colors}
        locale={locale}
      />

      <DateRow
        label={t('tournamentCreation.fields.endDate' as TranslationKey)}
        date={endDate}
        onPress={() => setPickerOpen('end')}
        placeholder={t('tournamentCreation.fields.endDatePlaceholder' as TranslationKey)}
        error={errors.endDate}
        colors={colors}
        locale={locale}
      />

      {Platform.OS === 'ios' ? (
        <Modal visible={pickerOpen !== null} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalSheet, { backgroundColor: colors.cardBackground }]}>
              <DateTimePicker
                value={
                  (pickerOpen === 'start' ? startDate : endDate) ??
                  (pickerOpen === 'end' && startDate ? startDate : minimumDate)
                }
                mode="date"
                display="spinner"
                minimumDate={pickerOpen === 'end' && startDate ? startDate : minimumDate}
                onChange={onChange}
                themeVariant={colors.background === darkTheme.background ? 'dark' : 'light'}
              />
              <TouchableOpacity
                onPress={() => setPickerOpen(null)}
                style={[styles.modalDoneButton, { backgroundColor: colors.buttonActive }]}
              >
                <Text size="base" weight="semibold" color={colors.buttonTextActive}>
                  Done
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : pickerOpen !== null ? (
        <DateTimePicker
          value={
            (pickerOpen === 'start' ? startDate : endDate) ??
            (pickerOpen === 'end' && startDate ? startDate : minimumDate)
          }
          mode="date"
          display="default"
          minimumDate={pickerOpen === 'end' && startDate ? startDate : minimumDate}
          onChange={onChange}
        />
      ) : null}
    </View>
  );
};

const RadioOption: React.FC<{
  selected: boolean;
  title: string;
  description: string;
  onPress: () => void;
  colors: ThemeColors;
}> = ({ selected, title, description, onPress, colors }) => (
  <TouchableOpacity
    onPress={() => {
      lightHaptic();
      onPress();
    }}
    style={[
      styles.radioOption,
      {
        borderColor: selected ? colors.buttonActive : colors.inputBorder,
        backgroundColor: selected ? `${colors.buttonActive}10` : colors.inputBackground,
      },
    ]}
    accessibilityRole="radio"
    accessibilityState={{ selected }}
  >
    <View style={styles.radioOptionTop}>
      <View
        style={[
          styles.radioDot,
          {
            borderColor: selected ? colors.buttonActive : colors.inputBorder,
            backgroundColor: selected ? colors.buttonActive : 'transparent',
          },
        ]}
      />
      <Text size="base" weight="semibold" color={colors.text}>
        {title}
      </Text>
    </View>
    <Text size="sm" color={colors.textMuted} style={styles.radioDescription}>
      {description}
    </Text>
  </TouchableOpacity>
);

const VisibilityStep: React.FC<{
  visibility: Visibility;
  setVisibility: (v: Visibility) => void;
  registrationMode: RegistrationMode;
  setRegistrationMode: (v: RegistrationMode) => void;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({ visibility, setVisibility, registrationMode, setRegistrationMode, colors, t }) => (
  <View style={styles.stepContent}>
    <Text size="lg" weight="bold" color={colors.text} style={styles.stepTitle}>
      {t('tournamentCreation.step3Title' as TranslationKey)}
    </Text>
    <Text size="sm" color={colors.textMuted} style={styles.stepDescription}>
      {t('tournamentCreation.step3Description' as TranslationKey)}
    </Text>

    <FieldLabel colors={colors}>
      {t('tournamentCreation.fields.visibility' as TranslationKey)}
    </FieldLabel>
    <RadioOption
      selected={visibility === 'private'}
      title={t('tournamentCreation.fields.visibilityPrivate' as TranslationKey)}
      description={t('tournamentCreation.fields.visibilityPrivateDescription' as TranslationKey)}
      onPress={() => setVisibility('private')}
      colors={colors}
    />
    <RadioOption
      selected={visibility === 'public'}
      title={t('tournamentCreation.fields.visibilityPublic' as TranslationKey)}
      description={t('tournamentCreation.fields.visibilityPublicDescription' as TranslationKey)}
      onPress={() => setVisibility('public')}
      colors={colors}
    />

    <FieldLabel colors={colors}>
      {t('tournamentCreation.fields.registrationMode' as TranslationKey)}
    </FieldLabel>
    <RadioOption
      selected={registrationMode === 'open'}
      title={t('tournamentCreation.fields.registrationModeOpen' as TranslationKey)}
      description={t('tournamentCreation.fields.registrationModeOpenDescription' as TranslationKey)}
      onPress={() => setRegistrationMode('open')}
      colors={colors}
    />
    <RadioOption
      selected={registrationMode === 'approval'}
      title={t('tournamentCreation.fields.registrationModeApproval' as TranslationKey)}
      description={t(
        'tournamentCreation.fields.registrationModeApprovalDescription' as TranslationKey
      )}
      onPress={() => setRegistrationMode('approval')}
      colors={colors}
    />
    <RadioOption
      selected={registrationMode === 'invite_only'}
      title={t('tournamentCreation.fields.registrationModeInviteOnly' as TranslationKey)}
      description={t(
        'tournamentCreation.fields.registrationModeInviteOnlyDescription' as TranslationKey
      )}
      onPress={() => setRegistrationMode('invite_only')}
      colors={colors}
    />
  </View>
);

// =============================================================================
// MAIN
// =============================================================================

export const TournamentCreationWizard: React.FC<TournamentCreationWizardProps> = ({
  onClose,
  onBackToLanding,
  onSuccess,
}) => {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { selectedSport } = useSport();
  const toast = useToast();
  const isDark = theme === 'dark';

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ThemeColors>(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonInactive: themeColors.muted,
      buttonTextActive: BASE_WHITE,
      progressActive: isDark ? primary[500] : primary[600],
      progressInactive: themeColors.muted,
      inputBackground: isDark ? neutral[800] : neutral[100],
      inputBorder: isDark ? neutral[700] : neutral[200],
      inputBorderFocused: isDark ? primary[500] : primary[600],
      error: '#dc2626',
      success: '#16a34a',
    }),
    [themeColors, isDark]
  );

  // Form state
  const [currentStep, setCurrentStep] = useState(1);
  const [name, setName] = useState('');
  const [bracketSize, setBracketSize] = useState<BracketSize>(8);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('open');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

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

  // Auto-set end_date when start_date set and end is empty/before start
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
      }
      if (step === 2) {
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
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (startDate < today)
            next.startDate = t('tournamentCreation.validation.startInPast' as TranslationKey);
        }
      }
      setErrors(next);
      return Object.values(next).every(v => !v);
    },
    [name, startDate, endDate, t]
  );

  const goNext = useCallback(() => {
    if (!validateStep(currentStep)) {
      warningHaptic();
      return;
    }
    lightHaptic();
    setCurrentStep(s => Math.min(TOTAL_STEPS, s + 1));
  }, [currentStep, validateStep]);

  const goBack = useCallback(() => {
    setCurrentStep(s => Math.max(1, s - 1));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedSport?.id) return;
    if (!validateStep(2)) {
      setCurrentStep(2);
      return;
    }
    if (!startDate || !endDate) return;

    try {
      const tournament = await createTournamentAsync({
        name: name.trim(),
        sportId: selectedSport.id,
        maxParticipants: bracketSize,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        visibility,
        registrationMode,
      });
      successHaptic();
      setCreatedId(tournament.id);
      setShowSuccess(true);
    } catch {
      // Error toast handled by hook's onError.
    }
  }, [
    selectedSport,
    name,
    bracketSize,
    startDate,
    endDate,
    visibility,
    registrationMode,
    createTournamentAsync,
    validateStep,
  ]);

  const handleCreateAnother = useCallback(() => {
    setName('');
    setBracketSize(8);
    setStartDate(null);
    setEndDate(null);
    setVisibility('private');
    setRegistrationMode('open');
    setErrors({});
    setShowSuccess(false);
    setCreatedId(null);
    setCurrentStep(1);
  }, []);

  // Success view
  if (showSuccess) {
    return (
      <View style={[styles.root, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.successContainer}>
          <View style={[styles.successIcon, { backgroundColor: colors.success }]}>
            <Ionicons name="trophy-outline" size={48} color={BASE_WHITE} />
          </View>
          <Text size="xl" weight="bold" color={colors.text} style={styles.successTitle}>
            {t('tournamentCreation.success' as TranslationKey)}
          </Text>
          <Text size="base" color={colors.textMuted} style={styles.successDescription}>
            {t('tournamentCreation.successDescription' as TranslationKey)}
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (createdId) onSuccess(createdId);
            }}
            style={[styles.primaryButton, { backgroundColor: colors.buttonActive }]}
            accessibilityRole="button"
          >
            <Text size="base" weight="semibold" color={colors.buttonTextActive}>
              {t('tournamentCreation.viewTournament' as TranslationKey)}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleCreateAnother}
            style={styles.secondaryButton}
            accessibilityRole="button"
          >
            <Text size="base" weight="semibold" color={colors.buttonActive}>
              {t('tournamentCreation.createAnother' as TranslationKey)}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Wizard
  return (
    <View style={[styles.root, { backgroundColor: colors.cardBackground }]}>
      <WizardHeader
        currentStep={currentStep}
        onBack={goBack}
        onBackToLanding={onBackToLanding}
        onClose={onClose}
        sportName={selectedSport?.display_name ?? selectedSport?.name ?? ''}
        sportKey={selectedSport?.name ?? 'tennis'}
        colors={colors}
      />
      <ProgressBar currentStep={currentStep} colors={colors} t={t} />

      <View style={styles.body}>
        {currentStep === 1 && (
          <BasicsStep
            name={name}
            setName={setName}
            bracketSize={bracketSize}
            setBracketSize={setBracketSize}
            errors={errors}
            colors={colors}
            t={t}
          />
        )}
        {currentStep === 2 && (
          <ScheduleStep
            startDate={startDate}
            endDate={endDate}
            setStartDate={handleSetStartDate}
            setEndDate={setEndDate}
            errors={errors}
            colors={colors}
            t={t}
            locale={locale}
          />
        )}
        {currentStep === 3 && (
          <VisibilityStep
            visibility={visibility}
            setVisibility={setVisibility}
            registrationMode={registrationMode}
            setRegistrationMode={setRegistrationMode}
            colors={colors}
            t={t}
          />
        )}
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          onPress={currentStep === TOTAL_STEPS ? handleSubmit : goNext}
          disabled={isCreating}
          style={[
            styles.primaryButton,
            {
              backgroundColor: isCreating ? colors.buttonInactive : colors.buttonActive,
            },
          ]}
          accessibilityRole="button"
        >
          <Text size="base" weight="semibold" color={colors.buttonTextActive}>
            {currentStep === TOTAL_STEPS
              ? isCreating
                ? t('tournamentCreation.creating' as TranslationKey)
                : t('tournamentCreation.createTournament' as TranslationKey)
              : t('tournamentCreation.next' as TranslationKey)}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { flex: 1 },
  headerRight: { alignItems: 'flex-end' },
  iconButton: { padding: spacingPixels[1] },
  sportBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  progressContainer: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[2],
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  progressBarBg: {
    height: 6,
    borderRadius: radiusPixels.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radiusPixels.full,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
  },
  stepContent: { gap: spacingPixels[2] },
  stepTitle: { marginBottom: spacingPixels[1] },
  stepDescription: { marginBottom: spacingPixels[3] },
  fieldLabel: { marginTop: spacingPixels[3], marginBottom: spacingPixels[1] },
  fieldHint: { marginTop: spacingPixels[1] },
  errorText: { marginTop: spacingPixels[1] },
  input: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    fontSize: 16,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  chip: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    minWidth: 56,
    alignItems: 'center',
  },
  radioOption: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    padding: spacingPixels[3],
    marginTop: spacingPixels[2],
  },
  radioOptionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  radioDot: {
    width: 18,
    height: 18,
    borderRadius: radiusPixels.full,
    borderWidth: 2,
  },
  radioDescription: {
    marginTop: spacingPixels[1],
    marginLeft: spacingPixels[6],
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryButton: {
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    paddingVertical: spacingPixels[3],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[2],
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[6],
    gap: spacingPixels[3],
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[2],
  },
  successTitle: { textAlign: 'center' },
  successDescription: { textAlign: 'center', marginBottom: spacingPixels[3] },
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
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
    alignItems: 'center',
  },
});

export default TournamentCreationWizard;
