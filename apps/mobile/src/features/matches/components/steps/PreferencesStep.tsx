/**
 * Preferences Step
 *
 * Step 3 of the match creation wizard.
 * Handles format, court cost, visibility, join mode, and notes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { UseFormReturn } from 'react-hook-form';
import { Ionicons } from '@expo/vector-icons';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Text, Callout } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, status } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import {
  useRatingScoresForSport,
  useFacilityDetail,
  useFacilityReservationContact,
} from '@rallia/shared-hooks';
import type { MatchFormSchemaData } from '@rallia/shared-types';

import type { TranslationKey, TranslationOptions } from '#/hooks/useTranslation';
import { useKeyboardAwareSheetScroll } from '#/hooks/useKeyboardAwareSheetScroll';

import { OptionCard } from './OptionCard';
import { ReservationContactAlert } from './ReservationContactAlert';

// =============================================================================
// TYPES
// =============================================================================

interface PreferencesStepProps {
  form: UseFormReturn<MatchFormSchemaData>;
  colors: {
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    buttonActive: string;
    buttonInactive: string;
    buttonTextActive: string;
    cardBackground: string;
  };
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  isDark: boolean;
  /** Sport name for fetching rating scores (e.g., "tennis", "pickleball") */
  sportName?: string;
  /** Sport ID for fetching player's current rating */
  sportId?: string;
  /** User ID for fetching player's current rating */
  userId?: string;
}

/** Descriptions moved out of the cards and under each row of options */
const COURT_STATUS_HINT_KEYS: Record<'to_book' | 'booked', TranslationKey> = {
  to_book: 'matchCreation.fields.courtStatusToBookDescription',
  booked: 'matchCreation.fields.courtStatusBookedDescription',
};

const EXPECTATION_HINT_KEYS: Record<'casual' | 'competitive' | 'both', TranslationKey> = {
  casual: 'matchCreation.fields.playerExpectationCasualDescription',
  competitive: 'matchCreation.fields.playerExpectationCompetitiveDescription',
  both: 'matchCreation.fields.playerExpectationBothDescription',
};

const VISIBILITY_HINT_KEYS: Record<'public' | 'private', TranslationKey> = {
  public: 'matchCreation.fields.visibilityPublicDescription',
  private: 'matchCreation.fields.visibilityPrivateDescription',
};

