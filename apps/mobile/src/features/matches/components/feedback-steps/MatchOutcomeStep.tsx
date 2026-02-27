/**
 * Match Outcome Step
 *
 * First step of the feedback wizard asking whether the match happened
 * or was mutually cancelled.
 */

import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { SportIcon } from '../../../../components/SportIcon';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, selectionHaptic, getProfilePictureUrl } from '@rallia/shared-utils';
import type {
  MatchOutcomeEnum,
  CancellationReasonEnum,
  OpponentForFeedback,
  MatchContextForFeedback,
} from '@rallia/shared-types';
import type { TranslationKey } from '../../../../hooks/useTranslation';

// =============================================================================
// TYPES
// =============================================================================

interface MatchOutcomeStepProps {
  /** Current outcome value */
  outcome: MatchOutcomeEnum | null;
  /** Current cancellation reason */
  cancellationReason: CancellationReasonEnum | null;
  /** Current cancellation notes */
  cancellationNotes: string;
  /** Callback when form values change */
  onOutcomeChange: (
    outcome: MatchOutcomeEnum | null,
    cancellationReason?: CancellationReasonEnum | null,
    cancellationNotes?: string
  ) => void;
  /** List of opponents for no-show selection */
  opponents: OpponentForFeedback[];
  /** Currently selected no-show player IDs */
  noShowPlayerIds: string[];
  /** Callback when no-show player selection changes */
  onNoShowPlayerIdsChange: (playerIds: string[]) => void;
  /** Match context for display (date, time, sport, location) */
  matchContext?: MatchContextForFeedback | null;
  /** Theme colors */
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
  /** Translation function */
  t: (key: TranslationKey, options?: Record<string, string | number>) => string;
  /** Current locale code */
  locale: string;
  /** Whether dark mode is active */
  isDark: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CANCELLATION_REASONS: Array<{
  value: CancellationReasonEnum;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}> = [
  {
    value: 'weather',
    icon: 'rainy-outline',
    labelKey: 'matchFeedback.cancellationReasons.weather',
  },
  {
    value: 'court_unavailable',
    icon: 'close-circle-outline',
    labelKey: 'matchFeedback.cancellationReasons.courtUnavailable',
  },
  {
    value: 'emergency',
    icon: 'warning-outline',
    labelKey: 'matchFeedback.cancellationReasons.emergency',
  },
  {
    value: 'other',
    icon: 'chatbox-ellipses-outline',
    labelKey: 'matchFeedback.cancellationReasons.other',
  },
];

// =============================================================================
// OPTION CARD COMPONENT
// =============================================================================

interface OptionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  colors: MatchOutcomeStepProps['colors'];
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
      selectionHaptic();
      onPress();
    }}
    activeOpacity={0.7}
  >
    <View style={styles.optionContent}>
      <Ionicons name={icon} size={24} color={selected ? colors.buttonActive : colors.textMuted} />
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
    {selected && <Ionicons name="checkmark-circle" size={24} color={colors.buttonActive} />}
  </TouchableOpacity>
);

// =============================================================================
// CANCELLATION REASON CARD
// =============================================================================

interface ReasonCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: MatchOutcomeStepProps['colors'];
}

