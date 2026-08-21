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
import {
  Text,
  useToast,
  WizardHeader,
  WizardProgressBar,
  WizardFooter,
  WizardOptionCard as OptionCard,
  WizardFieldLabel as FieldLabel,
  WizardRatingBoundPicker,
  type WizardRatingOption,
} from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getLeagueLogoUrl,
  parseScore,
  matchPoints,
  type RankingRules,
} from '@rallia/shared-utils';
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

/** Progress-bar captions, in step order. */
const STEP_NAME_KEYS = [
  'leagueCreation.stepNames.details',
  'leagueCreation.stepNames.visibility',
  'leagueCreation.stepNames.eligibility',
] as TranslationKey[];

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
 * The base of the formula: what a result is worth on its own. The rules jsonb
 * holds six more (draw, no-show, retirement and walkover variants); those keep
 * the sport defaults until someone asks for them.
 */
const POINT_FIELDS = ['pointWin', 'pointLoss', 'pointBye'] as const;

/**
 * The optional half: points per set and per game actually won, added on top of
 * the result. 0 is off, which is how every league starts.
 */
const BONUS_FIELDS = ['pointPerSetWon', 'pointPerGameWon'] as const;

const ALL_POINT_FIELDS = [...POINT_FIELDS, ...BONUS_FIELDS] as const;
type PointField = (typeof ALL_POINT_FIELDS)[number];
type PointsForm = Record<PointField, string>;

const BONUS_ICON: Record<(typeof BONUS_FIELDS)[number], keyof typeof Ionicons.glyphMap> = {
  pointPerSetWon: 'layers-outline',
  pointPerGameWon: 'grid-outline',
};

/** Mirrors lt_league_default_rules, which seeds these at league_create. */
const DEFAULT_POINTS: PointsForm = {
  pointWin: '10',
  pointLoss: '1',
  pointBye: '1',
  pointPerSetWon: '0',
  pointPerGameWon: '0',
};

type BonusField = (typeof BONUS_FIELDS)[number];
type BonusToggles = Record<BonusField, boolean>;

/** The seed a bonus takes when switched on, so the toggle means something. */
const BONUS_SEED: Record<BonusField, string> = {
  pointPerSetWon: '3',
  pointPerGameWon: '1',
};

/**
 * Which bonuses a saved formula has on. A bonus is on when it pays something;
 * the toggle then lives in its own state, so clearing the field to retype a
 * value cannot collapse the row while the organizer is still in it.
 */
function togglesFromPoints(points: PointsForm): BonusToggles {
  return {
    pointPerSetWon: Number(points.pointPerSetWon.trim()) > 0,
    pointPerGameWon: Number(points.pointPerGameWon.trim()) > 0,
  };
}

/**
 * How this league's sessions are scheduled. Fixed is an evening at a set time;
 * flex is a window members arrange their own games inside, which can span days.
 * Stored in default_rules, so it seeds every season created afterwards.
 */
const SCHEDULING_MODES = ['fixed', 'flex'] as const;
type SchedulingMode = (typeof SCHEDULING_MODES)[number];

const SCHEDULING_ICON: Record<SchedulingMode, keyof typeof Ionicons.glyphMap> = {
  fixed: 'calendar-outline',
  flex: 'infinite-outline',
};

function schedulingFromRules(rules: Record<string, unknown> | null | undefined): SchedulingMode {
  return rules?.sessionScheduling === 'flex' ? 'flex' : 'fixed';
}

/** The score the worked example runs on: a routine straight-sets win. */
const EXAMPLE_SCORE = '6-4 6-2';

/**
 * What the current formula pays for one EXAMPLE_SCORE, both sides. Computed
 * through the same reference implementation the SQL recalc mirrors, so the
 * preview cannot drift from the standings. Null while any field is mid-edit.
 */