const JOIN_MODE_HINT_KEYS: Record<'direct' | 'request', TranslationKey> = {
  direct: 'matchCreation.fields.joinModeDirectDescription',
  request: 'matchCreation.fields.joinModeRequestDescription',
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const PreferencesStep: React.FC<PreferencesStepProps> = ({
  form,
  colors,
  t,
  isDark,
  sportName,
  sportId,
  userId,
}) => {
  const {
    watch,
    setValue,
    formState: { errors },
  } = form;

  const format = watch('format');
  const playerExpectation = watch('playerExpectation');
  const isCourtFree = watch('isCourtFree');
  const costSplitType = watch('costSplitType');
  const estimatedCost = watch('estimatedCost');
  const visibility = watch('visibility');
  const visibleInGroups = watch('visibleInGroups');
  const visibleInCommunities = watch('visibleInCommunities');
  const joinMode = watch('joinMode');
  const preferredOpponentGender = watch('preferredOpponentGender');
  const minRatingScoreId = watch('minRatingScoreId');
  const notes = watch('notes');
  const locationType = watch('locationType');
  const facilityId = watch('facilityId');
  const locationName = watch('locationName');
  const courtStatus = watch('courtStatus');

  // A location is set once a facility is picked or a custom place is entered
  const hasLocationSpecified =
    (locationType === 'facility' && !!facilityId) || (locationType === 'custom' && !!locationName);

  // Nothing to reserve at a first-come facility, so neither the prompt to call
  // nor the booked/not-booked question applies.
  const { facility } = useFacilityDetail({
    facilityId: facilityId ?? '',
    sportId,
    enabled: locationType === 'facility' && !!facilityId,
  });
  const isFirstComeFacility = locationType === 'facility' && !!facility?.is_first_come_first_serve;

  const { contact: reservationContact, hasContact: hasReservationContact } =
    useFacilityReservationContact(locationType === 'facility' ? facilityId : undefined, sportId);

  // Only worth showing while the court still has to be reserved
  const showReservationContactAlert =
    locationType === 'facility' &&
    !!facilityId &&
    (courtStatus === 'to_book' || !courtStatus) &&
    hasReservationContact &&
    !isFirstComeFacility;

  // Fetch rating scores for the sport (also returns player's current rating)
  const {
    ratingScores,
    isLoading: isLoadingRatings,
    hasRatingSystem,
    playerRatingScoreId,
  } = useRatingScoresForSport(sportName, sportId, userId);

  // Track if we've set the default rating to avoid overwriting user selection
  const hasSetDefaultRating = useRef(false);
  const { scrollProps, inputs } = useKeyboardAwareSheetScroll(['cost', 'notes']);

  // The row shows labels only, so the detail lives underneath: what each
  // player owes once an amount is known, the plain description before that.
  const costSplitHint = (() => {
    if (costSplitType !== 'equal') {
      return t('matchCreation.fields.costSplitCreatorDescription');
    }
    if (typeof estimatedCost !== 'number') {
      return t(
        format === 'singles'
          ? 'matchCreation.fields.costSplitEqualDescriptionSingles'
          : 'matchCreation.fields.costSplitEqualDescriptionDoubles'
      );
    }
    const playerCount = format === 'doubles' ? 4 : 2;
    const perPerson = Math.ceil(estimatedCost / playerCount);
    return format === 'singles'
      ? t('matchCreation.fields.estimatedCostHelperSingles', { amount: perPerson })
      : t('matchCreation.fields.estimatedCostHelperDoubles', {
          amount: perPerson,
          count: playerCount - 1,
        });
  })();

  // The form stores a number, so a half-typed "12." parses back to 12 and the
  // separator disappears under the cursor. Keep the raw text and let it win
  // while it still represents the stored amount.
  const [costText, setCostText] = useState<string | null>(null);
  const costInputValue =
    costText !== null &&
    (parseFloat(costText) === estimatedCost || (costText === '' && estimatedCost === undefined))
      ? costText
      : (estimatedCost?.toString() ?? '');

  const handleCostChange = (text: string) => {
    // The French keyboard offers a comma; keep one separator and two decimals
    const cleaned = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const [whole, ...rest] = cleaned.split('.');
    const normalized = rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
    setCostText(normalized);
    const parsed = parseFloat(normalized);
    setValue('estimatedCost', isNaN(parsed) ? undefined : parsed, { shouldDirty: true });
  };

  const ratingScrollRef = useRef<ScrollView>(null);
  const [ratingScrollViewWidth, setRatingScrollViewWidth] = useState(0);

  // Set player's rating as default once on initial load (never override user's explicit selection)
  useEffect(() => {
    if (playerRatingScoreId && !hasSetDefaultRating.current) {
      setValue('minRatingScoreId', playerRatingScoreId, { shouldDirty: false });
      hasSetDefaultRating.current = true;
    }
  }, [playerRatingScoreId, setValue]);

  // Track measured positions of rating items for accurate scroll centering
  const ratingItemPositions = useRef<Map<number, { x: number; width: number }>>(new Map());
  const [ratingLayoutsReady, setRatingLayoutsReady] = useState(false);

  // Reset measured positions when ratings reload
  useEffect(() => {
    if (isLoadingRatings) {
      ratingItemPositions.current.clear();
      queueMicrotask(() => setRatingLayoutsReady(false));
    }
  }, [isLoadingRatings]);

  const handleRatingItemLayout = useCallback(
    (index: number, x: number, width: number) => {
      ratingItemPositions.current.set(index, { x, width });
      if (ratingItemPositions.current.size === ratingScores.length + 1) {
        setRatingLayoutsReady(true);
      }
    },
    [ratingScores.length]
  );

  // Center the minimum rating horizontal scroll on the pre-selected rating
  useEffect(() => {
    if (isLoadingRatings || !ratingLayoutsReady || ratingScrollViewWidth <= 0) return;

    const selectedIndex = minRatingScoreId
      ? 1 + ratingScores.findIndex(s => s.id === minRatingScoreId)
      : 0;
    const clampedIndex = selectedIndex < 0 ? 0 : selectedIndex;

    const layout = ratingItemPositions.current.get(clampedIndex);
    if (!layout) return;

    const itemCenterX = layout.x + layout.width / 2;
    const scrollX = Math.max(0, itemCenterX - ratingScrollViewWidth / 2);

    const id = setTimeout(() => {
      ratingScrollRef.current?.scrollTo({ x: scrollX, animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, [isLoadingRatings, ratingLayoutsReady, ratingScores, minRatingScoreId, ratingScrollViewWidth]);

  return (
    <SheetScrollView
      {...scrollProps}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {/* Step title */}
      <View style={styles.stepHeader}>
        <Text size="lg" weight="bold" color={colors.text}>
          {t('matchCreation.step3Title')}
        </Text>
        <Text size="sm" color={colors.textMuted}>
          {t('matchCreation.step3Description')}
        </Text>
      </View>

      {/* Format options (Singles/Doubles) */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.format')}
        </Text>
        <View style={styles.formatRow}>
          <OptionCard
            icon="person-outline"
            title={t('matchCreation.fields.formatSingles')}
            selected={format === 'singles'}
            onPress={() =>
              setValue('format', 'singles', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
            compact
          />
          <OptionCard
            icon="people-outline"
            title={t('matchCreation.fields.formatDoubles')}
            selected={format === 'doubles'}
            onPress={() =>
              setValue('format', 'doubles', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
            compact
          />
        </View>
      </View>

      {/* Player expectation options (Casual/Competitive/Both) */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.playerExpectation')}
        </Text>
        <View style={styles.optionsRow}>
          <OptionCard
            icon="cafe-outline"
            title={t('matchCreation.fields.playerExpectationCasual')}
            selected={playerExpectation === 'casual'}
            onPress={() =>
              setValue('playerExpectation', 'casual', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
            compact
          />
          <OptionCard
            icon="trophy-outline"
            title={t('matchCreation.fields.playerExpectationCompetitive')}
            selected={playerExpectation === 'competitive'}
            onPress={() =>
              setValue('playerExpectation', 'competitive', {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
            colors={colors}
            compact
          />
          <OptionCard
            icon="hand-left-outline"
            title={t('matchCreation.fields.playerExpectationBoth')}
            selected={playerExpectation === 'both'}
            onPress={() =>
              setValue('playerExpectation', 'both', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
            compact
          />
        </View>
        <Text size="xs" color={colors.textMuted} style={styles.optionHint}>
          {t(EXPECTATION_HINT_KEYS[playerExpectation])}
        </Text>
      </View>

      {/* The court: booking status first, then what it costs (hidden for TBD) */}
      {locationType !== 'tbd' && (
        <View style={styles.sectionHeader}>
          <Text size="base" weight="bold" color={colors.text}>
            {t('matchCreation.fields.courtSection')}
          </Text>
          <Text size="xs" color={colors.textMuted}>
            {t('matchCreation.fields.courtSectionDescription')}
          </Text>
        </View>
      )}

      {/* Reservation contact: this facility still has to be booked directly */}
      {showReservationContactAlert && reservationContact && (
        <ReservationContactAlert
          phone={reservationContact.phone}
          email={reservationContact.email}
          website={reservationContact.website}
          colors={colors}
          t={t}
          isDark={isDark}
        />
      )}

      {/* First-come courts cannot be reserved, so say so instead of asking */}
      {isFirstComeFacility && (
        <View style={styles.fieldGroup}>
          <Callout message={t('matchCreation.booking.firstComeFirstServe')} />
        </View>
      )}

      {/* Court booking status (only once a location is specified) */}
      {hasLocationSpecified && !isFirstComeFacility && (
        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('matchCreation.fields.courtStatus')}
          </Text>
          <View style={styles.optionsRow}>
            <OptionCard
              icon="calendar-outline"
              title={t('matchCreation.fields.courtStatusToBook')}
              selected={courtStatus === 'to_book' || !courtStatus}
              onPress={() =>
                setValue('courtStatus', 'to_book', { shouldValidate: true, shouldDirty: true })
              }
              colors={colors}
              compact
              titleLines={2}
            />
            <OptionCard
              icon="checkmark-circle-outline"
              title={t('matchCreation.fields.courtStatusBooked')}
              selected={courtStatus === 'booked'}
              onPress={() =>
                setValue('courtStatus', 'booked', { shouldValidate: true, shouldDirty: true })
              }
              colors={colors}
              compact
              titleLines={2}
            />
          </View>
          <Text size="xs" color={colors.textMuted} style={styles.optionHint}>
            {t(COURT_STATUS_HINT_KEYS[courtStatus === 'booked' ? 'booked' : 'to_book'])}
          </Text>
        </View>
      )}

      {/* Court cost toggle */}
      {locationType !== 'tbd' && (
        <View style={styles.fieldGroup}>
          <View style={[styles.toggleRow, { borderColor: colors.border }]}>
            <View style={styles.toggleTextContainer}>
              <Text size="base" weight="semibold" color={colors.text}>
                {t('matchCreation.fields.isCourtFree')}
              </Text>
              <Text size="xs" color={colors.textMuted}>
                {isCourtFree
                  ? t('matchCreation.fields.isCourtFreeYes')
                  : t('matchCreation.fields.isCourtFreeNo')}
              </Text>
            </View>
            <Switch
              value={isCourtFree}
              onValueChange={value => {
                lightHaptic();
                setValue('isCourtFree', value, { shouldValidate: true, shouldDirty: true });
                // Clear estimated cost when toggling back to free
                if (value) {
                  setValue('estimatedCost', undefined, { shouldDirty: true });
                }
              }}
              trackColor={{ false: colors.border, true: colors.buttonActive }}
              thumbColor={colors.buttonTextActive}
            />
          </View>
        </View>
      )}

      {/* Total court cost */}
      {!isCourtFree && locationType !== 'tbd' && (
        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('matchCreation.fields.estimatedCostTotal')}
          </Text>
          <View
            style={[
              styles.costInputContainer,
              {
                borderColor: errors.estimatedCost ? status.error.DEFAULT : colors.border,
                backgroundColor: colors.cardBackground,
              },
            ]}
          >
            <Text size="base" weight="medium" color={colors.textMuted}>
              $
            </Text>
            <TextInput
              {...inputs.cost}
              style={[styles.costInput, { color: colors.text }]}
              value={costInputValue}
              onChangeText={handleCostChange}
              placeholder={t('matchCreation.fields.estimatedCostPlaceholderTotal')}
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
          {errors.estimatedCost && (
            <Text size="xs" color={status.error.DEFAULT} style={styles.errorText}>
              {errors.estimatedCost.message}
            </Text>
          )}
        </View>
      )}

      {/* Who pays */}
      {!isCourtFree && locationType !== 'tbd' && (
        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('matchCreation.fields.costSplitType')}
          </Text>
          <View style={styles.optionsRow}>
            <OptionCard
              icon="people-outline"
              title={t('matchCreation.fields.costSplitEqual')}
              selected={costSplitType === 'equal'}
              onPress={() =>
                setValue('costSplitType', 'equal', { shouldValidate: true, shouldDirty: true })
              }
              colors={colors}
              compact
              titleLines={2}
            />
            <OptionCard
              icon="person-outline"
              title={t('matchCreation.fields.costSplitCreator')}
              selected={costSplitType === 'creator_pays'}
              onPress={() =>
                setValue('costSplitType', 'creator_pays', {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              colors={colors}
              compact
              titleLines={2}
            />
          </View>
          <Text size="xs" color={colors.textMuted} style={styles.optionHint}>
            {costSplitHint}
          </Text>
        </View>
      )}

      {/* Who can join: visibility, join mode, then opponent filters */}
      <View style={styles.sectionHeader}>
        <Text size="base" weight="bold" color={colors.text}>
          {t('matchCreation.fields.whoCanJoin')}
        </Text>
        <Text size="xs" color={colors.textMuted}>
          {t('matchCreation.fields.whoCanJoinDescription')}
        </Text>
      </View>

      {/* Visibility options */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.visibility')}
        </Text>
        <View style={styles.optionsRow}>
          <OptionCard
            icon="globe-outline"
            title={t('matchCreation.fields.visibilityPublic')}
            selected={visibility === 'public'}
            onPress={() =>
              setValue('visibility', 'public', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
            compact
          />
          <OptionCard
            icon="lock-closed-outline"
            title={t('matchCreation.fields.visibilityPrivate')}
            selected={visibility === 'private'}
            onPress={() =>
              setValue('visibility', 'private', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
            compact
          />
        </View>
        <Text size="xs" color={colors.textMuted} style={styles.optionHint}>
          {t(VISIBILITY_HINT_KEYS[visibility])}
        </Text>
      </View>

      {/* Private visibility: visible in groups / communities (pre-checked) */}
      {visibility === 'private' && (
        <View style={[styles.fieldGroup, styles.privateVisibilityToggles]}>
          <View style={[styles.privateVisibilityToggleRow, { borderColor: colors.border }]}>
            <View style={styles.toggleTextContainer}>
              <Text size="sm" weight="medium" color={colors.text}>
                {t('matchCreation.fields.visibleInGroups')}
              </Text>
            </View>
            <Switch
              value={visibleInGroups ?? true}
              onValueChange={value => {
                lightHaptic();
                setValue('visibleInGroups', value, { shouldValidate: true, shouldDirty: true });
              }}
              trackColor={{ false: colors.border, true: colors.buttonActive }}
              thumbColor={colors.buttonTextActive}
            />
          </View>
          <View style={[styles.privateVisibilityToggleRow, { borderColor: colors.border }]}>
            <View style={styles.toggleTextContainer}>
              <Text size="sm" weight="medium" color={colors.text}>
                {t('matchCreation.fields.visibleInCommunities')}
              </Text>
            </View>
            <Switch
              value={visibleInCommunities ?? true}
              onValueChange={value => {
                lightHaptic();
                setValue('visibleInCommunities', value, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
              }}
              trackColor={{ false: colors.border, true: colors.buttonActive }}
              thumbColor={colors.buttonTextActive}
            />
          </View>
        </View>
      )}

      {/* Join mode options */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.joinMode')}
        </Text>
        <View style={styles.optionsRow}>
          <OptionCard
            icon="flash-outline"
            title={t('matchCreation.fields.joinModeDirect')}
            selected={joinMode === 'direct'}
            onPress={() =>
              setValue('joinMode', 'direct', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
            compact
            titleLines={2}
          />
          <OptionCard
            icon="hand-right-outline"
            title={t('matchCreation.fields.joinModeRequest')}
            selected={joinMode === 'request'}
            onPress={() =>
              setValue('joinMode', 'request', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
            compact
            titleLines={2}
          />
        </View>
        <Text size="xs" color={colors.textMuted} style={styles.optionHint}>
          {t(JOIN_MODE_HINT_KEYS[joinMode])}
        </Text>
      </View>

      {/* Preferred opponent gender */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.preferredGender')}
        </Text>
        <View style={styles.optionsRow}>
          <OptionCard
            icon="people-outline"
            title={t('matchCreation.fields.genderAny')}
            selected={preferredOpponentGender === 'any' || !preferredOpponentGender}
            onPress={() =>
              setValue('preferredOpponentGender', 'any', {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
            colors={colors}
            compact
          />
          <OptionCard
            icon="man-outline"
            title={t('matchCreation.fields.genderMale')}
            selected={preferredOpponentGender === 'male'}
            onPress={() =>
              setValue('preferredOpponentGender', 'male', {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
            colors={colors}
            compact
          />
          <OptionCard
            icon="woman-outline"
            title={t('matchCreation.fields.genderFemale')}
            selected={preferredOpponentGender === 'female'}
            onPress={() =>
              setValue('preferredOpponentGender', 'female', {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
            colors={colors}
            compact
          />
          <OptionCard
            icon="transgender-outline"
            title={t('matchCreation.fields.genderOther')}
            selected={preferredOpponentGender === 'other'}
            onPress={() =>
              setValue('preferredOpponentGender', 'other', {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
            colors={colors}
            compact
          />
        </View>
      </View>

      {/* Minimum Rating Score - only show for sports with rating systems */}
      {hasRatingSystem && (
        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('matchCreation.fields.minRatingScore')}
          </Text>
          <Text size="xs" color={colors.textMuted} style={styles.fieldDescription}>
            {t('matchCreation.fields.minRatingScoreDescription')}
          </Text>
          {isLoadingRatings ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.buttonActive} />
            </View>
          ) : (
            <GestureScrollView
              ref={ratingScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.ratingScrollContent}
              nestedScrollEnabled
              onLayout={e => setRatingScrollViewWidth(e.nativeEvent.layout.width)}
            >
              {/* No minimum option */}
              <TouchableOpacity
                style={[
                  styles.ratingCard,
                  {
                    backgroundColor: !minRatingScoreId
                      ? `${colors.buttonActive}15`
                      : colors.buttonInactive,
                    borderColor: !minRatingScoreId ? colors.buttonActive : colors.border,
                  },
                ]}
                onLayout={e =>
                  handleRatingItemLayout(0, e.nativeEvent.layout.x, e.nativeEvent.layout.width)
                }
                onPress={() => {
                  lightHaptic();
                  setValue('minRatingScoreId', undefined, {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                }}
              >
                <Text
                  size="sm"
                  weight={!minRatingScoreId ? 'bold' : 'regular'}
                  color={!minRatingScoreId ? colors.buttonActive : colors.text}
                >
                  {t('matchCreation.fields.noMinimum')}
                </Text>
              </TouchableOpacity>

              {/* Rating score options */}
              {ratingScores.map((score, index) => {
                const isSelected = minRatingScoreId === score.id;
                const isPlayerRating = score.id === playerRatingScoreId;
                return (
                  <TouchableOpacity
                    key={score.id}
                    style={[
                      styles.ratingCard,
                      {
                        backgroundColor: isSelected
                          ? `${colors.buttonActive}15`
                          : colors.buttonInactive,
                        borderColor: isSelected ? colors.buttonActive : colors.border,
                      },
                    ]}
                    onLayout={e =>
                      handleRatingItemLayout(
                        index + 1,
                        e.nativeEvent.layout.x,
                        e.nativeEvent.layout.width
                      )
                    }
                    onPress={() => {
                      lightHaptic();
                      setValue('minRatingScoreId', score.id, {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                    }}
                  >
                    {isPlayerRating && (
                      <View
                        style={[
                          styles.yourRatingBadge,
                          {
                            backgroundColor: colors.buttonActive,
                            borderColor: colors.cardBackground,
                          },
                        ]}
                      >
                        <Ionicons name="person-outline" size={10} color={colors.buttonTextActive} />
                      </View>
                    )}
                    <Text
                      size="base"
                      weight={isSelected ? 'bold' : 'semibold'}
                      color={isSelected ? colors.buttonActive : colors.text}
                    >
                      {score.label}
                    </Text>
                    {score.skillLevel && (
                      <Text
                        size="xs"
                        color={isSelected ? colors.buttonActive : colors.textMuted}
                        style={styles.ratingSkillLevel}
                      >
                        {t(`matchCreation.fields.skillLevelAbbr.${score.skillLevel}`)}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </GestureScrollView>
          )}
        </View>
      )}

      {/* Notes */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.notes')}
        </Text>
        <TextInput
          {...inputs.notes}
          style={[
            styles.notesInput,
            {
              borderColor: colors.border,
              backgroundColor: colors.buttonInactive,
              color: colors.text,
            },
          ]}
          value={notes ?? ''}
          onChangeText={text => setValue('notes', text, { shouldDirty: true })}
          placeholder={t('matchCreation.fields.notesPlaceholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          maxLength={500}
        />
        <Text size="xs" color={colors.textMuted} style={styles.characterCount}>
          {notes?.length ?? 0}/500
        </Text>
      </View>
    </SheetScrollView>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
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
  privateVisibilityToggles: {
    gap: spacingPixels[2],
  },
  privateVisibilityToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  costInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  costInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    // Vertical padding belongs to the input so the whole box is tappable.
    paddingVertical: spacingPixels[4],
    paddingHorizontal: 0,
  },
  errorText: {
    marginTop: spacingPixels[1],
  },
  toggleTextContainer: {
    flex: 1,
  },
  formatRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  optionsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  optionHint: {
    marginTop: spacingPixels[2],
  },
  sectionHeader: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[4],
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
  },
  notesInput: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 100,
  },
  characterCount: {
    textAlign: 'right',
    marginTop: spacingPixels[1],
  },
  // Rating picker styles
  fieldDescription: {
    marginBottom: spacingPixels[3],
  },
  loadingContainer: {
    padding: spacingPixels[4],
    alignItems: 'center',
  },
  ratingScrollContent: {
    gap: spacingPixels[2],
    paddingRight: spacingPixels[2],
    paddingTop: spacingPixels[3],
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
  yourRatingBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});

export default PreferencesStep;
