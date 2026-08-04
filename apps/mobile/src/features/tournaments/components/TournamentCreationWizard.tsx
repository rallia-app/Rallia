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
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
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
  status,
} from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getTournamentLogoUrl,
  quoteRegistration,
  formatPrice,
} from '@rallia/shared-utils';
import {
  useTheme,
  useCreateTournament,
  useUpdateTournament,
  useRatingScoresForSport,
  useFacilitySearch,
  useAdminStatus,
  useMyServiceFeeParams,
} from '@rallia/shared-hooks';
import type { Enums } from '@rallia/shared-types';
import type { TournamentUpdatePatch } from '@rallia/shared-services';

import { useTranslation, type TranslationKey } from '../../../hooks';
import { pickImageWithCropper } from '../../../utils/imagePicker';
import { uploadImage, deleteImage } from '../../../services/imageUpload';
import { useSport, useAuth, useUserHomeLocation } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';
import { SearchBar } from '../../../components/SearchBar';
import * as Analytics from '../../../services/analytics';

const BASE_WHITE = '#ffffff';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOTAL_STEPS = 4;
const BRACKET_SIZES = [4, 8, 16, 32, 64] as const;
type BracketSize = (typeof BRACKET_SIZES)[number];

function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function todayAtLocalMidnight(): Date {
  return startOfLocalDay(new Date());
}

/** Avoid iOS clamping to one day when max precedes min (timezone drift on ISO dates). */
function coerceDateRange(
  minimumDate?: Date,
  maximumDate?: Date
): { minimumDate?: Date; maximumDate?: Date } {
  const min = minimumDate ? startOfLocalDay(minimumDate) : undefined;
  const max = maximumDate ? startOfLocalDay(maximumDate) : undefined;
  if (min && max && max < min) {
    return { minimumDate: min, maximumDate: undefined };
  }
  return { minimumDate: min, maximumDate: max };
}

type Visibility = Exclude<Enums<'tournament_visibility'>, 'community'>; // V1: private/public only
type RegistrationMode = Enums<'tournament_registration_mode'>;
type MatchFormat = Enums<'match_format'>;
type EntryFormat = Enums<'entry_format'>;
type FeePayer = Enums<'fee_payer_enum'>;
type RefundKind = Enums<'refund_policy_kind_enum'>;

const FEE_CURRENCY = 'CAD';

/** Dollar string → integer cents (clamped ≥ 0). '' / garbage → 0 (free). */
const dollarsToCents = (v: string): number =>
  Math.max(0, Math.round((Number(v.replace(',', '.')) || 0) * 100));

const ENTRY_FORMATS: readonly EntryFormat[] = ['singles', 'doubles', 'mixed_doubles'];
const ENTRY_FORMAT_KEYS: Record<EntryFormat, string> = {
  singles: 'tournamentDetail.values.singles',
  doubles: 'tournamentDetail.values.doubles',
  mixed_doubles: 'tournamentDetail.values.mixedDoubles',
};

// Both sports count the same way now: how many games/sets win the match. How
// many POINTS take one pickleball game is the separate axis below, which is
// what makes "2 de 3 a 11" expressible at all.
const MATCH_FORMATS: readonly MatchFormat[] = ['one_set', 'two_of_three', 'three_of_five'];
const POINTS_PER_GAME_OPTIONS = [11, 15, 21] as const;
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
  // Legacy fused labels. Postgres cannot drop an enum value, so an older
  // tournament can still arrive carrying one; it is never offered.
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

/** Pickleball counts games, tennis counts sets; the arithmetic is identical. */
const MATCH_FORMAT_GAME_KEYS: Record<MatchFormat, string> = {
  one_set: 'tournamentCreation.fields.matchFormatOneGame',
  two_of_three: 'tournamentCreation.fields.matchFormatTwoOfThreeGames',
  three_of_five: 'tournamentCreation.fields.matchFormatThreeOfFiveGames',
  pickleball_to_11: 'tournamentCreation.fields.matchFormatTwoOfThreeGames',
  pickleball_to_15: 'tournamentCreation.fields.matchFormatTwoOfThreeGames',
  pickleball_to_21: 'tournamentCreation.fields.matchFormatTwoOfThreeGames',
};

/**
 * A tournament written before the axes were split carries its target inside the
 * format. Read it back so editing one does not silently retarget it.
 */
const LEGACY_FUSED_POINTS: Partial<Record<MatchFormat, number>> = {
  pickleball_to_11: 11,
  pickleball_to_15: 15,
  pickleball_to_21: 21,
};

const STEP_ANALYTICS_NAMES = ['basics', 'format', 'rules_visibility', 'payments'] as const;

