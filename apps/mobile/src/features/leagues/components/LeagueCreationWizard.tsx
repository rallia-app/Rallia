/**
 * LeagueCreationWizard
 *
 * V6 league creation flow (Details → Visibility & join mode). Mirrors
 * TournamentCreationWizard / MatchCreationWizard styling conventions:
 *   - Fixed-width header sides (40) so the sport badge stays centered
 *   - SheetScrollView per step, padding spacing[4], paddingBottom spacing[8]
 *   - stepHeader / fieldGroup / FieldLabel structure
 *   - OptionCard pattern (icon + checkmark on selected)
 *   - Footer nextButton: paddingVertical[4], borderRadius lg, row layout
 *   - Disabled state via opacity 0.6
 *   - Success view: padding[6]/[4], absolute close button, successButtons wrapper
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V6
 */

import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, Keyboard } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useTheme, useCreateLeague, useUpdateLeague } from '@rallia/shared-hooks';
import type { LeagueUpdatePatch } from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import { useTranslation, type TranslationKey } from '../../../hooks';
import { useSport } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';
import * as Analytics from '../../../services/analytics';

const BASE_WHITE = '#ffffff';
const TOTAL_STEPS = 2;

type Visibility = Exclude<Enums<'tournament_visibility'>, 'community'>;
type JoinMode = Enums<'tournament_registration_mode'>;

/**
 * The subset of a league the wizard can edit. Passed via sheet payload, so it
 * carries `version` for the server's optimistic lock.
 */
export interface LeagueEditData {
  id: string;
  version: number;
  name: string;
  description: string | null;
  visibility: Visibility;
  joinMode: JoinMode;
}

export interface LeagueCreationWizardProps {
  onClose: () => void;
  onBackToLanding: () => void;
  onSuccess: (leagueId: string) => void;
  /** Present ⇒ edit mode: the wizard PATCHes instead of creating. */
  editLeague?: LeagueEditData;
}

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
    <View style={styles.headerLeft}>
      {/* Edit opens straight into the form, so step 1 has no landing to go back to. */}
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
    t('leagueCreation.stepNames.details' as TranslationKey),
    t('leagueCreation.stepNames.visibility' as TranslationKey),
  ];
  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressHeader}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {t('leagueCreation.step' as TranslationKey)
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

interface OptionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  colors: ThemeColors;
}