function formulaExample(points: PointsForm): { win: number; loss: number } | null {
  const read = (k: PointField): number => Number(points[k].trim());
  if (ALL_POINT_FIELDS.some(k => points[k].trim() === '' || !Number.isFinite(read(k)))) return null;
  // Only the `completed` branch is exercised, so the outcome variants this
  // form does not expose can be anything.
  const rules: RankingRules = {
    pointWin: read('pointWin'),
    pointLoss: read('pointLoss'),
    pointBye: read('pointBye'),
    pointDraw: 0,
    pointNoShow: 0,
    pointRetirementWinner: 0,
    pointRetirementLoser: 0,
    pointWalkoverWinner: 0,
    pointWalkoverLoser: 0,
    pointPerSetWon: read('pointPerSetWon'),
    pointPerGameWon: read('pointPerGameWon'),
  };
  const { aSets, bSets, aGames, bGames } = parseScore(EXAMPLE_SCORE);
  return {
    win: matchPoints(rules, 'completed', true, { sets: aSets, games: aGames }),
    loss: matchPoints(rules, 'completed', false, { sets: bSets, games: bGames }),
  };
}

/**
 * The walkover/retirement variants the form does NOT show, with their seeded
 * defaults. They track win/loss: the server refuses any rules where a forfeit
 * pays more than the played result it shadows, so an edit to win or loss must
 * carry them along (cascade when they were tracking, clamp when they'd exceed).
 */
const VARIANT_SEEDS = {
  pointRetirementWinner: 10,
  pointWalkoverWinner: 10,
  pointRetirementLoser: 1,
  pointWalkoverLoser: 0,
} as const;
type VariantKey = keyof typeof VARIANT_SEEDS;

const WIN_VARIANTS: VariantKey[] = ['pointRetirementWinner', 'pointWalkoverWinner'];
const LOSS_VARIANTS: VariantKey[] = ['pointRetirementLoser', 'pointWalkoverLoser'];