const ReasonCard: React.FC<ReasonCardProps> = ({ icon, label, selected, onPress, colors }) => (
  <TouchableOpacity
    style={[
      styles.reasonCard,
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
    <Ionicons name={icon} size={20} color={selected ? colors.buttonActive : colors.textMuted} />
    <Text
      size="sm"
      weight={selected ? 'semibold' : 'regular'}
      color={selected ? colors.buttonActive : colors.text}
      style={styles.reasonLabel}
    >
      {label}
    </Text>
    {selected && <Ionicons name="checkmark-circle" size={18} color={colors.buttonActive} />}
  </TouchableOpacity>
);

// =============================================================================
// MATCH CONTEXT CARD (shows which match is being rated)
// =============================================================================

interface MatchContextCardProps {
  matchContext: MatchContextForFeedback;
  colors: MatchOutcomeStepProps['colors'];
  t: (key: TranslationKey, options?: Record<string, string | number>) => string;
  locale: string;
  isDark: boolean;
}

/**
 * Format a date for display using the current locale
 */
const formatMatchDate = (dateStr: string, locale: string): string => {
  const date = new Date(dateStr + 'T00:00:00'); // Ensure local timezone parsing
  // Convert locale code to BCP 47 format for toLocaleDateString
  const localeCode = locale === 'fr-CA' ? 'fr-CA' : 'en-US';
  return date.toLocaleDateString(localeCode, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Format time for display using the current locale
 */
const formatMatchTime = (timeStr: string, locale: string): string => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes);
  // Convert locale code to BCP 47 format for toLocaleTimeString
  const localeCode = locale === 'fr-CA' ? 'fr-CA' : 'en-US';
  // French uses 24-hour format, English uses 12-hour with AM/PM
  const isFrench = locale.startsWith('fr');
  return date.toLocaleTimeString(localeCode, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !isFrench,
  });
};

/**
 * Capitalize the first letter of a string
 */
const capitalizeFirst = (str: string): string => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

const MatchContextCard: React.FC<MatchContextCardProps> = ({
  matchContext,
  colors,
  t,
  locale,
  isDark,
}) => {
  const formattedDate = formatMatchDate(matchContext.matchDate, locale);
  const formattedTime = formatMatchTime(matchContext.startTime, locale);

  // Build location string
  const location = matchContext.facilityName
    ? matchContext.city
      ? `${matchContext.facilityName}, ${matchContext.city}`
      : matchContext.facilityName
    : matchContext.city || undefined;

  // Build opponent string using i18next interpolation
  const opponentDisplay =
    matchContext.opponentNames.length > 0
      ? matchContext.opponentNames.length === 1
        ? t('matchFeedback.matchContext.vsPlayer', {
            name: matchContext.opponentNames[0],
          })
        : t('matchFeedback.matchContext.vsPlayers', {
            names: matchContext.opponentNames.join(', '),
          })
      : undefined;

  // Translate format (singles/doubles)
  const translatedFormat =
    matchContext.format === 'singles'
      ? t('match.format.singles')
      : matchContext.format === 'doubles'
        ? t('match.format.doubles')
        : matchContext.format;

  return (
    <View
      style={[
        styles.matchContextCard,
        {
          backgroundColor: isDark ? `${colors.buttonActive}15` : `${colors.buttonActive}08`,
          borderColor: isDark ? `${colors.buttonActive}40` : `${colors.buttonActive}25`,
        },
      ]}
    >
      {/* Sport icon and name */}
      <View style={styles.matchContextHeader}>
        <View style={[styles.sportIconContainer, { backgroundColor: `${colors.buttonActive}20` }]}>
          <SportIcon sportName={matchContext.sportSlug} size={20} color={colors.buttonActive} />
        </View>
        <View style={styles.matchContextHeaderText}>
          <Text size="base" weight="bold" color={colors.text}>
            {capitalizeFirst(matchContext.sportName)}
            {matchContext.format && (
              <Text size="base" weight="regular" color={colors.textMuted}>
                {' '}
                · {translatedFormat}
              </Text>
            )}
          </Text>
          {opponentDisplay && (
            <Text size="sm" weight="semibold" color={colors.buttonActive}>
              {opponentDisplay}
            </Text>
          )}
        </View>
      </View>

      {/* Date, time, and location details */}
      <View style={styles.matchContextDetails}>
        <View style={styles.matchContextRow}>
          <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
          <Text size="sm" color={colors.text} style={styles.matchContextDetailText}>
            {formattedDate}
          </Text>
        </View>
        <View style={styles.matchContextRow}>
          <Ionicons name="time-outline" size={16} color={colors.textMuted} />
          <Text size="sm" color={colors.text} style={styles.matchContextDetailText}>
            {formattedTime}
          </Text>
        </View>
        {location && (
          <View style={styles.matchContextRow}>
            <Ionicons name="location-outline" size={16} color={colors.textMuted} />
            <Text
              size="sm"
              color={colors.text}
              style={styles.matchContextDetailText}
              numberOfLines={1}
            >
              {location}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

// =============================================================================
// PLAYER SELECT CARD (for no-show selection)
// =============================================================================

interface PlayerSelectCardProps {
  player: OpponentForFeedback;
  selected: boolean;
  onToggle: () => void;
  colors: MatchOutcomeStepProps['colors'];
}

const PlayerSelectCard: React.FC<PlayerSelectCardProps> = ({
  player,
  selected,
  onToggle,
  colors,
}) => {
  const avatarUrl = getProfilePictureUrl(player.avatarUrl);

  return (
    <TouchableOpacity
      style={[
        styles.playerCard,
        {
          backgroundColor: selected ? `${colors.buttonActive}15` : colors.buttonInactive,
          borderColor: selected ? colors.buttonActive : colors.border,
        },
      ]}
      onPress={() => {
        lightHaptic();
        onToggle();
      }}
      activeOpacity={0.7}
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.playerAvatar} />
      ) : (
        <View style={[styles.playerAvatarPlaceholder, { backgroundColor: colors.border }]}>
          <Ionicons name="person-outline" size={20} color={colors.textMuted} />
        </View>
      )}
      <Text
        size="base"
        weight={selected ? 'semibold' : 'regular'}
        color={selected ? colors.buttonActive : colors.text}
        style={styles.playerName}
      >
        {player.fullName}
      </Text>
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: selected ? colors.buttonActive : 'transparent',
            borderColor: selected ? colors.buttonActive : colors.border,
          },
        ]}
      >
        {selected && (
          <Ionicons name="checkmark-outline" size={16} color={colors.buttonTextActive} />
        )}
      </View>
    </TouchableOpacity>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const MatchOutcomeStep: React.FC<MatchOutcomeStepProps> = ({
  outcome,
  cancellationReason,
  cancellationNotes,
  onOutcomeChange,
  opponents,
  noShowPlayerIds,
  onNoShowPlayerIdsChange,
  matchContext,
  colors,
  t,
  locale,
  isDark,
}) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const reasonsSectionY = useRef<number>(0);

  const handleOutcomeChange = useCallback(
    (newOutcome: MatchOutcomeEnum) => {
      onOutcomeChange(newOutcome, null, '');
      // Clear no-show selection when changing outcome, or auto-select if singles
      if (newOutcome !== 'opponent_no_show') {
        onNoShowPlayerIdsChange([]);
      } else if (newOutcome === 'opponent_no_show' && opponents.length === 1) {
        // Auto-select the only opponent for singles matches
        onNoShowPlayerIdsChange([opponents[0].playerId]);
      }

      // Auto-scroll to reveal the sub-section when cancellation or no-show is selected
      if (newOutcome === 'mutual_cancel' || newOutcome === 'opponent_no_show') {
        // Small delay to let the section render before scrolling
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({ y: reasonsSectionY.current, animated: true });
        }, 100);
      }
    },
    [onOutcomeChange, onNoShowPlayerIdsChange, opponents]
  );

  const handleCancellationReasonChange = useCallback(
    (reason: CancellationReasonEnum) => {
      onOutcomeChange(outcome, reason, reason === 'other' ? cancellationNotes : '');
    },
    [onOutcomeChange, outcome, cancellationNotes]
  );

  const handleCancellationNotesChange = useCallback(
    (notes: string) => {
      onOutcomeChange(outcome, cancellationReason, notes);
    },
    [onOutcomeChange, outcome, cancellationReason]
  );

  const handlePlayerToggle = useCallback(
    (playerId: string) => {
      if (noShowPlayerIds.includes(playerId)) {
        onNoShowPlayerIdsChange(noShowPlayerIds.filter(id => id !== playerId));
      } else {
        onNoShowPlayerIdsChange([...noShowPlayerIds, playerId]);
      }
    },
    [noShowPlayerIds, onNoShowPlayerIdsChange]
  );

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Match Context Card - shows which match is being rated */}
      {matchContext && (
        <MatchContextCard
          matchContext={matchContext}
          colors={colors}
          t={t}
          locale={locale}
          isDark={isDark}
        />
      )}

      {/* Title */}
      <View style={styles.header}>
        <Text size="xl" weight="bold" color={colors.text}>
          {t('matchFeedback.outcomeStep.title')}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
          {t('matchFeedback.outcomeStep.subtitle')}
        </Text>
      </View>

      {/* Outcome Options */}
      <View
        style={styles.optionsContainer}
        onLayout={e => {
          const { y, height } = e.nativeEvent.layout;
          reasonsSectionY.current = y + height;
        }}
      >
        <OptionCard
          icon="checkmark-circle-outline"
          title={t('matchFeedback.outcomeStep.matchPlayed')}
          description={
            opponents.length === 1
              ? t('matchFeedback.outcomeStep.matchPlayedDescription')
              : t('matchFeedback.outcomeStep.matchPlayedDescriptionPlural')
          }
          selected={outcome === 'played'}
          onPress={() => handleOutcomeChange('played')}
          colors={colors}
        />
        <OptionCard
          icon="close-circle-outline"
          title={t('matchFeedback.outcomeStep.matchCancelled')}
          description={t('matchFeedback.outcomeStep.matchCancelledDescription')}
          selected={outcome === 'mutual_cancel'}
          onPress={() => handleOutcomeChange('mutual_cancel')}
          colors={colors}
        />
        <OptionCard
          icon="person-remove-outline"
          title={
            opponents.length === 1
              ? t('matchFeedback.outcomeStep.missingPlayer')
              : t('matchFeedback.outcomeStep.missingPlayers')
          }
          description={
            opponents.length === 1
              ? t('matchFeedback.outcomeStep.missingPlayerDescription')
              : t('matchFeedback.outcomeStep.missingPlayersDescription')
          }
          selected={outcome === 'opponent_no_show'}
          onPress={() => handleOutcomeChange('opponent_no_show')}
          colors={colors}
        />
      </View>

      {/* No-show player selection (only for doubles - singles auto-selects the only opponent) */}
      {outcome === 'opponent_no_show' && opponents.length > 1 && (
        <View style={styles.reasonsSection}>
          <Text
            size="sm"
            weight="semibold"
            color={colors.textSecondary}
            style={styles.reasonsLabel}
          >
            {t('matchFeedback.outcomeStep.selectNoShowPlayers')}
          </Text>
          <View style={styles.playersGrid}>
            {opponents.map(opponent => (
              <PlayerSelectCard
                key={opponent.playerId}
                player={opponent}
                selected={noShowPlayerIds.includes(opponent.playerId)}
                onToggle={() => handlePlayerToggle(opponent.playerId)}
                colors={colors}
              />
            ))}
          </View>
        </View>
      )}

      {/* Cancellation Reasons (only if cancelled selected) */}
      {outcome === 'mutual_cancel' && (
        <View style={styles.reasonsSection}>
          <Text
            size="sm"
            weight="semibold"
            color={colors.textSecondary}
            style={styles.reasonsLabel}
          >
            {t('matchFeedback.outcomeStep.whyCancelled')}
          </Text>
          <View style={styles.reasonsGrid}>
            {CANCELLATION_REASONS.map(reason => (
              <ReasonCard
                key={reason.value}
                icon={reason.icon}
                label={t(reason.labelKey as TranslationKey)}
                selected={cancellationReason === reason.value}
                onPress={() => handleCancellationReasonChange(reason.value)}
                colors={colors}
              />
            ))}
          </View>

          {/* Other reason text input */}
          {cancellationReason === 'other' && (
            <View style={styles.notesContainer}>
              <BottomSheetTextInput
                style={[
                  styles.notesInput,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.buttonInactive,
                    color: colors.text,
                  },
                ]}
                value={cancellationNotes}
                onChangeText={handleCancellationNotesChange}
                placeholder={t('matchFeedback.outcomeStep.otherReasonPlaceholder')}
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
                maxLength={200}
              />
            </View>
          )}
        </View>
      )}
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
    paddingBottom: spacingPixels[4],
  },
  // Match Context Card styles
  matchContextCard: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[5],
  },
  matchContextHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[3],
  },
  sportIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchContextHeaderText: {
    flex: 1,
    gap: spacingPixels[0.5] ?? 2,
  },
  matchContextDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[3],
    marginTop: spacingPixels[1],
  },
  matchContextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  matchContextDetailText: {
    marginLeft: 2,
  },
  header: {
    marginBottom: spacingPixels[6],
  },
  subtitle: {
    marginTop: spacingPixels[1],
  },
  optionsContainer: {
    gap: spacingPixels[3],
    marginBottom: spacingPixels[6],
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
  reasonsSection: {
    marginBottom: spacingPixels[6],
  },
  reasonsLabel: {
    marginBottom: spacingPixels[3],
  },
  reasonsGrid: {
    gap: spacingPixels[2],
  },
  reasonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  reasonLabel: {
    flex: 1,
    flexShrink: 1, // Allow text to shrink if needed
  },
  notesContainer: {
    marginTop: spacingPixels[3],
  },
  notesInput: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  playersGrid: {
    gap: spacingPixels[2],
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  playerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  playerAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerName: {
    flex: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MatchOutcomeStep;