const OptionCard: React.FC<OptionCardProps> = ({
  icon,
  title,
  description,
  selected,
  onPress,
  colors,
}) => (
  <TouchableOpacity
    style={[
      styles.optionCard,
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
    <View style={styles.optionContent}>
      <Ionicons name={icon} size={20} color={selected ? colors.buttonActive : colors.textMuted} />
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

const DetailsStep: React.FC<{
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  errors: Record<string, string | undefined>;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({ name, setName, description, setDescription, errors, colors, t }) => (
  <SheetScrollView
    style={styles.stepContainer}
    contentContainerStyle={styles.stepContent}
    showsVerticalScrollIndicator={false}
    keyboardShouldPersistTaps="handled"
    keyboardDismissMode="on-drag"
  >
    <View style={styles.stepHeader}>
      <Text size="lg" weight="bold" color={colors.text}>
        {t('leagueCreation.step1Title' as TranslationKey)}
      </Text>
      <Text size="sm" color={colors.textMuted}>
        {t('leagueCreation.step1Description' as TranslationKey)}
      </Text>
    </View>

    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>{t('leagueCreation.fields.name' as TranslationKey)}</FieldLabel>
      <TextInput
        style={[
          styles.textInput,
          {
            backgroundColor: colors.inputBackground,
            borderColor: errors.name ? colors.error : colors.inputBorder,
            color: colors.text,
          },
        ]}
        placeholder={t('leagueCreation.fields.namePlaceholder' as TranslationKey)}
        placeholderTextColor={colors.textMuted}
        value={name}
        onChangeText={setName}
        maxLength={100}
        autoCapitalize="sentences"
        autoCorrect={false}
        returnKeyType="done"
        testID="league-name-input"
      />
      {errors.name && (
        <Text size="xs" color={colors.error} style={styles.errorText}>
          {errors.name}
        </Text>
      )}
    </View>

    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('leagueCreation.fields.description' as TranslationKey)}
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
        placeholder={t('leagueCreation.fields.descriptionPlaceholder' as TranslationKey)}
        placeholderTextColor={colors.textMuted}
        value={description}
        onChangeText={setDescription}
        maxLength={500}
        multiline
        autoCapitalize="sentences"
      />
    </View>
  </SheetScrollView>
);

const VisibilityStep: React.FC<{
  visibility: Visibility;
  setVisibility: (v: Visibility) => void;
  joinMode: JoinMode;
  setJoinMode: (v: JoinMode) => void;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({ visibility, setVisibility, joinMode, setJoinMode, colors, t }) => (
  <SheetScrollView
    style={styles.stepContainer}
    contentContainerStyle={styles.stepContent}
    showsVerticalScrollIndicator={false}
    keyboardShouldPersistTaps="handled"
  >
    <View style={styles.stepHeader}>
      <Text size="lg" weight="bold" color={colors.text}>
        {t('leagueCreation.visibilityStepTitle' as TranslationKey)}
      </Text>
      <Text size="sm" color={colors.textMuted}>
        {t('leagueCreation.visibilityStepDescription' as TranslationKey)}
      </Text>
    </View>

    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('leagueCreation.fields.visibility' as TranslationKey)}
      </FieldLabel>
      <View style={styles.optionsColumn}>
        <OptionCard
          icon="lock-closed-outline"
          title={t('leagueCreation.fields.visibilityPrivate' as TranslationKey)}
          description={t('leagueCreation.fields.visibilityPrivateDescription' as TranslationKey)}
          selected={visibility === 'private'}
          onPress={() => setVisibility('private')}
          colors={colors}
        />
        <OptionCard
          icon="globe-outline"
          title={t('leagueCreation.fields.visibilityPublic' as TranslationKey)}
          description={t('leagueCreation.fields.visibilityPublicDescription' as TranslationKey)}
          selected={visibility === 'public'}
          onPress={() => setVisibility('public')}
          colors={colors}
        />
      </View>
    </View>

    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('leagueCreation.fields.joinMode' as TranslationKey)}
      </FieldLabel>
      <View style={styles.optionsColumn}>
        <OptionCard
          icon="enter-outline"
          title={t('leagueCreation.fields.joinModeOpen' as TranslationKey)}
          description={t('leagueCreation.fields.joinModeOpenDescription' as TranslationKey)}
          selected={joinMode === 'open'}
          onPress={() => setJoinMode('open')}
          colors={colors}
        />
        <OptionCard
          icon="shield-checkmark-outline"
          title={t('leagueCreation.fields.joinModeApproval' as TranslationKey)}
          description={t('leagueCreation.fields.joinModeApprovalDescription' as TranslationKey)}
          selected={joinMode === 'approval'}
          onPress={() => setJoinMode('approval')}
          colors={colors}
        />
        <OptionCard
          icon="mail-outline"
          title={t('leagueCreation.fields.joinModeInviteOnly' as TranslationKey)}
          description={t('leagueCreation.fields.joinModeInviteOnlyDescription' as TranslationKey)}
          selected={joinMode === 'invite_only'}
          onPress={() => setJoinMode('invite_only')}
          colors={colors}
        />
      </View>
    </View>
  </SheetScrollView>
);

// =============================================================================
// MAIN
// =============================================================================

export const LeagueCreationWizard: React.FC<LeagueCreationWizardProps> = ({
  onClose,
  onBackToLanding,
  onSuccess,
  editLeague,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
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
      error: status.error.dark,
      success: '#16a34a',
    }),
    [themeColors, isDark]
  );

  const sportName = selectedSport?.display_name ?? selectedSport?.name ?? '';
  const sportKey = selectedSport?.name ?? 'tennis';

  const isEditMode = !!editLeague;

  // The sheet unmounts its children on close, so each open remounts with fresh
  // state seeded from the payload — no sync effect needed.
  const [currentStep, setCurrentStep] = useState(1);
  const [name, setName] = useState(editLeague?.name ?? '');
  const [description, setDescription] = useState(editLeague?.description ?? '');
  const [visibility, setVisibility] = useState<Visibility>(editLeague?.visibility ?? 'private');
  const [joinMode, setJoinMode] = useState<JoinMode>(editLeague?.joinMode ?? 'approval');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const { createLeagueAsync, isCreating } = useCreateLeague({
    onError: err => {
      const msg = err.message || '';
      const key = msg.includes('SPORT_MISMATCH')
        ? 'leagueCreation.errors.sportMismatch'
        : msg.includes('RATE_LIMITED')
          ? 'leagueCreation.errors.rateLimited'
          : 'leagueCreation.errors.generic';
      warningHaptic();
      toast.error(t(key as TranslationKey));
    },
  });

  const { updateLeagueAsync, isUpdating } = useUpdateLeague({
    onError: err => {
      const msg = err.message || '';
      // OPTIMISTIC_LOCK_CONFLICT / FIELD_NOT_EDITABLE / LEAGUE_TERMINAL all mean
      // the same thing to a player: your copy is stale, reload.
      const key =
        msg.includes('OPTIMISTIC_LOCK_CONFLICT') ||
        msg.includes('FIELD_NOT_EDITABLE') ||
        msg.includes('LEAGUE_TERMINAL')
          ? 'leagueDetail.editModal.errors.notEditable'
          : 'leagueDetail.editModal.errors.generic';
      warningHaptic();
      toast.error(t(key as TranslationKey));
    },
  });

  const isSubmitting = isCreating || isUpdating;

  const validateStep = useCallback(
    (step: number): boolean => {
      const next: Record<string, string | undefined> = {};
      if (step === 1) {
        const trimmed = name.trim();
        if (!trimmed) next.name = t('leagueCreation.validation.nameRequired' as TranslationKey);
        else if (trimmed.length > 100)
          next.name = t('leagueCreation.validation.nameTooLong' as TranslationKey);
      }
      setErrors(next);
      return Object.values(next).every(v => !v);
    },
    [name, t]
  );

  const goNext = useCallback(() => {
    if (!validateStep(currentStep)) {
      warningHaptic();
      return;
    }
    lightHaptic();
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      setCurrentStep(s => Math.min(TOTAL_STEPS, s + 1));
    });
  }, [currentStep, validateStep]);

  const goBack = useCallback(() => {
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      setCurrentStep(s => Math.max(1, s - 1));
    });
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    if (!validateStep(1)) {
      setCurrentStep(1);
      return;
    }

    // ---- Edit mode: diff against the original and PATCH only what changed ----
    if (isEditMode && editLeague) {
      try {
        const patch: LeagueUpdatePatch = {};
        const trimmedName = name.trim();
        if (trimmedName !== editLeague.name) patch.name = trimmedName;
        const desc = description.trim();
        if (desc !== (editLeague.description ?? '')) patch.description = desc.length ? desc : null;
        if (visibility !== editLeague.visibility) patch.visibility = visibility;
        if (joinMode !== editLeague.joinMode) patch.joinMode = joinMode;

        // The server rejects an empty patch, so a no-op save just closes.
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }

        await updateLeagueAsync({
          leagueId: editLeague.id,
          versionWas: editLeague.version,
          patch,
        });
        successHaptic();
        onSuccess(editLeague.id);
      } catch {
        // toast handled in hook
      }
      return;
    }

    // ---- Create mode ----
    if (!selectedSport?.id) return;
    try {
      const league = await createLeagueAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        sportId: selectedSport.id,
        visibility,
        joinMode,
      });
      successHaptic();
      Analytics.leagueCreated({
        leagueId: league.id,
        sportId: selectedSport.id,
        joinMode,
        visibility,
      });
      setCreatedId(league.id);
      setShowSuccess(true);
    } catch {
      // toast handled in hook
    }
  }, [
    createLeagueAsync,
    description,
    editLeague,
    isEditMode,
    joinMode,
    name,
    onClose,
    onSuccess,
    selectedSport,
    updateLeagueAsync,
    validateStep,
    visibility,
  ]);

  const handleCreateAnother = useCallback(() => {
    setName('');
    setDescription('');
    setVisibility('private');
    setJoinMode('approval');
    setErrors({});
    setShowSuccess(false);
    setCreatedId(null);
    setCurrentStep(1);
  }, []);

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
            <Ionicons name="ribbon-outline" size={48} color={BASE_WHITE} />
          </View>
          <Text size="xl" weight="bold" color={colors.text} style={styles.successTitle}>
            {t('leagueCreation.success' as TranslationKey)}
          </Text>
          <Text size="base" color={colors.textMuted} style={styles.successDescription}>
            {t('leagueCreation.successDescription' as TranslationKey)}
          </Text>

          <View style={styles.successButtons}>
            <TouchableOpacity
              onPress={() => createdId && onSuccess(createdId)}
              style={[styles.successButton, { backgroundColor: colors.buttonActive }]}
              accessibilityRole="button"
              testID="league-success-view"
            >
              <Ionicons name="eye-outline" size={20} color={colors.buttonTextActive} />
              <Text size="base" weight="semibold" color={colors.buttonTextActive}>
                {t('leagueCreation.viewLeague' as TranslationKey)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleCreateAnother}
              style={[styles.successButton, { backgroundColor: colors.buttonInactive }]}
              accessibilityRole="button"
            >
              <Ionicons name="add-outline" size={20} color={colors.buttonActive} />
              <Text size="base" weight="semibold" color={colors.buttonActive}>
                {t('leagueCreation.createAnother' as TranslationKey)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      <WizardHeader
        currentStep={currentStep}
        isEditMode={isEditMode}
        onBack={goBack}
        onBackToLanding={onBackToLanding}
        onClose={handleClose}
        sportName={sportName}
        sportKey={sportKey}
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
            errors={errors}
            colors={colors}
            t={t}
          />
        )}
        {currentStep === 2 && (
          <VisibilityStep
            visibility={visibility}
            setVisibility={setVisibility}
            joinMode={joinMode}
            setJoinMode={setJoinMode}
            colors={colors}
            t={t}
          />
        )}
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          onPress={currentStep === TOTAL_STEPS ? handleSubmit : goNext}
          disabled={isSubmitting}
          style={[
            styles.nextButton,
            { backgroundColor: colors.buttonActive },
            isSubmitting && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          testID="league-wizard-submit"
        >
          <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
            {currentStep === TOTAL_STEPS
              ? isEditMode
                ? isUpdating
                  ? t('leagueDetail.editModal.saving' as TranslationKey)
                  : t('leagueDetail.editModal.save' as TranslationKey)
                : isCreating
                  ? t('leagueCreation.creating' as TranslationKey)
                  : t('leagueCreation.createLeague' as TranslationKey)
              : t('leagueCreation.next' as TranslationKey)}
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
// STYLES — mirrors TournamentCreationWizard conventions
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
  optionsColumn: {
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
});

export default LeagueCreationWizard;
