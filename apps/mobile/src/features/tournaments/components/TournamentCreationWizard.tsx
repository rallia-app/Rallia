/**
 * TournamentCreationWizard
 *
 * V1 of the leagues & tournaments vertical slice plan: smallest meaningful
 * tournament-creation flow. Three steps (Basics → Schedule → Visibility),
 * single screen, no draft persistence, no analytics, no post-success invite.
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
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useTheme, useCreateTournament } from '@rallia/shared-hooks';
import type { Enums } from '@rallia/shared-types';

import { useTranslation, type TranslationKey } from '../../../hooks';
import { useSport } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';

const BASE_WHITE = '#ffffff';
const TOTAL_STEPS = 2;
const BRACKET_SIZES = [4, 8, 16, 32] as const;
type BracketSize = (typeof BRACKET_SIZES)[number];

type Visibility = Exclude<Enums<'tournament_visibility'>, 'community'>; // V1: private/public only
type RegistrationMode = Enums<'tournament_registration_mode'>;

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
    <View style={styles.headerLeft}>
      <TouchableOpacity
        onPress={() => {
          Keyboard.dismiss();
          lightHaptic();
          if (currentStep === 1) onBackToLanding();
          else onBack();
        }}
        style={styles.headerButton}
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

    <View style={styles.headerRight}>
      <TouchableOpacity
        onPress={() => {
          Keyboard.dismiss();
          lightHaptic();
          onClose();
        }}
        style={styles.headerButton}
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
}> = ({ label, date, onPress, placeholder, error, colors, locale }) => {
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
  bracketSize: BracketSize;
  setBracketSize: (v: BracketSize) => void;
  startDate: Date | null;
  endDate: Date | null;
  setStartDate: (d: Date) => void;
  setEndDate: (d: Date) => void;
  errors: Record<string, string | undefined>;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
  locale: string;
  isDark: boolean;
}> = ({
  name,
  setName,
  bracketSize,
  setBracketSize,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  errors,
  colors,
  t,
  locale,
  isDark,
}) => {
  const [pickerOpen, setPickerOpen] = useState<'start' | 'end' | null>(null);
  const minimumDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const onChange = useCallback(
    (_event: unknown, selected?: Date) => {
      if (Platform.OS === 'android') setPickerOpen(null);
      if (!selected) return;
      if (pickerOpen === 'start') setStartDate(selected);
      if (pickerOpen === 'end') setEndDate(selected);
    },
    [pickerOpen, setStartDate, setEndDate]
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
      </View>

      <View style={styles.fieldGroup}>
        <FieldLabel colors={colors}>
          {t('tournamentCreation.fields.maxParticipants' as TranslationKey)}
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
                    backgroundColor: selected ? `${colors.buttonActive}15` : colors.buttonInactive,
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
          {t('tournamentCreation.fields.maxParticipantsHint' as TranslationKey)}
        </Text>
      </View>

      <DateField
        label={t('tournamentCreation.fields.startDate' as TranslationKey)}
        date={startDate}
        onPress={() => setPickerOpen('start')}
        placeholder={t('tournamentCreation.fields.startDatePlaceholder' as TranslationKey)}
        error={errors.startDate}
        colors={colors}
        locale={locale}
      />

      <DateField
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
                themeVariant={isDark ? 'dark' : 'light'}
              />
              <TouchableOpacity
                onPress={() => setPickerOpen(null)}
                style={[styles.modalDoneButton, { backgroundColor: colors.buttonActive }]}
                accessibilityRole="button"
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
    </SheetScrollView>
  );
};

const VisibilityStep: React.FC<{
  visibility: Visibility;
  setVisibility: (v: Visibility) => void;
  registrationMode: RegistrationMode;
  setRegistrationMode: (v: RegistrationMode) => void;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({ visibility, setVisibility, registrationMode, setRegistrationMode, colors, t }) => (
  <SheetScrollView
    style={styles.stepContainer}
    contentContainerStyle={styles.stepContent}
    showsVerticalScrollIndicator={false}
    keyboardShouldPersistTaps="handled"
  >
    <View style={styles.stepHeader}>
      <Text size="lg" weight="bold" color={colors.text}>
        {t('tournamentCreation.step2Title' as TranslationKey)}
      </Text>
      <Text size="sm" color={colors.textMuted}>
        {t('tournamentCreation.step2Description' as TranslationKey)}
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

    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('tournamentCreation.fields.registrationMode' as TranslationKey)}
      </FieldLabel>
      <View style={styles.optionsColumn}>
        <OptionCard
          icon="enter-outline"
          title={t('tournamentCreation.fields.registrationModeOpen' as TranslationKey)}
          description={t(
            'tournamentCreation.fields.registrationModeOpenDescription' as TranslationKey
          )}
          selected={registrationMode === 'open'}
          onPress={() => setRegistrationMode('open')}
          colors={colors}
        />
        <OptionCard
          icon="checkmark-done-outline"
          title={t('tournamentCreation.fields.registrationModeApproval' as TranslationKey)}
          description={t(
            'tournamentCreation.fields.registrationModeApprovalDescription' as TranslationKey
          )}
          selected={registrationMode === 'approval'}
          onPress={() => setRegistrationMode('approval')}
          colors={colors}
        />
        <OptionCard
          icon="mail-outline"
          title={t('tournamentCreation.fields.registrationModeInviteOnly' as TranslationKey)}
          description={t(
            'tournamentCreation.fields.registrationModeInviteOnlyDescription' as TranslationKey
          )}
          selected={registrationMode === 'invite_only'}
          onPress={() => setRegistrationMode('invite_only')}
          colors={colors}
        />
      </View>
    </View>
  </SheetScrollView>
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
    if (!validateStep(1)) {
      setCurrentStep(1);
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
      <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.successContainer}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.successCloseButton}
            accessibilityRole="button"
            accessibilityLabel="Close"
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
            <TouchableOpacity
              onPress={() => {
                if (createdId) onSuccess(createdId);
              }}
              style={[styles.successButton, { backgroundColor: colors.buttonActive }]}
              accessibilityRole="button"
            >
              <Ionicons name="eye-outline" size={20} color={colors.buttonTextActive} />
              <Text size="base" weight="semibold" color={colors.buttonTextActive}>
                {t('tournamentCreation.viewTournament' as TranslationKey)}
              </Text>
            </TouchableOpacity>
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
          <DetailsStep
            name={name}
            setName={setName}
            bracketSize={bracketSize}
            setBracketSize={setBracketSize}
            startDate={startDate}
            endDate={endDate}
            setStartDate={handleSetStartDate}
            setEndDate={setEndDate}
            errors={errors}
            colors={colors}
            t={t}
            locale={locale}
            isDark={isDark}
          />
        )}
        {currentStep === 2 && (
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
            styles.nextButton,
            { backgroundColor: colors.buttonActive },
            isCreating && styles.buttonDisabled,
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
          {currentStep !== TOTAL_STEPS && (
            <Ionicons name="arrow-forward" size={20} color={colors.buttonTextActive} />
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