/** Best-of-3 is the default for both sports: 2 sets in tennis, 2 games to 11. */
const DEFAULT_MATCH_FORMAT: MatchFormat = 'two_of_three';
const DEFAULT_POINTS_PER_GAME = 11;

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
  minRating: number | null;
  maxRating: number | null;
  visibility: Enums<'tournament_visibility'>;
  startDate: string; // ISO
  endDate: string; // ISO
  maxParticipants: number;
  matchFormat: MatchFormat;
  /** Pickleball only; null on tennis and on rows written before the split. */
  pointsPerGame: number | null;
  sport: { id: string; name: string; display_name: string };
  // Location (facility OR city) + advertised prize.
  facilityId: string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  prizeMoneyCents: number | null;
  // Fee settings (editable only while draft).
  entryFeeCents: number;
  currency: string;
  feePayer: FeePayer;
  refundPolicyKind: RefundKind;
  refundPartialBps: number | null;
  refundCutoffAt: string | null;
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
  const progress = useSharedValue((currentStep / TOTAL_STEPS) * 100);
  const stepNames = [
    t('tournamentCreation.stepNames.basics' as TranslationKey),
    t('tournamentCreation.stepNames.format' as TranslationKey),
    t('tournamentCreation.stepNames.rulesVisibility' as TranslationKey),
    t('tournamentCreation.stepNames.payments' as TranslationKey),
  ];

  useEffect(() => {
    progress.value = withTiming((currentStep / TOTAL_STEPS) * 100, { duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const animatedProgressStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

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
        <Animated.View
          style={[
            styles.progressBarFill,
            { backgroundColor: colors.progressActive },
            animatedProgressStyle,
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
  testID?: string;
}

const OptionCard: React.FC<OptionCardProps> = ({
  icon,
  title,
  description,
  selected,
  onPress,
  colors,
  compact = false,
  testID,
}) => (
  <TouchableOpacity
    testID={testID}
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
  hint?: string;
  nested?: boolean;
  compact?: boolean;
  colors: ThemeColors;
  locale: string;
  testID?: string;
}> = ({
  label,
  date,
  onPress,
  placeholder,
  error,
  hint,
  nested,
  compact,
  colors,
  locale,
  testID,
}) => {
  const formatted = date
    ? date.toLocaleDateString(
        locale,
        compact
          ? { month: 'short', day: 'numeric', year: '2-digit' }
          : { year: 'numeric', month: 'short', day: 'numeric' }
      )
    : placeholder;
  const containerStyle = compact
    ? styles.dateRowField
    : nested
      ? styles.fieldSubGroup
      : styles.fieldGroup;
  return (
    <View style={containerStyle}>
      <FieldLabel colors={colors}>{label}</FieldLabel>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={[
          styles.dateButton,
          compact && styles.dateButtonCompact,
          {
            backgroundColor: colors.inputBackground,
            borderColor: error ? colors.error : colors.inputBorder,
          },
        ]}
        accessibilityRole="button"
        testID={testID}
      >
        <Text
          size={compact ? 'sm' : 'base'}
          color={date ? colors.text : colors.textMuted}
          numberOfLines={1}
        >
          {formatted}
        </Text>
        <Ionicons name="calendar-outline" size={compact ? 18 : 20} color={colors.textMuted} />
      </TouchableOpacity>
      {hint && (
        <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
          {hint}
        </Text>
      )}
      {error && (
        <Text size="xs" color={colors.error} style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
};

const TournamentDatePickerSheet: React.FC<{
  visible: boolean;
  value: Date;
  onChangeValue: (date: Date) => void;
  onCommit: (date: Date) => void;
  onDismiss: () => void;
  minimumDate?: Date;
  maximumDate?: Date;
  isDark: boolean;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
  doneTestID?: string;
}> = ({
  visible,
  value,
  onChangeValue,
  onCommit,
  onDismiss,
  minimumDate,
  maximumDate,
  isDark,
  colors,
  t,
  doneTestID,
}) => {
  const range = coerceDateRange(minimumDate, maximumDate);

  const handleChange = useCallback(
    (_event: unknown, selected?: Date) => {
      if (Platform.OS === 'android') {
        onDismiss();
        if (selected) onCommit(startOfLocalDay(selected));
        return;
      }
      if (selected) onChangeValue(startOfLocalDay(selected));
    },
    [onChangeValue, onCommit, onDismiss]
  );

  if (Platform.OS === 'ios') {
    return (
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: colors.cardBackground }]}>
            {visible && (
              <DateTimePicker
                value={value}
                mode="date"
                display="spinner"
                minimumDate={range.minimumDate}
                maximumDate={range.maximumDate}
                onChange={handleChange}
                themeVariant={isDark ? 'dark' : 'light'}
              />
            )}
            <TouchableOpacity
              onPress={() => {
                onCommit(value);
                onDismiss();
              }}
              style={[styles.modalDoneButton, { backgroundColor: colors.buttonActive }]}
              accessibilityRole="button"
              testID={doneTestID}
            >
              <Text size="base" weight="semibold" color={colors.buttonTextActive}>
                {t('common.done' as TranslationKey)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  if (!visible) return null;

  return (
    <DateTimePicker
      value={value}
      mode="date"
      display="default"
      minimumDate={range.minimumDate}
      maximumDate={range.maximumDate}
      onChange={handleChange}
    />
  );
};

/** A facility picked as the tournament's exact venue (denormalized on save). */
type SelectedFacility = { id: string; name: string; address: string | null; city: string | null };

type LocationMode = 'facility' | 'city';

/**
 * Location capture for step 1 (Basics). The organizer gives EITHER an exact
 * venue (pick a real facility — reuses the shared facility search) OR just a
 * city. On save the facility's name/address/city are denormalized onto the
 * tournament so display stays join-free (card/detail label = venue_name ?? city).
 */
const LocationSection: React.FC<{
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
  /** Sport scopes the facility search; coords come from the user's home. */
  sportId: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  playerId: string | undefined;
  mode: LocationMode;
  setMode: (m: LocationMode) => void;
  selectedFacility: SelectedFacility | null;
  onSelectFacility: (f: SelectedFacility) => void;
  onClearFacility: () => void;
  cityInput: string;
  setCityInput: (v: string) => void;
  error?: string;
}> = ({
  colors,
  t,
  sportId,
  latitude,
  longitude,
  playerId,
  mode,
  setMode,
  selectedFacility,
  onSelectFacility,
  onClearFacility,
  cityInput,
  setCityInput,
  error,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    setSearchQuery('');
  }, [mode]);
  const { facilities, isLoading } = useFacilitySearch({
    sportIds: sportId ? [sportId] : undefined,
    latitude,
    longitude,
    searchQuery,
    playerId,
    pageSize: 20,
    enabled: mode === 'facility' && !selectedFacility,
  });

  const modeButton = (m: LocationMode, label: string, icon: keyof typeof Ionicons.glyphMap) => {
    const active = mode === m;
    return (
      <TouchableOpacity
        key={m}
        onPress={() => {
          lightHaptic();
          setMode(m);
        }}
        activeOpacity={0.7}
        style={[
          styles.locationModeChip,
          {
            backgroundColor: active ? `${colors.buttonActive}15` : colors.buttonInactive,
            borderColor: active ? colors.buttonActive : colors.border,
          },
        ]}
      >
        <Ionicons name={icon} size={16} color={active ? colors.buttonActive : colors.textMuted} />
        <Text
          size="sm"
          weight={active ? 'semibold' : 'regular'}
          color={active ? colors.buttonActive : colors.text}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('tournamentCreation.fields.location' as TranslationKey)}
      </FieldLabel>
      <View style={styles.locationModeRow}>
        {modeButton(
          'facility',
          t('tournamentCreation.fields.locationExact' as TranslationKey),
          'business-outline'
        )}
        {modeButton(
          'city',
          t('tournamentCreation.fields.locationCity' as TranslationKey),
          'map-outline'
        )}
      </View>

      {mode === 'facility' ? (
        selectedFacility ? (
          <View
            style={[
              styles.selectedFacilityCard,
              { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
            ]}
          >
            <View style={styles.selectedFacilityInfo}>
              <Text size="sm" weight="semibold" color={colors.text} numberOfLines={1}>
                {selectedFacility.name}
              </Text>
              {(selectedFacility.address || selectedFacility.city) && (
                <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                  {[selectedFacility.address, selectedFacility.city].filter(Boolean).join(', ')}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => {
                lightHaptic();
                onClearFacility();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close' as TranslationKey)}
            >
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <SearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('tournamentCreation.fields.facilityPlaceholder' as TranslationKey)}
              colors={colors}
            />
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.buttonActive} />
              </View>
            ) : facilities.length > 0 ? (
              <View style={styles.facilityResults}>
                {facilities.slice(0, 8).map(f => (
                  <TouchableOpacity
                    key={f.id}
                    onPress={() => {
                      lightHaptic();
                      onSelectFacility({
                        id: f.id,
                        name: f.name,
                        address: f.address ?? null,
                        city: f.city ?? null,
                      });
                    }}
                    activeOpacity={0.7}
                    style={[styles.facilityResultRow, { borderColor: colors.inputBorder }]}
                  >
                    <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                    <View style={styles.facilityResultInfo}>
                      <Text size="sm" weight="medium" color={colors.text} numberOfLines={1}>
                        {f.name}
                      </Text>
                      {(f.address || f.city) && (
                        <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                          {[f.address, f.city].filter(Boolean).join(', ')}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
                {t('tournamentCreation.fields.facilityEmpty' as TranslationKey)}
              </Text>
            )}
          </>
        )
      ) : (
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: error ? colors.error : colors.inputBorder,
              color: colors.text,
            },
          ]}
          placeholder={t('tournamentCreation.fields.cityPlaceholder' as TranslationKey)}
          placeholderTextColor={colors.textMuted}
          value={cityInput}
          onChangeText={setCityInput}
          maxLength={80}
          autoCapitalize="words"
          testID="tournament-city-input"
        />
      )}

      <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
        {t('tournamentCreation.fields.locationHint' as TranslationKey)}
      </Text>
      {error && (
        <Text size="xs" color={colors.error} style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
};

type RatingOption = {
  value: number;
  label: string;
  skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'professional' | null;
  id: string;
};

/** One bound of the rating band: the sport's tiers plus a "no bound" card. */
const RatingBoundPicker: React.FC<{
  label: string;
  noneLabel: string;
  hint: string;
  value: number | null;
  onChange: (v: number | null) => void;
  options: RatingOption[];
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({ label, noneLabel, hint, value, onChange, options, colors, t }) => (
  <View style={styles.fieldGroup}>
    <FieldLabel colors={colors}>{label}</FieldLabel>
    <GestureScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.ratingScrollContent}
      nestedScrollEnabled
    >
      <TouchableOpacity
        onPress={() => {
          lightHaptic();
          onChange(null);
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
      {options.map(opt => {
        const selected = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.id}
            onPress={() => {
              lightHaptic();
              onChange(opt.value);
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
    <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
      {hint}
    </Text>
  </View>
);

const DetailsStep: React.FC<{
  /** Which form step to render: 1 Basics, 2 Format. */
  step: number;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  /** Rating band bounds (both inclusive, both optional); ratingOptions are the sport's tiers. */
  minRating: number | null;
  setMinRating: (v: number | null) => void;
  maxRating: number | null;
  setMaxRating: (v: number | null) => void;
  ratingOptions: {
    value: number;
    label: string;
    skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'professional' | null;
    id: string;
  }[];
  /** Location capture, rendered on step 1 only. */
  location: React.ComponentProps<typeof LocationSection>;
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
  /** Pickleball only: the points that take one game. */
  pointsPerGame: number;
  setPointsPerGame: (v: number) => void;
  isPickleball: boolean;
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
  step,
  name,
  setName,
  description,
  setDescription,
  minRating,
  setMinRating,
  maxRating,
  setMaxRating,
  ratingOptions,
  location,
  logoUrl,
  posterUploading,
  onPickPoster,
  onRemovePoster,
  bracketSize,
  setBracketSize,
  matchFormat,
  setMatchFormat,
  formatOptions,
  pointsPerGame,
  setPointsPerGame,
  isPickleball,
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
  const [pickerValue, setPickerValue] = useState<Date>(() => todayAtLocalMidnight());

  const openPicker = useCallback(
    (which: 'start' | 'end') => {
      const today = todayAtLocalMidnight();
      const seed =
        which === 'start'
          ? startDate
            ? startOfLocalDay(startDate)
            : today
          : endDate
            ? startOfLocalDay(endDate)
            : startDate
              ? startOfLocalDay(startDate)
              : today;
      setPickerValue(seed);
      setPickerOpen(which);
    },
    [startDate, endDate]
  );

  const commitDate = useCallback(
    (which: 'start' | 'end', value: Date) => {
      const normalized = startOfLocalDay(value);
      if (which === 'start') setStartDate(normalized);
      else setEndDate(normalized);
    },
    [setStartDate, setEndDate]
  );

  const pickerMinimumDate = useMemo(() => {
    if (pickerOpen === 'end' && startDate) return startOfLocalDay(startDate);
    if (isEditMode) return undefined;
    return todayAtLocalMidnight();
  }, [pickerOpen, startDate, isEditMode]);

  const stepTitle =
    step === 2
      ? t('tournamentCreation.step2Title' as TranslationKey)
      : t('tournamentCreation.step1Title' as TranslationKey);
  const stepDescription =
    step === 2
      ? t('tournamentCreation.step2Description' as TranslationKey)
      : t('tournamentCreation.step1Description' as TranslationKey);

  return (
    <SheetScrollView
      style={styles.stepContainer}
      contentContainerStyle={styles.stepContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.stepHeader}>
        <Text size="lg" weight="bold" color={colors.text}>
          {stepTitle}
        </Text>
        <Text size="sm" color={colors.textMuted}>
          {stepDescription}
        </Text>
      </View>

      {step === 1 && (
        <>
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
            <View style={styles.dateRow}>
              <DateField
                compact
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
                compact
                label={t('tournamentCreation.fields.endDate' as TranslationKey)}
                date={endDate}
                onPress={() => openPicker('end')}
                placeholder={t('tournamentCreation.fields.endDatePlaceholder' as TranslationKey)}
                error={errors.endDate}
                colors={colors}
                locale={locale}
                testID="tournament-end-date"
              />
            </View>
          </View>

          <TournamentDatePickerSheet
            visible={pickerOpen !== null}
            value={pickerValue}
            onChangeValue={setPickerValue}
            onCommit={date => {
              if (pickerOpen) commitDate(pickerOpen, date);
            }}
            onDismiss={() => setPickerOpen(null)}
            minimumDate={pickerMinimumDate}
            isDark={isDark}
            colors={colors}
            t={t}
            doneTestID="tournament-date-done"
          />

          <LocationSection {...location} />
        </>
      )}

      {step === 2 && (
        <>
          {canEditStructure ? (
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
                          {t(
                            (isPickleball
                              ? MATCH_FORMAT_GAME_KEYS[format]
                              : MATCH_FORMAT_KEYS[format].label) as TranslationKey
                          )}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {!isPickleball && (
                  <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
                    {t(MATCH_FORMAT_KEYS[matchFormat].hint as TranslationKey)}
                  </Text>
                )}
              </View>

              {/* The second axis. Picking "to 11" used to pin the event at one
                  game; the two settings are independent now. */}
              {isPickleball && (
                <View style={styles.fieldGroup}>
                  <FieldLabel colors={colors}>
                    {t('tournamentCreation.fields.pointsPerGame' as TranslationKey)}
                  </FieldLabel>
                  <View style={styles.optionsRow}>
                    {POINTS_PER_GAME_OPTIONS.map(points => {
                      const selected = points === pointsPerGame;
                      return (
                        <TouchableOpacity
                          key={points}
                          onPress={() => {
                            lightHaptic();
                            setPointsPerGame(points);
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
                          testID={`points-per-game-${points}`}
                        >
                          <Text
                            size="base"
                            weight={selected ? 'semibold' : 'regular'}
                            color={selected ? colors.buttonActive : colors.text}
                          >
                            {String(points)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text size="xs" color={colors.textMuted} style={styles.fieldHint}>
                    {t('tournamentCreation.fields.pointsPerGameHint' as TranslationKey)}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.fieldGroup}>
              <Text size="xs" color={colors.textMuted}>
                {t('tournamentDetail.editModal.draftOnlyHint' as TranslationKey)}
              </Text>
            </View>
          )}

          {canEditStructure && ratingOptions.length > 0 && (
            <>
              <RatingBoundPicker
                label={t('tournamentCreation.fields.minLevel' as TranslationKey)}
                noneLabel={t('tournamentCreation.fields.minLevelNone' as TranslationKey)}
                hint={t('tournamentCreation.fields.minLevelHint' as TranslationKey)}
                value={minRating}
                // Raising the floor past the ceiling would be an empty band; drop
                // the ceiling rather than refuse the tap.
                onChange={v => {
                  setMinRating(v);
                  if (v !== null && maxRating !== null && maxRating < v) setMaxRating(null);
                }}
                options={ratingOptions}
                colors={colors}
                t={t}
              />
              <RatingBoundPicker
                label={t('tournamentCreation.fields.maxLevel' as TranslationKey)}
                noneLabel={t('tournamentCreation.fields.maxLevelNone' as TranslationKey)}
                hint={t('tournamentCreation.fields.maxLevelHint' as TranslationKey)}
                value={maxRating}
                onChange={setMaxRating}
                options={
                  minRating === null
                    ? ratingOptions
                    : ratingOptions.filter(o => o.value >= minRating)
                }
                colors={colors}
                t={t}
              />
            </>
          )}
        </>
      )}
    </SheetScrollView>
  );
};

const VisibilityStep: React.FC<{
  rules: string;
  setRules: (v: string) => void;
  visibility: Enums<'tournament_visibility'>;
  setVisibility: (v: Visibility) => void;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
}> = ({ rules, setRules, visibility, setVisibility, colors, t }) => (
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
// PAYMENTS STEP (entry fee, who pays the service fee, refunds)
// =============================================================================

const PaymentsStep: React.FC<{
  entryFeeInput: string;
  setEntryFeeInput: (v: string) => void;
  feePayer: FeePayer;
  setFeePayer: (v: FeePayer) => void;
  refundKind: RefundKind;
  setRefundKind: (v: RefundKind) => void;
  refundPctInput: string;
  setRefundPctInput: (v: string) => void;
  refundCutoff: Date | null;
  setRefundCutoff: (d: Date | null) => void;
  prizeMoneyInput: string;
  setPrizeMoneyInput: (v: string) => void;
  startDate: Date | null;
  feeLocked: boolean;
  allowEntryFee: boolean;
  errors: Record<string, string | undefined>;
  colors: ThemeColors;
  t: (k: TranslationKey) => string;
  locale: string;
  isDark: boolean;
  isEditMode: boolean;
}> = ({
  entryFeeInput,
  setEntryFeeInput,
  feePayer,
  setFeePayer,
  refundKind,
  setRefundKind,
  refundPctInput,
  setRefundPctInput,
  refundCutoff,
  setRefundCutoff,
  prizeMoneyInput,
  setPrizeMoneyInput,
  startDate,
  feeLocked,
  allowEntryFee,
  errors,
  colors,
  t,
  locale,
  isDark,
  isEditMode,
}) => {
  const [cutoffPickerOpen, setCutoffPickerOpen] = useState(false);
  const [cutoffPickerValue, setCutoffPickerValue] = useState<Date>(() => todayAtLocalMidnight());

  const openCutoffPicker = useCallback(() => {
    const today = todayAtLocalMidnight();
    const seed = refundCutoff
      ? startOfLocalDay(refundCutoff)
      : startDate
        ? startOfLocalDay(startDate)
        : today;
    setCutoffPickerValue(seed);
    setCutoffPickerOpen(true);
  }, [refundCutoff, startDate]);

  const commitCutoff = useCallback(
    (value: Date) => {
      setRefundCutoff(startOfLocalDay(value));
    },
    [setRefundCutoff]
  );

  const cutoffMinimumDate = isEditMode ? undefined : todayAtLocalMidnight();
  const cutoffMaximumDate = startDate ? startOfLocalDay(startDate) : undefined;

  const entryFeeCents = dollarsToCents(entryFeeInput);
  const isPaid = entryFeeCents > 0;
  // Preview with the server-resolved fee params (admin-tunable default +
  // per-organizer override) instead of the hardcoded TS defaults.
  const { session } = useAuth();
  const { data: feeParams } = useMyServiceFeeParams(session?.user?.id, isPaid);
  const quote = quoteRegistration(entryFeeCents, feePayer, feeParams);
  const fmt = (cents: number) => formatPrice(cents, FEE_CURRENCY, { locale });

  // Prize money is advertising, not a fee obligation, so it renders even when
  // fee controls are locked (registration open+). Shared between both branches.
  const prizeField = (
    <View style={styles.fieldGroup}>
      <FieldLabel colors={colors}>
        {t('tournamentCreation.payments.prizeMoneyLabel' as TranslationKey)}
      </FieldLabel>
      <View
        style={[
          styles.textInput,
          styles.feeInputRow,
          { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
        ]}
      >
        <Text size="base" weight="semibold" color={colors.textMuted}>
          $
        </Text>
        <TextInput
          style={[styles.feeInputField, { color: colors.text }]}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          value={prizeMoneyInput}
          onChangeText={setPrizeMoneyInput}
          keyboardType="decimal-pad"
          maxLength={9}
          testID="tournament-prize-input"
        />
        <Text size="sm" color={colors.textMuted}>
          {FEE_CURRENCY}
        </Text>
      </View>
      <Text size="xs" color={colors.textMuted} style={styles.helperText}>
        {t('tournamentCreation.payments.prizeMoneyHint' as TranslationKey)}
      </Text>
    </View>
  );

  // Fees lock once registration opens — show a read-only summary instead of
  // editable controls that wouldn't persist.
  if (feeLocked) {
    return (
      <SheetScrollView
        style={styles.stepContainer}
        contentContainerStyle={styles.stepContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepHeader}>
          <Text size="lg" weight="bold" color={colors.text}>
            {t('tournamentCreation.payments.stepTitle' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textMuted}>
            {t('tournamentCreation.payments.lockedNote' as TranslationKey)}
          </Text>
        </View>
        <View
          style={[
            styles.previewCard,
            { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
          ]}
          testID="tournament-fee-locked"
        >
          {isPaid ? (
            <>
              <View style={styles.previewRow}>
                <Text size="sm" color={colors.textMuted}>
                  {t('tournamentCreation.payments.entryFeeLabel' as TranslationKey)}
                </Text>
                <Text size="sm" weight="bold" color={colors.text}>
                  {fmt(entryFeeCents)}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text size="sm" color={colors.textMuted}>
                  {t('tournamentCreation.payments.previewPlayersPay' as TranslationKey)}
                </Text>
                <Text size="sm" color={colors.text}>
                  {fmt(quote.totalCents)}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text size="sm" color={colors.textMuted}>
                  {t('tournamentCreation.payments.previewYouReceive' as TranslationKey)}
                </Text>
                <Text size="sm" weight="bold" color={colors.success}>
                  {fmt(quote.organizerReceivesCents)}
                </Text>
              </View>
            </>
          ) : (
            <Text size="sm" color={colors.text}>
              {t('tournamentCreation.payments.freeNote' as TranslationKey)}
            </Text>
          )}
        </View>

        {prizeField}
      </SheetScrollView>
    );
  }

  return (
    <SheetScrollView
      style={styles.stepContainer}
      contentContainerStyle={styles.stepContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.stepHeader}>
        <Text size="lg" weight="bold" color={colors.text}>
          {t('tournamentCreation.payments.stepTitle' as TranslationKey)}
        </Text>
        <Text size="sm" color={colors.textMuted}>
          {allowEntryFee
            ? t('tournamentCreation.payments.stepDescription' as TranslationKey)
            : t('tournamentCreation.payments.stepDescriptionFree' as TranslationKey)}
        </Text>
      </View>

      {/* Entry fee — hidden while paid tournaments are gated off */}
      {allowEntryFee && (
        <View style={styles.fieldGroup}>
          <FieldLabel colors={colors}>
            {t('tournamentCreation.payments.entryFeeLabel' as TranslationKey)}
          </FieldLabel>
          <View
            style={[
              styles.textInput,
              styles.feeInputRow,
              { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
            ]}
          >
            <Text size="base" weight="semibold" color={colors.textMuted}>
              $
            </Text>
            <TextInput
              style={[styles.feeInputField, { color: colors.text }]}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              value={entryFeeInput}
              onChangeText={setEntryFeeInput}
              keyboardType="decimal-pad"
              maxLength={7}
              testID="tournament-entry-fee-input"
            />
            <Text size="sm" color={colors.textMuted}>
              {FEE_CURRENCY}
            </Text>
          </View>
          <Text size="xs" color={colors.textMuted} style={styles.helperText}>
            {isPaid
              ? t('tournamentCreation.payments.entryFeeHintPaid' as TranslationKey)
              : t('tournamentCreation.payments.entryFeeHintFree' as TranslationKey)}
          </Text>
        </View>
      )}

      {prizeField}

      {!isPaid && (
        <View
          style={[
            styles.previewCard,
            { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
          ]}
          testID="tournament-fee-preview-free"
        >
          <Text size="sm" color={colors.text}>
            {t('tournamentCreation.payments.freeNote' as TranslationKey)}
          </Text>
        </View>
      )}

      {isPaid && (
        <>
          {/* Live preview */}
          <View
            style={[
              styles.previewCard,
              { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
            ]}
            testID="tournament-fee-preview"
          >
            <View style={styles.previewRow}>
              <Text size="sm" color={colors.textMuted}>
                {t('tournamentCreation.payments.previewPlayersPay' as TranslationKey)}
              </Text>
              <Text
                size="sm"
                weight="bold"
                color={colors.text}
                testID="tournament-fee-preview-total"
              >
                {fmt(quote.totalCents)}
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Text size="sm" color={colors.textMuted}>
                {t('tournamentCreation.payments.previewServiceFee' as TranslationKey)}
              </Text>
              <Text size="sm" color={colors.text}>
                {fmt(quote.serviceFeeCents)}
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Text size="sm" color={colors.textMuted}>
                {t('tournamentCreation.payments.previewFeeTax' as TranslationKey)}
              </Text>
              <Text size="sm" color={colors.text}>
                {fmt(quote.feeTaxCents)}
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Text size="sm" color={colors.textMuted}>
                {t('tournamentCreation.payments.previewYouReceive' as TranslationKey)}
              </Text>
              <Text
                size="sm"
                weight="bold"
                color={colors.success}
                testID="tournament-fee-preview-receive"
              >
                {fmt(quote.organizerReceivesCents)}
              </Text>
            </View>
          </View>

          {/* Who pays the service fee */}
          <View style={styles.fieldGroup}>
            <FieldLabel colors={colors}>
              {t('tournamentCreation.payments.whoPaysLabel' as TranslationKey)}
            </FieldLabel>
            <View style={styles.optionsColumn}>
              <OptionCard
                icon="person-outline"
                title={t('tournamentCreation.payments.playerPaysTitle' as TranslationKey)}
                description={t(
                  'tournamentCreation.payments.playerPaysDescription' as TranslationKey
                )}
                selected={feePayer === 'player_pays'}
                onPress={() => setFeePayer('player_pays')}
                colors={colors}
                testID="fee-payer-player_pays"
              />
              <OptionCard
                icon="briefcase-outline"
                title={t('tournamentCreation.payments.organizerAbsorbsTitle' as TranslationKey)}
                description={t(
                  'tournamentCreation.payments.organizerAbsorbsDescription' as TranslationKey
                )}
                selected={feePayer === 'organizer_absorbs'}
                onPress={() => setFeePayer('organizer_absorbs')}
                colors={colors}
                testID="fee-payer-organizer_absorbs"
              />
            </View>
          </View>

          {/* Payout timing is fixed in v0: funds are held until the event ends. */}
          <View style={styles.fieldGroup}>
            <FieldLabel colors={colors}>
              {t('tournamentCreation.payments.payoutLabel' as TranslationKey)}
            </FieldLabel>
            <Text size="xs" color={colors.textMuted} style={styles.fieldDescription}>
              {t('tournamentCreation.payments.payoutNote' as TranslationKey)}
            </Text>
          </View>

          {/* Refund policy */}
          <View style={styles.fieldGroup}>
            <FieldLabel colors={colors}>
              {t('tournamentCreation.payments.refundLabel' as TranslationKey)}
            </FieldLabel>
            <Text size="xs" color={colors.textMuted} style={styles.fieldDescription}>
              {t('tournamentCreation.payments.refundFeeNote' as TranslationKey)}
            </Text>
            <View style={styles.optionsColumn}>
              <OptionCard
                icon="checkmark-circle-outline"
                title={t('tournamentCreation.payments.refundFullTitle' as TranslationKey)}
                description={t(
                  'tournamentCreation.payments.refundFullDescription' as TranslationKey
                )}
                selected={refundKind === 'full'}
                onPress={() => setRefundKind('full')}
                colors={colors}
                testID="refund-full"
              />
              <OptionCard
                icon="pie-chart-outline"
                title={t('tournamentCreation.payments.refundPartialTitle' as TranslationKey)}
                description={t(
                  'tournamentCreation.payments.refundPartialDescription' as TranslationKey
                )}
                selected={refundKind === 'partial'}
                onPress={() => setRefundKind('partial')}
                colors={colors}
                testID="refund-partial"
              />
              <OptionCard
                icon="close-circle-outline"
                title={t('tournamentCreation.payments.refundNoneTitle' as TranslationKey)}
                description={t(
                  'tournamentCreation.payments.refundNoneDescription' as TranslationKey
                )}
                selected={refundKind === 'none'}
                onPress={() => setRefundKind('none')}
                colors={colors}
                testID="refund-none"
              />
            </View>

            {refundKind === 'partial' && (
              <View style={styles.fieldSubGroup}>
                <FieldLabel colors={colors}>
                  {t('tournamentCreation.payments.refundPctLabel' as TranslationKey)}
                </FieldLabel>
                <View
                  style={[
                    styles.textInput,
                    styles.feeInputRow,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: errors.refundPct ? colors.error : colors.inputBorder,
                    },
                  ]}
                >
                  <TextInput
                    style={[styles.feeInputField, { color: colors.text }]}
                    placeholder="50"
                    placeholderTextColor={colors.textMuted}
                    value={refundPctInput}
                    onChangeText={setRefundPctInput}
                    keyboardType="number-pad"
                    maxLength={3}
                    testID="tournament-refund-pct-input"
                  />
                  <Text size="base" weight="semibold" color={colors.textMuted}>
                    %
                  </Text>
                </View>
                {errors.refundPct && (
                  <Text size="xs" color={colors.error} style={styles.errorText}>
                    {errors.refundPct}
                  </Text>
                )}
              </View>
            )}

            {refundKind !== 'none' && (
              <>
                <DateField
                  nested
                  label={t('tournamentCreation.payments.refundCutoffLabel' as TranslationKey)}
                  date={refundCutoff}
                  onPress={openCutoffPicker}
                  placeholder={t(
                    'tournamentCreation.payments.refundCutoffPlaceholder' as TranslationKey
                  )}
                  hint={t('tournamentCreation.payments.refundCutoffHint' as TranslationKey)}
                  colors={colors}
                  locale={locale}
                  testID="tournament-refund-cutoff"
                />
                <TournamentDatePickerSheet
                  visible={cutoffPickerOpen}
                  value={cutoffPickerValue}
                  onChangeValue={setCutoffPickerValue}
                  onCommit={commitCutoff}
                  onDismiss={() => setCutoffPickerOpen(false)}
                  minimumDate={cutoffMinimumDate}
                  maximumDate={cutoffMaximumDate}
                  isDark={isDark}
                  colors={colors}
                  t={t}
                  doneTestID="tournament-refund-cutoff-done"
                />
              </>
            )}
          </View>
        </>
      )}
    </SheetScrollView>
  );
};

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
  const { session } = useAuth();
  const userId = session?.user?.id;
  const { homeLocation } = useUserHomeLocation();
  const { isAdmin } = useAdminStatus();
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
      error: status.error.dark,
      success: '#16a34a',
    }),
    [themeColors, isDark]
  );

  // In edit mode the sport is fixed by the tournament; otherwise it follows the
  // selected sport context. Mirrors MatchCreationWizard's editMatch handling.
  const sportName = editTournament?.sport.name ?? selectedSport?.name;
  const formatOptions = MATCH_FORMATS;
  const isPickleball = sportName === 'pickleball';
  // Bracket size & match format lock once a tournament leaves draft.
  const canEditStructure = !isEditMode || editTournament?.status === 'draft';

  const [currentStep, setCurrentStep] = useState(1);
  const [highestStepVisited, setHighestStepVisited] = useState(1);
  const translateX = useSharedValue(0);
  const [name, setName] = useState(editTournament?.name ?? '');
  const [description, setDescription] = useState(editTournament?.description ?? '');
  const [rules, setRules] = useState(editTournament?.rules ?? '');
  const [logoUrl, setLogoUrl] = useState<string | null>(editTournament?.logoUrl ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [minRating, setMinRating] = useState<number | null>(editTournament?.minRating ?? null);
  const [maxRating, setMaxRating] = useState<number | null>(editTournament?.maxRating ?? null);
  const sportId = editTournament?.sport.id ?? selectedSport?.id;
  const { ratingScores } = useRatingScoresForSport(sportName, sportId, userId);
  const ratingOptions = useMemo(
    () =>
      ratingScores.map(r => ({
        value: r.value,
        label: r.label,
        skillLevel: r.skillLevel,
        id: r.id,
      })),
    [ratingScores]
  );
  const [bracketSize, setBracketSize] = useState<BracketSize>(
    (editTournament?.maxParticipants as BracketSize) ?? 8
  );
  const [matchFormat, setMatchFormat] = useState<MatchFormat>(() => {
    const stored = editTournament?.matchFormat;
    if (!stored) return DEFAULT_MATCH_FORMAT;
    // A legacy fused label means best-of-3 at its own target.
    return LEGACY_FUSED_POINTS[stored] ? DEFAULT_MATCH_FORMAT : stored;
  });
  const [pointsPerGame, setPointsPerGame] = useState<number>(
    () =>
      editTournament?.pointsPerGame ??
      (editTournament?.matchFormat ? LEGACY_FUSED_POINTS[editTournament.matchFormat] : undefined) ??
      DEFAULT_POINTS_PER_GAME
  );
  // Entry format is fixed at creation (the server's tournament_update doesn't
  // accept it), so edit mode never surfaces the picker.
  const [entryFormat, setEntryFormat] = useState<EntryFormat>('singles');
  const [startDate, setStartDate] = useState<Date | null>(
    editTournament ? startOfLocalDay(new Date(editTournament.startDate)) : null
  );
  const [endDate, setEndDate] = useState<Date | null>(
    editTournament ? startOfLocalDay(new Date(editTournament.endDate)) : null
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
  // Fee settings (step 5). entryFeeInput is a dollar string; '' / 0 ⇒ free.
  const [entryFeeInput, setEntryFeeInput] = useState(
    editTournament && editTournament.entryFeeCents > 0
      ? (editTournament.entryFeeCents / 100).toString()
      : ''
  );
  const [feePayer, setFeePayer] = useState<FeePayer>(editTournament?.feePayer ?? 'player_pays');
  const [refundKind, setRefundKind] = useState<RefundKind>(
    editTournament?.refundPolicyKind ?? 'none'
  );
  const [refundPctInput, setRefundPctInput] = useState(
    editTournament?.refundPartialBps != null
      ? (editTournament.refundPartialBps / 100).toString()
      : ''
  );
  const [refundCutoff, setRefundCutoff] = useState<Date | null>(
    editTournament?.refundCutoffAt ? startOfLocalDay(new Date(editTournament.refundCutoffAt)) : null
  );
  // Location (step 1): an exact facility OR a city. Edit mode seeds the mode
  // from whichever was set (facility wins).
  const [locationMode, setLocationMode] = useState<LocationMode>(
    editTournament?.facilityId ? 'facility' : 'city'
  );
  const [selectedFacility, setSelectedFacility] = useState<SelectedFacility | null>(
    editTournament?.facilityId
      ? {
          id: editTournament.facilityId,
          name: editTournament.venueName ?? '',
          address: editTournament.venueAddress,
          city: editTournament.city,
        }
      : null
  );
  const [cityInput, setCityInput] = useState<string>(
    editTournament && !editTournament.facilityId ? (editTournament.city ?? '') : ''
  );
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const locationModeRef = useRef(locationMode);
  locationModeRef.current = locationMode;
  const handleLocationModeChange = useCallback((nextMode: LocationMode) => {
    const currentMode = locationModeRef.current;
    if (currentMode === nextMode) return;

    if (nextMode === 'city') {
      setSelectedFacility(facility => {
        if (facility?.city) {
          setCityInput(ci => (ci.trim() ? ci : (facility.city ?? '')));
        }
        return null;
      });
    } else {
      setCityInput('');
    }

    setLocationMode(nextMode);
    setErrors(prev => (prev.location ? { ...prev, location: undefined } : prev));
  }, []);
  // Advertised prize (step 5). Dollar string; '' / 0 ⇒ no prize.
  const [prizeMoneyInput, setPrizeMoneyInput] = useState(
    editTournament?.prizeMoneyCents != null && editTournament.prizeMoneyCents > 0
      ? (editTournament.prizeMoneyCents / 100).toString()
      : ''
  );
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Poster upload to the public tournament-logos bucket. Errors use Alert (not
  // toast) because the wizard runs inside a sheet, where toasts render behind it.
  // Pick + crop only — the upload is deferred to submit (handleSubmit) so an
  // abandoned/cancelled form never orphans an uploaded file. logoUrl holds the
  // local URI until then.
  const handlePickPoster = useCallback(async () => {
    // 12:5 == the 2.4:1 box banners render in (TOURNAMENT_BANNER_ASPECT), so
    // what the organizer frames here is exactly what shows on the card and hero.
    const { uri } = await pickImageWithCropper({ aspectRatio: [12, 5], quality: 0.85 });
    if (!uri) return;
    lightHaptic();
    setLogoUrl(uri);
  }, []);

  const handleRemovePoster = useCallback(() => {
    lightHaptic();
    setLogoUrl(null);
  }, []);

  useEffect(() => {
    translateX.value = withSpring(-((currentStep - 1) * SCREEN_WIDTH), {
      damping: 80,
      stiffness: 600,
      overshootClamping: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const animatedStepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

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

  const { createTournamentAsync } = useCreateTournament({
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

  const { mutateAsync: updateTournamentAsync } = useUpdateTournament({
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
        // Location required at creation only (an exact facility OR a city).
        // Existing tournaments predating this field aren't forced to add one.
        if (!isEditMode) {
          const hasLocation =
            (locationMode === 'facility' && !!selectedFacility) ||
            (locationMode === 'city' && cityInput.trim().length > 0);
          if (!hasLocation)
            next.location = t('tournamentCreation.validation.locationRequired' as TranslationKey);
        }
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
      if (step === 4) {
        const cents = dollarsToCents(entryFeeInput);
        if (cents > 0 && refundKind === 'partial') {
          const pct = Number(refundPctInput);
          if (!Number.isFinite(pct) || pct < 1 || pct > 100)
            next.refundPct = t('tournamentCreation.validation.refundPctRange' as TranslationKey);
        }
      }
      setErrors(next);
      return Object.values(next).every(v => !v);
    },
    [
      name,
      startDate,
      endDate,
      isEditMode,
      locationMode,
      selectedFacility,
      cityInput,
      entryFeeInput,
      refundKind,
      refundPctInput,
      t,
    ]
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
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      const nextStep = Math.min(TOTAL_STEPS, currentStep + 1);
      setCurrentStep(nextStep);
      setHighestStepVisited(prev => Math.max(prev, nextStep));
    });
  }, [currentStep, validateStep, sportName]);

  const goBack = useCallback(() => {
    lightHaptic();
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      setCurrentStep(s => Math.max(1, s - 1));
    });
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
    if (isSubmitting) return;

    if (!validateStep(1)) {
      setCurrentStep(1);
      return;
    }
    if (!validateStep(4)) {
      setCurrentStep(4);
      return;
    }
    if (!startDate || !endDate) return;

    Keyboard.dismiss();
    setIsSubmitting(true);
    // Yield one frame so the loading state paints before poster upload / API work.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    try {
      // ---- Fee settings (step 5) → snapshot the values for create/patch ----
      const entryFeeCents = dollarsToCents(entryFeeInput);
      const isPaid = entryFeeCents > 0;
      const refundKindFinal: RefundKind = isPaid ? refundKind : 'none';
      const refundPartialBps =
        isPaid && refundKindFinal === 'partial' ? Math.round(Number(refundPctInput) * 100) : null;
      const refundCutoffIso =
        isPaid && refundKindFinal !== 'none'
          ? ((refundCutoff ?? startDate)?.toISOString() ?? null)
          : null;

      // ---- Location (step 1) + prize (step 5) → snapshot for create/patch ----
      // Facility mode denormalizes the facility's name/address/city so display
      // stays join-free. City mode stores only the city string.
      const locationPayload =
        locationMode === 'facility' && selectedFacility
          ? {
              facilityId: selectedFacility.id,
              venueName: selectedFacility.name || null,
              venueAddress: selectedFacility.address,
              city: selectedFacility.city,
            }
          : locationMode === 'city' && cityInput.trim()
            ? { facilityId: null, venueName: null, venueAddress: null, city: cityInput.trim() }
            : null;
      const prizeCents = dollarsToCents(prizeMoneyInput);
      const prizeMoneyCents = prizeCents > 0 ? prizeCents : null;

      // Upload a freshly-picked poster now (on submit) rather than at selection,
      // so abandoning the form never orphans an uploaded file. logoUrl is a local
      // URI for a new pick, or an existing remote URL (https) when unchanged.
      let resolvedLogoUrl = logoUrl;
      if (logoUrl && !/^https?:\/\//.test(logoUrl)) {
        const { url } = await uploadImage(logoUrl, 'tournament-logos');
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
        if (locationPayload) {
          if ((locationPayload.facilityId ?? null) !== (editTournament.facilityId ?? null))
            patch.facilityId = locationPayload.facilityId;
          if ((locationPayload.venueName ?? null) !== (editTournament.venueName ?? null))
            patch.venueName = locationPayload.venueName;
          if ((locationPayload.venueAddress ?? null) !== (editTournament.venueAddress ?? null))
            patch.venueAddress = locationPayload.venueAddress;
          if ((locationPayload.city ?? null) !== (editTournament.city ?? null))
            patch.city = locationPayload.city;
        }
        if (prizeMoneyCents !== (editTournament.prizeMoneyCents ?? null))
          patch.prizeMoneyCents = prizeMoneyCents;
        if (visibility !== editTournament.visibility) patch.visibility = visibility;
        if (startDate.toISOString() !== new Date(editTournament.startDate).toISOString())
          patch.startDate = startDate.toISOString();
        if (endDate.toISOString() !== new Date(editTournament.endDate).toISOString())
          patch.endDate = endDate.toISOString();
        if (canEditStructure) {
          if (bracketSize !== editTournament.maxParticipants) patch.maxParticipants = bracketSize;
          if (matchFormat !== editTournament.matchFormat) patch.matchFormat = matchFormat;
          // Only pickleball carries a target, and only when it changed.
          const nextPoints = isPickleball ? pointsPerGame : null;
          if (nextPoints !== (editTournament.pointsPerGame ?? null))
            patch.pointsPerGame = nextPoints;
          if (minRating !== (editTournament.minRating ?? null)) patch.minRating = minRating;
          if (maxRating !== (editTournament.maxRating ?? null)) patch.maxRating = maxRating;
        }
        // Fee settings are server-gated to 'draft'. Send the refund trio together
        // so the partial/bps CHECK stays consistent.
        if (editTournament.status === 'draft') {
          if (entryFeeCents !== editTournament.entryFeeCents) patch.entryFeeCents = entryFeeCents;
          if (feePayer !== editTournament.feePayer) patch.feePayer = feePayer;
          const refundChanged =
            refundKindFinal !== editTournament.refundPolicyKind ||
            (refundPartialBps ?? null) !== (editTournament.refundPartialBps ?? null) ||
            (refundCutoffIso ?? null) !== (editTournament.refundCutoffAt ?? null);
          if (refundChanged) {
            patch.refundPolicyKind = refundKindFinal;
            patch.refundPartialBps = refundKindFinal === 'partial' ? refundPartialBps : null;
            patch.refundCutoffAt = refundKindFinal !== 'none' ? refundCutoffIso : null;
          }
        }

        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }

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
        return;
      }

      // ---- Create mode ----
      if (!selectedSport?.id) return;

      const tournament = await createTournamentAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        rules: rules.trim() || undefined,
        logoUrl: resolvedLogoUrl ?? undefined,
        minRating: minRating ?? undefined,
        maxRating: maxRating ?? undefined,
        facilityId: locationPayload?.facilityId ?? undefined,
        venueName: locationPayload?.venueName ?? undefined,
        venueAddress: locationPayload?.venueAddress ?? undefined,
        city: locationPayload?.city ?? undefined,
        prizeMoneyCents: prizeMoneyCents ?? undefined,
        sportId: selectedSport.id,
        maxParticipants: bracketSize,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        visibility: visibility as Visibility,
        registrationMode,
        matchFormat,
        pointsPerGame: isPickleball ? pointsPerGame : undefined,
        entryFormat,
        entryFeeCents: isPaid ? entryFeeCents : 0,
        currency: FEE_CURRENCY,
        feePayer,
        refundPolicyKind: refundKindFinal,
        refundPartialBps,
        refundCutoffAt: refundCutoffIso,
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
      // Error toast handled by mutation hooks' onError.
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    isEditMode,
    editTournament,
    canEditStructure,
    selectedSport,
    name,
    description,
    rules,
    logoUrl,
    minRating,
    maxRating,
    bracketSize,
    matchFormat,
    startDate,
    endDate,
    visibility,
    registrationMode,
    entryFeeInput,
    feePayer,
    refundKind,
    refundPctInput,
    refundCutoff,
    locationMode,
    selectedFacility,
    cityInput,
    prizeMoneyInput,
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
    setMinRating(null);
    setMaxRating(null);
    setIsSubmitting(false);
    setLocationMode('city');
    setSelectedFacility(null);
    setCityInput('');
    setPrizeMoneyInput('');
    setBracketSize(8);
    setMatchFormat(DEFAULT_MATCH_FORMAT);
    setPointsPerGame(DEFAULT_POINTS_PER_GAME);
    setEntryFormat('singles');
    setStartDate(null);
    setEndDate(null);
    setVisibility('private');
    setRegistrationMode('open');
    setEntryFeeInput('');
    setFeePayer('player_pays');
    setRefundKind('none');
    setRefundPctInput('');
    setRefundCutoff(null);
    setErrors({});
    setShowSuccess(false);
    setCreatedId(null);
    setCurrentStep(1);
    setHighestStepVisited(1);
  }, [sportName]);

  // Shared props for DetailsStep (steps 1–2); kept outside JSX to avoid duplication.
  const detailsStepSharedProps = useMemo(
    () => ({
      name,
      setName,
      description,
      setDescription,
      minRating,
      setMinRating,
      maxRating,
      setMaxRating,
      ratingOptions,
      location: {
        colors,
        t,
        sportId,
        latitude: homeLocation?.latitude,
        longitude: homeLocation?.longitude,
        playerId: userId,
        mode: locationMode,
        setMode: handleLocationModeChange,
        selectedFacility,
        onSelectFacility: setSelectedFacility,
        onClearFacility: () => setSelectedFacility(null),
        cityInput,
        setCityInput,
        error: errors.location,
      },
      logoUrl,
      posterUploading: isSubmitting,
      onPickPoster: handlePickPoster,
      onRemovePoster: handleRemovePoster,
      bracketSize,
      setBracketSize,
      matchFormat,
      setMatchFormat,
      formatOptions,
      pointsPerGame,
      setPointsPerGame,
      isPickleball,
      entryFormat,
      setEntryFormat,
      canPickEntryFormat: !isEditMode,
      canEditStructure,
      startDate,
      endDate,
      setStartDate: handleSetStartDate,
      setEndDate,
      errors,
      colors,
      t,
      locale,
      isDark,
      isEditMode,
    }),
    [
      name,
      description,
      minRating,
      maxRating,
      ratingOptions,
      colors,
      t,
      sportId,
      homeLocation?.latitude,
      homeLocation?.longitude,
      userId,
      locationMode,
      handleLocationModeChange,
      selectedFacility,
      cityInput,
      errors.location,
      logoUrl,
      isSubmitting,
      handlePickPoster,
      handleRemovePoster,
      bracketSize,
      matchFormat,
      formatOptions,
      pointsPerGame,
      isPickleball,
      entryFormat,
      isEditMode,
      canEditStructure,
      startDate,
      endDate,
      handleSetStartDate,
      errors,
      locale,
      isDark,
    ]
  );

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

      <View style={styles.stepsViewport}>
        <Animated.View
          style={[styles.stepsContainer, { width: SCREEN_WIDTH * TOTAL_STEPS }, animatedStepStyle]}
        >
          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            <DetailsStep step={1} {...detailsStepSharedProps} />
          </View>

          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            {highestStepVisited >= 2 && <DetailsStep step={2} {...detailsStepSharedProps} />}
          </View>

          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            {highestStepVisited >= 3 && (
              <VisibilityStep
                rules={rules}
                setRules={setRules}
                visibility={visibility}
                setVisibility={setVisibility}
                colors={colors}
                t={t}
              />
            )}
          </View>

          <View style={[styles.stepWrapper, { width: SCREEN_WIDTH }]}>
            {highestStepVisited >= 4 && (
              <PaymentsStep
                entryFeeInput={entryFeeInput}
                setEntryFeeInput={setEntryFeeInput}
                feePayer={feePayer}
                setFeePayer={setFeePayer}
                refundKind={refundKind}
                setRefundKind={setRefundKind}
                refundPctInput={refundPctInput}
                setRefundPctInput={setRefundPctInput}
                refundCutoff={refundCutoff}
                setRefundCutoff={setRefundCutoff}
                prizeMoneyInput={prizeMoneyInput}
                setPrizeMoneyInput={setPrizeMoneyInput}
                startDate={startDate}
                feeLocked={isEditMode && editTournament?.status !== 'draft'}
                allowEntryFee={isAdmin || (editTournament?.entryFeeCents ?? 0) > 0}
                errors={errors}
                colors={colors}
                t={t}
                locale={locale}
                isDark={isDark}
                isEditMode={isEditMode}
              />
            )}
          </View>
        </Animated.View>
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
          testID="tournament-wizard-submit"
        >
          {isSubmitting && currentStep === TOTAL_STEPS ? (
            <ActivityIndicator color={colors.buttonTextActive} />
          ) : (
            <>
              <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
                {currentStep === TOTAL_STEPS
                  ? isEditMode
                    ? t('tournamentDetail.editModal.save' as TranslationKey)
                    : t('tournamentCreation.createTournament' as TranslationKey)
                  : t('tournamentCreation.next' as TranslationKey)}
              </Text>
              {currentStep !== TOTAL_STEPS && (
                <Ionicons name="arrow-forward-outline" size={20} color={colors.buttonTextActive} />
              )}
            </>
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
  stepsViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  stepsContainer: {
    flexDirection: 'row',
    flex: 1,
    height: '100%',
  },
  stepWrapper: {
    height: '100%',
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
  fieldSubGroup: {
    marginTop: spacingPixels[4],
  },
  fieldDescription: {
    marginBottom: spacingPixels[3],
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
  helperText: {
    marginTop: spacingPixels[2],
  },
  textInput: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    fontSize: 16,
  },
  feeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  feeInputField: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  previewCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[5],
    gap: spacingPixels[2],
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  dateButtonCompact: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    gap: spacingPixels[1],
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  dateRowField: {
    flex: 1,
    minWidth: 0,
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
  loadingContainer: {
    padding: spacingPixels[4],
    alignItems: 'center',
  },
  locationModeRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  locationModeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  selectedFacilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  selectedFacilityInfo: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  facilityResults: {
    marginTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  facilityResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  facilityResultInfo: {
    flex: 1,
    gap: spacingPixels[0.5],
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