function pointsFromRules(rules: Record<string, unknown> | null | undefined): PointsForm {
  if (!rules) return { ...DEFAULT_POINTS };
  const read = (k: PointField): string =>
    typeof rules[k] === 'number' ? String(rules[k]) : DEFAULT_POINTS[k];
  return {
    pointWin: read('pointWin'),
    pointLoss: read('pointLoss'),
    pointBye: read('pointBye'),
    pointPerSetWon: read('pointPerSetWon'),
    pointPerGameWon: read('pointPerGameWon'),
  };
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

const EligibilityStep: React.FC<{
  minRating: number | null;
  setMinRating: (v: number | null) => void;
  maxRating: number | null;
  setMaxRating: (v: number | null) => void;
  ratingOptions: WizardRatingOption[];
  capacityInput: string;
  setCapacityInput: (v: string) => void;
  waitlistEnabled: boolean;
  setWaitlistEnabled: (v: boolean) => void;
  scheduling: SchedulingMode;
  setScheduling: (v: SchedulingMode) => void;
  points: PointsForm;
  setPoints: (v: PointsForm) => void;
  bonusOn: BonusToggles;
  onToggleBonus: (field: BonusField) => void;
  /** What the current formula pays for EXAMPLE_SCORE; null while mid-edit. */
  example: { win: number; loss: number } | null;
  errors: Record<string, string | undefined>;
  colors: ThemeColors;
  t: (k: TranslationKey, options?: Record<string, string | number | boolean>) => string;
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
  scheduling,
  setScheduling,
  points,
  setPoints,
  bonusOn,
  onToggleBonus,
  example,
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
        <WizardRatingBoundPicker
          label={t('leagueCreation.fields.minRating' as TranslationKey)}
          noneLabel={t('leagueCreation.fields.minRatingNone' as TranslationKey)}
          value={minRating}
          onChange={setMinRating}
          options={ratingOptions}
          colors={colors}
          testID="league-min-rating"
        />
        <WizardRatingBoundPicker
          label={t('leagueCreation.fields.maxRating' as TranslationKey)}
          noneLabel={t('leagueCreation.fields.maxRatingNone' as TranslationKey)}
          value={maxRating}
          onChange={setMaxRating}
          options={ratingOptions}
          colors={colors}
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

    {/* How sessions are scheduled. Drives the session form: a fixed league asks
        for an evening, a flex one asks for a window. */}
    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('leagueCreation.fields.schedulingTitle' as TranslationKey)}
      </FieldLabel>
      {SCHEDULING_MODES.map(mode => (
        <OptionCard
          key={mode}
          icon={SCHEDULING_ICON[mode]}
          title={t(`leagueCreation.fields.scheduling.${mode}.title` as TranslationKey)}
          description={t(`leagueCreation.fields.scheduling.${mode}.description` as TranslationKey)}
          selected={scheduling === mode}
          onPress={() => setScheduling(mode)}
          colors={colors}
          testID={`league-scheduling-${mode}`}
        />
      ))}
    </View>

    {/* The scoring formula: a base on the result, plus optional bonuses per set
        and per game won. Seasons snapshot these at creation, so an edit here
        only reaches seasons created afterwards. */}
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

    {/* The bonuses. Off by default: most leagues score the result alone. */}
    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('leagueCreation.fields.bonusTitle' as TranslationKey)}
      </FieldLabel>
      {BONUS_FIELDS.map(field => {
        const on = bonusOn[field];
        return (
          <View key={field} style={styles.bonusGroup}>
            <OptionCard
              icon={BONUS_ICON[field]}
              title={t(`leagueCreation.fields.bonus.${field}.title` as TranslationKey)}
              description={t(`leagueCreation.fields.bonus.${field}.description` as TranslationKey)}
              selected={on}
              onPress={() => onToggleBonus(field)}
              colors={colors}
              testID={`league-bonus-${field}`}
            />
            {on && (
              <View style={styles.bonusField}>
                <Text size="xs" color={colors.textMuted}>
                  {t(`leagueCreation.fields.bonus.${field}.label` as TranslationKey)}
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    styles.bonusInput,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: errors.bonuses ? colors.error : colors.inputBorder,
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
            )}
          </View>
        );
      })}
      {errors.bonuses && (
        <Text size="xs" color={colors.error} style={styles.errorText}>
          {errors.bonuses}
        </Text>
      )}
      {example && (
        <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
          {t('leagueCreation.fields.formulaExample' as TranslationKey, {
            score: EXAMPLE_SCORE,
            win: String(example.win),
            loss: String(example.loss),
          })}
        </Text>
      )}
      <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
        {t('leagueCreation.fields.formulaForwardHint' as TranslationKey)}
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
  const [scheduling, setScheduling] = useState<SchedulingMode>(() =>
    schedulingFromRules(editLeague?.defaultRules)
  );
  const [bonusOn, setBonusOn] = useState<BonusToggles>(() =>
    togglesFromPoints(pointsFromRules(editLeague?.defaultRules))
  );
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
        skillLabel: r.skillLevel
          ? t(`matchCreation.fields.skillLevelAbbr.${r.skillLevel}` as TranslationKey)
          : null,
      })),
    [ratingScores, t]
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
      // The bonuses multiply a count of things won, so the server refuses a
      // negative one. Same rule here, in the organizer's words.
      if (
        step === 3 &&
        BONUS_FIELDS.some(f => {
          const v = Number(points[f].trim());
          return !Number.isInteger(v) || v < 0 || v > 100;
        })
      ) {
        next.bonuses = t('leagueCreation.validation.bonusInvalid' as TranslationKey);
      }
      setErrors(next);
      return Object.values(next).every(v => !v);
    },
    [name, minRating, maxRating, capacityInput, points, t]
  );

  // Switching a bonus off parks its value at 0, which is what "off" means to
  // the recalc. Switching on seeds a value only when there is nothing to
  // restore, so a bonus toggled off and back on keeps what it had.
  const handleToggleBonus = useCallback(
    (field: BonusField) => {
      lightHaptic();
      const next = !bonusOn[field];
      const current = points[field].trim();
      setBonusOn({ ...bonusOn, [field]: next });
      setPoints({
        ...points,
        [field]: next ? (Number(current) > 0 ? points[field] : BONUS_SEED[field]) : '0',
      });
    },
    [bonusOn, points]
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
    for (const field of ALL_POINT_FIELDS) {
      if (points[field].trim() !== baseline[field]) {
        changedPoints[field] = Number(points[field].trim());
      }
    }

    // Carry the hidden walkover/retirement variants along with win/loss: a
    // variant that was tracking the old value follows the new one, and one that
    // would now exceed it is clamped, so a lowered win can never make a forfeit
    // the better outcome (the server refuses exactly that).
    const readVariant = (k: VariantKey): number => {
      const v = editLeague?.defaultRules?.[k];
      return typeof v === 'number' ? v : VARIANT_SEEDS[k];
    };
    const cascadeVariants = (baseKey: 'pointWin' | 'pointLoss', variants: VariantKey[]) => {
      if (!(baseKey in changedPoints)) return;
      const oldBase = Number(baseline[baseKey]);
      const newBase = changedPoints[baseKey];
      for (const k of variants) {
        const current = readVariant(k);
        if (current === oldBase || current > newBase) changedPoints[k] = newBase;
      }
    };
    cascadeVariants('pointWin', WIN_VARIANTS);
    cascadeVariants('pointLoss', LOSS_VARIANTS);

    // One rules patch: league_update merges default_rules, so the points and
    // the scheduling mode travel together and neither clobbers the other.
    const changedRules: Record<string, unknown> = { ...changedPoints };
    if (scheduling !== schedulingFromRules(editLeague?.defaultRules)) {
      changedRules.sessionScheduling = scheduling;
    }
    const hasRuleChanges = Object.keys(changedRules).length > 0;

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
        if (hasRuleChanges) patch.defaultRules = changedRules;

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
        rulesOverride: hasRuleChanges ? changedRules : undefined,
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
      {/* Edit opens straight into the form, so step 1 has no landing to go back to. */}
      <WizardHeader
        showBack={!(isEditMode && currentStep === 1)}
        onBack={currentStep === 1 ? onBackToLanding : goBack}
        onClose={handleClose}
        badgeIcon={<SportIcon sportName={sportKey} size={14} color={BASE_WHITE} />}
        badgeLabel={sportName}
        colors={colors}
        backAccessibilityLabel={t('common.back' as TranslationKey)}
        closeAccessibilityLabel={t('common.close' as TranslationKey)}
      />
      <WizardProgressBar
        currentStep={currentStep}
        totalSteps={TOTAL_STEPS}
        counterLabel={t('leagueCreation.step' as TranslationKey)
          .replace('{current}', String(currentStep))
          .replace('{total}', String(TOTAL_STEPS))}
        stepLabel={t(STEP_NAME_KEYS[currentStep - 1])}
        colors={colors}
      />

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
            scheduling={scheduling}
            setScheduling={setScheduling}
            points={points}
            setPoints={setPoints}
            bonusOn={bonusOn}
            onToggleBonus={handleToggleBonus}
            example={formulaExample(points)}
            errors={errors}
            colors={colors}
            t={t}
          />
        )}
      </View>

      <WizardFooter
        label={
          currentStep === TOTAL_STEPS
            ? isEditMode
              ? isUpdating
                ? t('leagueDetail.editModal.saving' as TranslationKey)
                : t('leagueDetail.editModal.save' as TranslationKey)
              : isCreating
                ? t('leagueCreation.creating' as TranslationKey)
                : t('leagueCreation.createLeague' as TranslationKey)
            : t('leagueCreation.next' as TranslationKey)
        }
        onPress={currentStep === TOTAL_STEPS ? handleSubmit : goNext}
        disabled={isSubmitting}
        trailingIcon={currentStep === TOTAL_STEPS ? 'none' : 'arrow'}
        colors={colors}
        testID="league-wizard-submit"
      />
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
  bonusGroup: {
    marginBottom: spacingPixels[2],
  },
  bonusField: {
    gap: spacingPixels[1],
    marginTop: spacingPixels[2],
  },
  bonusInput: {
    alignSelf: 'flex-start',
    minWidth: 96,
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
