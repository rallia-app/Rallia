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
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
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
import { lightHaptic, successHaptic, warningHaptic, getLeagueLogoUrl } from '@rallia/shared-utils';
import {
  useTheme,
  useCreateLeague,
  useUpdateLeague,
  useRatingScoresForSport,
} from '@rallia/shared-hooks';
import type { LeagueUpdatePatch } from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import { useTranslation, type TranslationKey } from '../../../hooks';
import { useSport, useAuth } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';
import { pickImageWithCropper } from '../../../utils/imagePicker';
import { uploadImage, deleteImage } from '../../../services/imageUpload';
import * as Analytics from '../../../services/analytics';

const BASE_WHITE = '#ffffff';
const TOTAL_STEPS = 3;

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
  minRating?: number | null;
  maxRating?: number | null;
  logoUrl?: string | null;
  memberCapacity?: number | null;
  waitlistEnabled?: boolean;
  /** leagues.default_rules, so the points fields open on what the league runs. */
  defaultRules?: Record<string, unknown> | null;
}

/**
 * The three point values worth an organizer's attention. The rules jsonb holds
 * six more (draw, no-show, retirement and walkover variants); those keep the
 * sport defaults until someone asks for them.
 */
const POINT_FIELDS = ['pointWin', 'pointLoss', 'pointBye'] as const;
type PointsForm = Record<(typeof POINT_FIELDS)[number], string>;

/** Mirrors lt_league_default_rules, which seeds these at league_create. */
const DEFAULT_POINTS: PointsForm = { pointWin: '10', pointLoss: '1', pointBye: '1' };

