/**
 * Preferences Step
 *
 * Step 3 of the match creation wizard.
 * Handles court cost, visibility, join mode, and notes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Linking,
  Keyboard,
  Platform,
  ScrollView,
} from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { UseFormReturn } from 'react-hook-form';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useRatingScoresForSport, useFacilityReservationContact } from '@rallia/shared-hooks';
import type { MatchFormSchemaData } from '@rallia/shared-types';
import type { TranslationKey, TranslationOptions } from '../../../../hooks/useTranslation';

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

interface OptionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  colors: PreferencesStepProps['colors'];
  compact?: boolean;
}

// =============================================================================
// OPTION CARD COMPONENT
// =============================================================================

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
      // Compact layout: icon on top, title below
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
      // Full layout: icon + text side by side
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

// =============================================================================
// RESERVATION CONTACT ALERT COMPONENT
// =============================================================================

interface ReservationContactAlertProps {
  phone: string | null;
  email: string | null;
  website: string | null;
  colors: PreferencesStepProps['colors'];
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  isDark: boolean;
}

const ReservationContactAlert: React.FC<ReservationContactAlertProps> = ({
  phone,
  email,
  website,
  colors,
  t,
  isDark,
}) => {
  // Use accent color (amber/gold) for distinct alert styling
  const alertColor = isDark ? accent[400] : accent[600];
  const alertBgColor = isDark ? `${accent[500]}15` : accent[50];
  const alertTextColor = isDark ? accent[200] : accent[800];
  const buttonBgColor = isDark ? accent[500] : accent[600];

  const handleCall = () => {
    if (phone) {
      lightHaptic();
      Linking.openURL(`tel:${phone}`);
    }
  };

  const handleEmail = () => {
    if (email) {
      lightHaptic();
      Linking.openURL(`mailto:${email}`);
    }
  };

  const handleWebsite = () => {
    if (website) {
      lightHaptic();
      // Ensure website has protocol
      const url = website.startsWith('http') ? website : `https://${website}`;
      Linking.openURL(url);
    }
  };

  return (
    <View
      style={[styles.reservationAlert, { backgroundColor: alertBgColor, borderColor: alertColor }]}
    >
      <View style={styles.reservationAlertHeader}>
        <Ionicons name="calendar-outline" size={20} color={alertColor} />
        <Text size="base" weight="semibold" color={alertColor}>
          {t('matchCreation.fields.reservationContactTitle')}
        </Text>
      </View>
      <Text size="sm" color={alertTextColor} style={styles.reservationAlertDescription}>
        {t('matchCreation.fields.reservationContactDescription')}
      </Text>
      <View style={styles.reservationAlertActions}>
        {phone && (
          <TouchableOpacity
            style={[styles.reservationActionButton, { backgroundColor: buttonBgColor }]}
            onPress={handleCall}
            activeOpacity={0.8}
          >
            <Ionicons name="call-outline" size={16} color={colors.buttonTextActive} />
            <Text size="sm" weight="semibold" color={colors.buttonTextActive}>
              {t('matchCreation.fields.callFacility')}
            </Text>
          </TouchableOpacity>
        )}
        {email && (
          <TouchableOpacity
            style={[styles.reservationActionButton, { backgroundColor: buttonBgColor }]}
            onPress={handleEmail}
            activeOpacity={0.8}
          >
            <Ionicons name="mail-outline" size={16} color={colors.buttonTextActive} />
            <Text size="sm" weight="semibold" color={colors.buttonTextActive}>
              {t('matchCreation.fields.emailFacility')}
            </Text>
          </TouchableOpacity>
        )}
        {website && (
          <TouchableOpacity
            style={[styles.reservationActionButton, { backgroundColor: buttonBgColor }]}
            onPress={handleWebsite}
            activeOpacity={0.8}
          >
            <Ionicons name="globe-outline" size={16} color={colors.buttonTextActive} />
            <Text size="sm" weight="semibold" color={colors.buttonTextActive}>
              {t('matchCreation.fields.visitWebsite')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
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
  const { watch, setValue } = form;

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
  const courtStatus = watch('courtStatus');
  const locationType = watch('locationType');
  const facilityId = watch('facilityId');
  const locationName = watch('locationName');

  // Check if a location has been specified (facility selected or custom location entered)
  const hasLocationSpecified =
    (locationType === 'facility' && !!facilityId) || (locationType === 'custom' && !!locationName);

  // Fetch rating scores for the sport (also returns player's current rating)
  const {
    ratingScores,
    isLoading: isLoadingRatings,
    hasRatingSystem,
    playerRatingScoreId,
  } = useRatingScoresForSport(sportName, sportId, userId);

  // Fetch reservation contact for the selected facility
  const { contact: reservationContact, hasContact: hasReservationContact } =
    useFacilityReservationContact(locationType === 'facility' ? facilityId : undefined, sportId);

  // Determine if we should show the reservation contact alert
  // Show only when: facility is selected, court status is 'to_book', and contact exists
  const showReservationContactAlert =
    locationType === 'facility' &&
    !!facilityId &&
    (courtStatus === 'to_book' || !courtStatus) &&
    hasReservationContact;

  // Track if we've set the default rating to avoid overwriting user selection
  const hasSetDefaultRating = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrollViewRef = useRef<any>(null);
  const notesFieldRef = useRef<View>(null);
  const ratingScrollRef = useRef<ScrollView>(null);
  const [ratingScrollViewWidth, setRatingScrollViewWidth] = useState(0);

  // Keyboard handling state for Android
  const [focusedField, setFocusedField] = useState<'cost' | 'notes' | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Handle keyboard show/hide for scrolling to focused field
  useEffect(() => {
    const keyboardShowEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const keyboardHideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(keyboardShowEvent, e => {
      setKeyboardHeight(e.endCoordinates.height);
      // Scroll to focused field when keyboard appears
      if (focusedField && scrollViewRef.current) {
        setTimeout(() => {
          // Scroll positions for each field
          const scrollPositions = {
            cost: 300, // Cost field is in the upper middle
            notes: 600, // Notes field is at the bottom
          };
          const targetY = scrollPositions[focusedField] || 0;
          scrollViewRef.current?.scrollTo?.({ y: targetY, animated: true });
        }, 100);
      }
    });

    const hideSubscription = Keyboard.addListener(keyboardHideEvent, () => {
      setKeyboardHeight(0);
      setFocusedField(null);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [focusedField]);

  // Reset the ref when minRatingScoreId becomes undefined (form reset)
  // and set player's rating as default when appropriate
  useEffect(() => {
    // Reset ref when minRatingScoreId becomes undefined (form reset)
    if (!minRatingScoreId) {
      hasSetDefaultRating.current = false;
    }

    // Set player's rating as default when loaded (only once, after ref reset)
    if (playerRatingScoreId && !hasSetDefaultRating.current && !minRatingScoreId) {
      setValue('minRatingScoreId', playerRatingScoreId, { shouldDirty: false });
      hasSetDefaultRating.current = true;
    }
  }, [playerRatingScoreId, minRatingScoreId, setValue]);

  // Set default court status to 'to_book' when location is specified and status is not set
  useEffect(() => {
    if (hasLocationSpecified && !courtStatus) {
      setValue('courtStatus', 'to_book', { shouldDirty: false });
    }
  }, [hasLocationSpecified, courtStatus, setValue]);

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
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
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
        <View style={styles.optionsColumn}>
          <OptionCard
            icon="cafe-outline"
            title={t('matchCreation.fields.playerExpectationCasual')}
            description={t('matchCreation.fields.playerExpectationCasualDescription')}
            selected={playerExpectation === 'casual'}
            onPress={() =>
              setValue('playerExpectation', 'casual', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
          />
          <OptionCard
            icon="trophy-outline"
            title={t('matchCreation.fields.playerExpectationCompetitive')}
            description={t('matchCreation.fields.playerExpectationCompetitiveDescription')}
            selected={playerExpectation === 'competitive'}
            onPress={() =>
              setValue('playerExpectation', 'competitive', {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
            colors={colors}
          />
          <OptionCard
            icon="hand-left-outline"
            title={t('matchCreation.fields.playerExpectationBoth')}
            description={t('matchCreation.fields.playerExpectationBothDescription')}
            selected={playerExpectation === 'both'}
            onPress={() =>
              setValue('playerExpectation', 'both', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
          />
        </View>
      </View>

      {/* Reservation contact alert (show when facility selected and court needs booking) */}
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

      {/* Court booking status (only show if location is specified) */}
      {hasLocationSpecified && (
        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('matchCreation.fields.courtStatus')}
          </Text>
          <View style={styles.optionsColumn}>
            <OptionCard
              icon="calendar-outline"
              title={t('matchCreation.fields.courtStatusToBook')}
              description={t('matchCreation.fields.courtStatusToBookDescription')}
              selected={courtStatus === 'to_book' || !courtStatus}
              onPress={() =>
                setValue('courtStatus', 'to_book', { shouldValidate: true, shouldDirty: true })
              }
              colors={colors}
            />
            <OptionCard
              icon="checkmark-circle-outline"
              title={t('matchCreation.fields.courtStatusBooked')}
              description={t('matchCreation.fields.courtStatusBookedDescription')}
              selected={courtStatus === 'booked'}
              onPress={() =>
                setValue('courtStatus', 'booked', { shouldValidate: true, shouldDirty: true })
              }
              colors={colors}
            />
          </View>
        </View>
      )}

      {/* Court cost toggle - hide for TBD locations */}
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

      {/* Cost options (only if not free and not TBD location) */}
      {!isCourtFree && locationType !== 'tbd' && (
        <>
          {/* Estimated cost input */}
          <View style={styles.fieldGroup}>
            <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
              {costSplitType === 'equal'
                ? t('matchCreation.fields.estimatedCostTotalEqual')
                : t('matchCreation.fields.estimatedCostTotalCreator')}
            </Text>
            <View
              style={[
                styles.costInputContainer,
                { borderColor: colors.border, backgroundColor: colors.cardBackground },
              ]}
            >
              <Text size="base" weight="medium" color={colors.textMuted}>
                $
              </Text>
              <BottomSheetTextInput
                style={[styles.costInput, { color: colors.text }]}
                value={estimatedCost?.toString() ?? ''}
                onChangeText={text => {
                  const numValue = parseFloat(text.replace(/[^0-9.]/g, ''));
                  setValue('estimatedCost', isNaN(numValue) ? undefined : numValue, {
                    shouldDirty: true,
                  });
                }}
                placeholder={t('matchCreation.fields.estimatedCostPlaceholderTotal')}
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                onFocus={() => setFocusedField('cost')}
              />
            </View>
            {costSplitType === 'equal' && typeof estimatedCost === 'number' && (
              <Text size="xs" color={colors.textMuted} style={styles.costHelperText}>
                {(() => {
                  const playerCount = format === 'doubles' ? 4 : 2;
                  const perPerson = Math.ceil(estimatedCost / playerCount);
                  return (
                    t('matchCreation.fields.estimatedCostHelper', {
                      amount: perPerson,
                      count: playerCount,
                    }) || `Per person: ~$${perPerson} (estimated for ${playerCount} players)`
                  );
                })()}
              </Text>
            )}
          </View>

          {/* Cost split type */}
          <View style={styles.fieldGroup}>
            <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
              {t('matchCreation.fields.costSplitType')}
            </Text>
            <View style={styles.optionsColumn}>
              <OptionCard
                icon="people-outline"
                title={t('matchCreation.fields.costSplitEqual')}
                description={t('matchCreation.fields.costSplitEqualDescription')}
                selected={costSplitType === 'equal'}
                onPress={() =>
                  setValue('costSplitType', 'equal', { shouldValidate: true, shouldDirty: true })
                }
                colors={colors}
              />
              <OptionCard
                icon="person-outline"
                title={t('matchCreation.fields.costSplitCreator')}
                description={t('matchCreation.fields.costSplitCreatorDescription')}
                selected={costSplitType === 'creator_pays'}
                onPress={() =>
                  setValue('costSplitType', 'creator_pays', {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                colors={colors}
              />
            </View>
          </View>
        </>
      )}

      {/* Visibility options */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.visibility')}
        </Text>
        <View style={styles.optionsColumn}>
          <OptionCard
            icon="globe-outline"
            title={t('matchCreation.fields.visibilityPublic')}
            description={t('matchCreation.fields.visibilityPublicDescription')}
            selected={visibility === 'public'}
            onPress={() =>
              setValue('visibility', 'public', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
          />
          <OptionCard
            icon="lock-closed-outline"
            title={t('matchCreation.fields.visibilityPrivate')}
            description={t('matchCreation.fields.visibilityPrivateDescription')}
            selected={visibility === 'private'}
            onPress={() =>
              setValue('visibility', 'private', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
          />
        </View>
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
        <View style={styles.optionsColumn}>
          <OptionCard
            icon="flash-outline"
            title={t('matchCreation.fields.joinModeDirect')}
            description={t('matchCreation.fields.joinModeDirectDescription')}
            selected={joinMode === 'direct'}
            onPress={() =>
              setValue('joinMode', 'direct', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
          />
          <OptionCard
            icon="hand-right-outline"
            title={t('matchCreation.fields.joinModeRequest')}
            description={t('matchCreation.fields.joinModeRequestDescription')}
            selected={joinMode === 'request'}
            onPress={() =>
              setValue('joinMode', 'request', { shouldValidate: true, shouldDirty: true })
            }
            colors={colors}
          />
        </View>
      </View>

      {/* Opponent Preferences Section Header */}
      <View style={styles.sectionHeader}>
        <Text size="base" weight="bold" color={colors.text}>
          {t('matchCreation.fields.opponentPreferences')}
        </Text>
        <Text size="xs" color={colors.textMuted}>
          {t('matchCreation.fields.opponentPreferencesDescription')}
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
      <View ref={notesFieldRef} style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.notes')}
        </Text>
        <BottomSheetTextInput
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
          onFocus={() => setFocusedField('notes')}
        />
        <Text size="xs" color={colors.textMuted} style={styles.characterCount}>
          {notes?.length ?? 0}/500
        </Text>
      </View>
    </ScrollView>
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
    paddingBottom: spacingPixels[32], // Extra padding to allow scrolling above keyboard for notes field
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
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
  toggleTextContainer: {
    flex: 1,
  },
  optionsColumn: {
    gap: spacingPixels[2],
  },
  formatRow: {
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
  optionsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  sectionHeader: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[4],
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
  },
  costInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  costInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    padding: 0,
  },
  costHelperText: {
    marginTop: spacingPixels[1],
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
  // Reservation contact alert styles
  reservationAlert: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[5],
  },
  reservationAlertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  reservationAlertDescription: {
    marginBottom: spacingPixels[3],
  },
  reservationAlertActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  reservationActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
  },
});

export default PreferencesStep;