function pointsFromRules(rules: Record<string, unknown> | null | undefined): PointsForm {
  if (!rules) return { ...DEFAULT_POINTS };
  const read = (k: (typeof POINT_FIELDS)[number]): string =>
    typeof rules[k] === 'number' ? String(rules[k]) : DEFAULT_POINTS[k];
  return { pointWin: read('pointWin'), pointLoss: read('pointLoss'), pointBye: read('pointBye') };
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
    t('leagueCreation.stepNames.eligibility' as TranslationKey),
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
  logoUrl: string | null;
  posterUploading: boolean;
  onPickPoster: () => void;
  onRemovePoster: () => void;
  errors: Record<string, string | undefined>;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({
  name,
  setName,
  description,
  setDescription,
  logoUrl,
  posterUploading,
  onPickPoster,
  onRemovePoster,
  errors,
  colors,
  t,
}) => (
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
      <FieldLabel colors={colors}>{t('leagueCreation.fields.cover' as TranslationKey)}</FieldLabel>
      {logoUrl ? (
        <View>
          <Image
            source={{
              uri: logoUrl.startsWith('http') ? (getLeagueLogoUrl(logoUrl) ?? logoUrl) : logoUrl,
            }}
            style={styles.posterPreview}
            resizeMode="cover"
          />
          <TouchableOpacity
            style={[styles.posterRemoveBtn, { backgroundColor: colors.cardBackground }]}
            onPress={onRemovePoster}
            disabled={posterUploading}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('leagueCreation.fields.coverRemove' as TranslationKey)}
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
                {t('leagueCreation.fields.coverChange' as TranslationKey)}
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
                {t('leagueCreation.fields.coverAdd' as TranslationKey)}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}
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

const RatingTierRow: React.FC<{
  label: string;
  noneLabel: string;
  value: number | null;
  setValue: (v: number | null) => void;
  ratingOptions: { id: string; value: number; label: string; skillLevel: string | null }[];
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
  testID?: string;
}> = ({ label, noneLabel, value, setValue, ratingOptions, colors, t, testID }) => (
  <View style={styles.fieldGroup}>
    <FieldLabel colors={colors}>{label}</FieldLabel>
    <GestureScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.ratingScrollContent}
      nestedScrollEnabled
      testID={testID}
    >
      <TouchableOpacity
        onPress={() => {
          lightHaptic();
          setValue(null);
        }}
        activeOpacity={0.7}
        style={[
          styles.ratingCard,
          {
            backgroundColor: value === null ? `${colors.buttonActive}15` : colors.buttonInactive,
            borderColor: value === null ? colors.buttonActive : colors.border,
          },
        ]}
      >
        <Text
          size="sm"
          weight={value === null ? 'bold' : 'regular'}
          color={value === null ? colors.buttonActive : colors.text}
        >
          {noneLabel}
        </Text>
      </TouchableOpacity>
      {ratingOptions.map(opt => {
        const selected = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.id}
            onPress={() => {
              lightHaptic();
              setValue(opt.value);
            }}
            activeOpacity={0.7}
            style={[
              styles.ratingCard,
              {
                backgroundColor: selected ? `${colors.buttonActive}15` : colors.buttonInactive,
                borderColor: selected ? colors.buttonActive : colors.border,
              },
            ]}
          >
            <Text
              size="base"
              weight={selected ? 'bold' : 'semibold'}
              color={selected ? colors.buttonActive : colors.text}
            >
              {opt.label}
            </Text>
            {opt.skillLevel && (
              <Text
                size="xs"
                color={selected ? colors.buttonActive : colors.textMuted}
                style={styles.ratingSkillLevel}
              >
                {t(`matchCreation.fields.skillLevelAbbr.${opt.skillLevel}` as TranslationKey)}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </GestureScrollView>
  </View>
);

const EligibilityStep: React.FC<{
  minRating: number | null;
  setMinRating: (v: number | null) => void;
  maxRating: number | null;
  setMaxRating: (v: number | null) => void;
  ratingOptions: { id: string; value: number; label: string; skillLevel: string | null }[];
  capacityInput: string;
  setCapacityInput: (v: string) => void;
  waitlistEnabled: boolean;
  setWaitlistEnabled: (v: boolean) => void;
  points: PointsForm;
  setPoints: (v: PointsForm) => void;
  errors: Record<string, string | undefined>;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({
  minRating,
  setMinRating,
  maxRating,
  setMaxRating,
  ratingOptions,
  capacityInput,
  setCapacityInput,
  waitlistEnabled,
  setWaitlistEnabled,
  points,
  setPoints,
  errors,
  colors,
  t,
}) => (
  <SheetScrollView
    style={styles.stepContainer}
    contentContainerStyle={styles.stepContent}
    showsVerticalScrollIndicator={false}
    keyboardShouldPersistTaps="handled"
  >
    <View style={styles.stepHeader}>
      <Text size="lg" weight="bold" color={colors.text}>
        {t('leagueCreation.eligibilityStepTitle' as TranslationKey)}
      </Text>
      <Text size="sm" color={colors.textMuted}>
        {t('leagueCreation.eligibilityStepDescription' as TranslationKey)}
      </Text>
    </View>

    {ratingOptions.length > 0 ? (
      <>
        <RatingTierRow
          label={t('leagueCreation.fields.minRating' as TranslationKey)}
          noneLabel={t('leagueCreation.fields.minRatingNone' as TranslationKey)}
          value={minRating}
          setValue={setMinRating}
          ratingOptions={ratingOptions}
          colors={colors}
          t={t}
          testID="league-min-rating"
        />
        <RatingTierRow
          label={t('leagueCreation.fields.maxRating' as TranslationKey)}
          noneLabel={t('leagueCreation.fields.maxRatingNone' as TranslationKey)}
          value={maxRating}
          setValue={setMaxRating}
          ratingOptions={ratingOptions}
          colors={colors}
          t={t}
          testID="league-max-rating"
        />
        {errors.ratingRange && (
          <Text size="xs" color={colors.error} style={styles.errorText}>
            {errors.ratingRange}
          </Text>
        )}
        <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
          {t('leagueCreation.fields.ratingGateHint' as TranslationKey)}
        </Text>
      </>
    ) : (
      <Text size="sm" color={colors.textMuted}>
        {t('leagueCreation.fields.ratingGateUnavailable' as TranslationKey)}
      </Text>
    )}

    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('leagueCreation.fields.memberCapacity' as TranslationKey)}
      </FieldLabel>
      <TextInput
        style={[
          styles.textInput,
          {
            backgroundColor: colors.inputBackground,
            borderColor: errors.memberCapacity ? colors.error : colors.inputBorder,
            color: colors.text,
          },
        ]}
        placeholder={t('leagueCreation.fields.memberCapacityPlaceholder' as TranslationKey)}
        placeholderTextColor={colors.textMuted}
        value={capacityInput}
        onChangeText={setCapacityInput}
        keyboardType="number-pad"
        maxLength={4}
        returnKeyType="done"
        testID="league-member-capacity"
      />
      {errors.memberCapacity && (
        <Text size="xs" color={colors.error} style={styles.errorText}>
          {errors.memberCapacity}
        </Text>
      )}
      <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
        {t('leagueCreation.fields.memberCapacityHint' as TranslationKey)}
      </Text>
    </View>

    {capacityInput.trim() !== '' && (
      <View style={styles.fieldGroup}>
        <OptionCard
          icon="list-outline"
          title={t('leagueCreation.fields.waitlistTitle' as TranslationKey)}
          description={t('leagueCreation.fields.waitlistDescription' as TranslationKey)}
          selected={waitlistEnabled}
          onPress={() => setWaitlistEnabled(!waitlistEnabled)}
          colors={colors}
        />
      </View>
    )}

    {/* Points system. Seasons snapshot these at creation, so an edit here only
        reaches seasons created afterwards. */}
    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('leagueCreation.fields.pointsTitle' as TranslationKey)}
      </FieldLabel>
      <View style={styles.pointsRow}>
        {POINT_FIELDS.map(field => (
          <View key={field} style={styles.pointsField}>
            <Text size="xs" color={colors.textMuted}>
              {t(`leagueCreation.fields.points.${field}` as TranslationKey)}
            </Text>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: errors.points ? colors.error : colors.inputBorder,
                  color: colors.text,
                },
              ]}
              value={points[field]}
              onChangeText={v => setPoints({ ...points, [field]: v })}
              keyboardType="number-pad"
              maxLength={3}
              returnKeyType="done"
              testID={`league-points-${field}`}
            />
          </View>
        ))}
      </View>
      {errors.points && (
        <Text size="xs" color={colors.error} style={styles.errorText}>
          {errors.points}
        </Text>
      )}
      <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
        {t('leagueCreation.fields.pointsHint' as TranslationKey)}
      </Text>
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
  const { session } = useAuth();
  const userId = session?.user?.id;
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
  const [logoUrl, setLogoUrl] = useState<string | null>(editLeague?.logoUrl ?? null);
  const [posterUploading, setPosterUploading] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>(editLeague?.visibility ?? 'private');
  const [joinMode, setJoinMode] = useState<JoinMode>(editLeague?.joinMode ?? 'approval');
  const [minRating, setMinRating] = useState<number | null>(editLeague?.minRating ?? null);
  const [maxRating, setMaxRating] = useState<number | null>(editLeague?.maxRating ?? null);
  const [capacityInput, setCapacityInput] = useState(
    editLeague?.memberCapacity != null ? String(editLeague.memberCapacity) : ''
  );
  const [waitlistEnabled, setWaitlistEnabled] = useState(editLeague?.waitlistEnabled ?? false);
  const [points, setPoints] = useState<PointsForm>(() => pointsFromRules(editLeague?.defaultRules));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const { ratingScores } = useRatingScoresForSport(sportKey, selectedSport?.id, userId);
  const ratingOptions = useMemo(
    () =>
      ratingScores.map(r => ({
        id: r.id,
        value: r.value,
        label: r.label,
        skillLevel: r.skillLevel,
      })),
    [ratingScores]
  );

  // Pick + crop only — the upload is deferred to submit (handleSubmit) so an
  // abandoned/cancelled form never orphans an uploaded file. logoUrl holds the
  // local URI until then. Mirrors TournamentCreationWizard's poster flow.
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

  const isSubmitting = isCreating || isUpdating || posterUploading;

  const validateStep = useCallback(
    (step: number): boolean => {
      const next: Record<string, string | undefined> = {};
      if (step === 1) {
        const trimmed = name.trim();
        if (!trimmed) next.name = t('leagueCreation.validation.nameRequired' as TranslationKey);
        else if (trimmed.length > 100)
          next.name = t('leagueCreation.validation.nameTooLong' as TranslationKey);
      }
      if (step === 3 && minRating !== null && maxRating !== null && maxRating < minRating) {
        next.ratingRange = t('leagueCreation.validation.ratingRangeInvalid' as TranslationKey);
      }
      if (step === 3 && capacityInput.trim() !== '') {
        const cap = Number(capacityInput.trim());
        if (!Number.isInteger(cap) || cap < 1) {
          next.memberCapacity = t('leagueCreation.validation.capacityInvalid' as TranslationKey);
        }
      }
      // Mirrors lt_assert_league_rules, so a bad value is caught before the RPC.
      if (
        step === 3 &&
        POINT_FIELDS.some(f => {
          const v = Number(points[f].trim());
          return !Number.isInteger(v) || v < -100 || v > 100;
        })
      ) {
        next.points = t('leagueCreation.validation.pointsInvalid' as TranslationKey);
      }
      setErrors(next);
      return Object.values(next).every(v => !v);
    },
    [name, minRating, maxRating, capacityInput, points, t]
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
    if (!validateStep(3)) {
      setCurrentStep(3);
      return;
    }

    // Upload a freshly-picked cover now (on submit) rather than at selection,
    // so abandoning the form never orphans an uploaded file. logoUrl is a local
    // URI for a new pick, or an existing remote URL (https) when unchanged.
    let resolvedLogoUrl = logoUrl;
    if (logoUrl && !/^https?:\/\//.test(logoUrl)) {
      setPosterUploading(true);
      const { url } = await uploadImage(logoUrl, 'league-logos');
      setPosterUploading(false);
      if (!url) {
        warningHaptic();
        Alert.alert(
          t('leagueCreation.errors.coverUploadFailedTitle' as TranslationKey),
          t('leagueCreation.errors.coverUploadFailed' as TranslationKey)
        );
        return;
      }
      resolvedLogoUrl = url;
    }

    // Empty capacity = no cap. The waitlist flag only means something with a
    // cap, so clearing the cap also clears the flag.
    const memberCapacity = capacityInput.trim() === '' ? null : Number(capacityInput.trim());
    const effectiveWaitlist = memberCapacity === null ? false : waitlistEnabled;

    // Only the point values that actually moved travel: league_update merges
    // default_rules server-side, so an untouched key keeps whatever it had.
    const baseline = pointsFromRules(editLeague?.defaultRules);
    const changedPoints: Record<string, number> = {};
    for (const field of POINT_FIELDS) {
      if (points[field].trim() !== baseline[field]) {
        changedPoints[field] = Number(points[field].trim());
      }
    }
    const hasPointChanges = Object.keys(changedPoints).length > 0;

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
        if (minRating !== (editLeague.minRating ?? null)) patch.minRating = minRating;
        if (maxRating !== (editLeague.maxRating ?? null)) patch.maxRating = maxRating;
        if (resolvedLogoUrl !== (editLeague.logoUrl ?? null)) patch.logoUrl = resolvedLogoUrl;
        if (memberCapacity !== (editLeague.memberCapacity ?? null))
          patch.memberCapacity = memberCapacity;
        if (effectiveWaitlist !== (editLeague.waitlistEnabled ?? false))
          patch.waitlistEnabled = effectiveWaitlist;
        if (hasPointChanges) patch.defaultRules = changedPoints;

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
        // Only after the update commits: clean up the previous cover file when
        // it was replaced or removed, so the bucket doesn't accumulate orphans.
        const oldLogo = editLeague.logoUrl;
        if (oldLogo && oldLogo !== resolvedLogoUrl && oldLogo.startsWith('http')) {
          void deleteImage(oldLogo, 'league-logos');
        }
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
        minRating: minRating ?? undefined,
        maxRating: maxRating ?? undefined,
        logoUrl: resolvedLogoUrl ?? undefined,
        rulesOverride: hasPointChanges ? changedPoints : undefined,
      });
      // league_create has no capacity params; apply them with a follow-up
      // patch. If this second call fails the league still exists (the update
      // hook toasts), so we proceed to success either way.
      if (memberCapacity !== null || effectiveWaitlist) {
        try {
          await updateLeagueAsync({
            leagueId: league.id,
            versionWas: league.version,
            patch: { memberCapacity, waitlistEnabled: effectiveWaitlist },
          });
        } catch {
          // toast handled in hook
        }
      }
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
    logoUrl,
    maxRating,
    minRating,
    capacityInput,
    waitlistEnabled,
    name,
    onClose,
    onSuccess,
    selectedSport,
    t,
    updateLeagueAsync,
    validateStep,
    visibility,
  ]);

  const handleCreateAnother = useCallback(() => {
    setName('');
    setDescription('');
    setLogoUrl(null);
    setVisibility('private');
    setJoinMode('approval');
    setMinRating(null);
    setMaxRating(null);
    setCapacityInput('');
    setWaitlistEnabled(false);
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
            logoUrl={logoUrl}
            posterUploading={posterUploading}
            onPickPoster={handlePickPoster}
            onRemovePoster={handleRemovePoster}
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
        {currentStep === 3 && (
          <EligibilityStep
            minRating={minRating}
            setMinRating={setMinRating}
            maxRating={maxRating}
            setMaxRating={setMaxRating}
            ratingOptions={ratingOptions}
            capacityInput={capacityInput}
            setCapacityInput={setCapacityInput}
            waitlistEnabled={waitlistEnabled}
            setWaitlistEnabled={setWaitlistEnabled}
            points={points}
            setPoints={setPoints}
            errors={errors}
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
  fieldHint: {
    marginTop: spacingPixels[2],
  },
  pointsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  pointsField: {
    flex: 1,
    gap: spacingPixels[1],
  },
  ratingScrollContent: {
    gap: spacingPixels[2],
    paddingRight: spacingPixels[2],
  },
  ratingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    minWidth: 60,
  },
  ratingSkillLevel: {
    marginTop: spacingPixels[0.5],
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
