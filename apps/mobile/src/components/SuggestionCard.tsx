/**
 * SuggestionCard — single-slot card for the 7-day grid.
 *
 * One card = one (opponent, facility, slot) triplet. Tapping the CTA fires
 * the invite for that exact slot.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
  Image,
  Animated,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral, base } from '@rallia/design-system';
import { TIER_CONFIGS } from '@rallia/shared-services';
import type { ReputationDisplay, SlotSuggestion } from '@rallia/shared-services';
import {
  getProfilePictureUrl,
  lightHaptic,
  formatIntuitiveDateInTimezone,
} from '@rallia/shared-utils';

import * as Analytics from '#/services/analytics';
import type { SuggestionSource } from '#/services/analytics';
import { useNavigateToPlayerProfile } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';

import RatingBadge from './RatingBadge';
import ReputationBadge from './ReputationBadge';
import { RotatedCourtIcon } from './RotatedCourtIcon';

export type InviteState = 'idle' | 'sending' | 'sent';

export interface SuggestionCardColors {
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonTextActive: string;
}

export interface InvitePayload {
  suggestion: SlotSuggestion;
}

export interface SuggestionCardLabels {
  unknownPlayer: string;
  sendInvite: string;
  inviteSent: string;
  today: string;
  tomorrow: string;
  singles: string;
  free: string;
  competitive: string;
  casual: string;
  /** Court availability label — `{count}` is replaced with the number of bookable courts. */
  courtsAvailable: string;
}

export interface SuggestionCardProps {
  suggestion: SlotSuggestion;
  colors: SuggestionCardColors;
  isDark: boolean;
  labels: SuggestionCardLabels;
  locale?: string;
  onSendInvite?: (payload: InvitePayload) => void;
  disabled?: boolean;
  inviteState?: InviteState;
  /** Where this card is rendered — used for analytics breakdowns. */
  source?: SuggestionSource;
  /** Sport context for analytics (when known by the parent surface). */
  sportId?: string;
  sportName?: string;
  /**
   * Caller's preferred match type — drives the casual/competitive default
   * applied when the invite is accepted. Omitted or 'both' hides the chip.
   */
  defaultMatchType?: 'competitive' | 'casual' | 'both';
  /** Disable when the parent surface owns viewability-gated impressions. */
  trackImpressionOnMount?: boolean;
}

function buildReputationDisplay(s: SlotSuggestion): ReputationDisplay | undefined {
  const tier = s.opponentReputationTier as keyof typeof TIER_CONFIGS;
  if (!tier || tier === 'unknown') return undefined;
  const config = TIER_CONFIGS[tier];
  if (!config) return undefined;
  return {
    tier,
    score: s.opponentReputationScore ?? 0,
    isVisible: true,
    tierLabel: config.label,
    tierColor: config.color,
    tierIcon: config.icon,
  };
}

function formatHour(hour: number, locale: string): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return formatTimeOfDay(date, locale);
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  colors,
  isDark,
  labels,
  locale = 'en-US',
  onSendInvite,
  disabled,
  inviteState = 'idle',
  source,
  sportId,
  sportName,
  defaultMatchType,
  trackImpressionOnMount = true,
}) => {
  // Mount-based impression for surfaces where mounting ≈ visible (suggestion
  // sheet, onboarding). Feed surfaces pass trackImpressionOnMount={false} and
  // own viewability-gated impressions themselves.
  useEffect(() => {
    if (!source || !trackImpressionOnMount) return;
    Analytics.matchSuggestionShown(
      Analytics.buildSuggestionEventProps(suggestion, source, sportId, sportName)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const slotStart = useMemo(
    () =>
      suggestion.slot.datetime instanceof Date
        ? suggestion.slot.datetime
        : new Date(suggestion.slot.datetime),
    [suggestion.slot.datetime]
  );
  const slotEnd = useMemo(
    () =>
      suggestion.slot.endDatetime instanceof Date
        ? suggestion.slot.endDatetime
        : new Date(suggestion.slot.endDatetime),
    [suggestion.slot.endDatetime]
  );

  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  const handleAvatarPress = useCallback(() => {
    if (!suggestion.opponentId) return;
    lightHaptic();
    if (source) {
      Analytics.matchSuggestionAvatarTapped(
        Analytics.buildSuggestionEventProps(suggestion, source, sportId, sportName)
      );
    }
    navigateToPlayerProfile(suggestion.opponentId, sportId);
  }, [navigateToPlayerProfile, suggestion, sportId, sportName, source]);

  const cardScaleAnimation = useMemo(() => new Animated.Value(1), []);
  const handlePressIn = () => {
    Animated.spring(cardScaleAnimation, {
      toValue: 0.975,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  };
  const handlePressOut = () => {
    Animated.spring(cardScaleAnimation, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  const handleSendInvite = useCallback(() => {
    if (!onSendInvite) return;
    lightHaptic();
    onSendInvite({ suggestion });
  }, [suggestion, onSendInvite]);

  const opponentName = (() => {
    const first = (suggestion.opponentFirstName ?? '').trim();
    const last = (suggestion.opponentLastName ?? '').trim();
    const full = `${first} ${last}`.trim();
    if (!full) return labels.unknownPlayer;
    // The opponent row shares space with the rating + reputation badges, so
    // long full names get squeezed. Fall back to first name once the combined
    // string exceeds what realistically fits on a single line.
    if (full.length > 16 && first) return first;
    return full;
  })();
  const reputationDisplay = buildReputationDisplay(suggestion);

  const dateLabel = useMemo(() => {
    const key = localDateKey(slotStart);
    const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = formatIntuitiveDateInTimezone(key, deviceTz, locale);
    if (result.type === 'today') return labels.today;
    if (result.type === 'tomorrow') return labels.tomorrow;
    return result.label;
  }, [slotStart, locale, labels]);

  const startTimeText = formatTimeOfDay(slotStart, locale);
  const durationText = (() => {
    let mins = Math.round((slotEnd.getTime() - slotStart.getTime()) / 60000);
    if (mins <= 0) mins += 24 * 60;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
  })();
  const TIME_SEPARATOR = ' • ';
  const matchStyleTimeLabel = [dateLabel, startTimeText, durationText].join(TIME_SEPARATOR);

  // Styling
  const tierAccent = isDark ? primary[400] : primary[500];
  const cardBg = isDark ? primary[950] : primary[50];
  const borderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const courtGreen = isDark ? '#4ADE80' : '#16A34A';

  // Default match-attribute chips, mirroring MatchCard's badge row. These
  // reflect what the match becomes when the invite is accepted (singles,
  // caller's match-type pref, court not booked → free).
  const chipBg = isDark ? `${primary[400]}30` : `${primary[500]}15`;
  const chipFg = tierAccent;
  const defaultChips: Array<{
    key: string;
    label: string;
    icon?: keyof typeof Ionicons.glyphMap;
    courtIcon?: boolean;
  }> = [{ key: 'format', label: labels.singles, icon: 'person-outline' }];
  if (defaultMatchType === 'competitive') {
    defaultChips.push({ key: 'matchType', label: labels.competitive, icon: 'trophy' });
  } else if (defaultMatchType === 'casual') {
    defaultChips.push({ key: 'matchType', label: labels.casual, icon: 'happy' });
  }
  const availableCourts = suggestion.slot.availableCourts;
  if (availableCourts !== undefined && availableCourts > 0) {
    defaultChips.push({
      key: 'courts',
      label: labels.courtsAvailable.replace('{count}', String(availableCourts)),
      courtIcon: true,
    });
  }

  const canSend = inviteState === 'idle' && !disabled;
  const isSending = inviteState === 'sending';

  return (
    <Animated.View style={{ transform: [{ scale: cardScaleAnimation }] }}>
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
        <View style={styles.content}>
          {/* Time row */}
          <View style={styles.timeRow}>
            <Ionicons name="calendar-outline" size={16} color={tierAccent} />
            <Text
              size="base"
              weight="bold"
              color={colors.text}
              numberOfLines={1}
              style={styles.timeText}
            >
              {matchStyleTimeLabel}
            </Text>
          </View>

          {/* Location row */}
          <View style={styles.locationRow}>
            <Ionicons name="location" size={14} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} numberOfLines={1} style={styles.locationText}>
              {suggestion.facility.facilityName}
            </Text>
          </View>

          {/* Opponent row */}
          <View style={styles.opponentRow}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleAvatarPress}
              accessibilityRole="button"
              accessibilityLabel={opponentName}
              hitSlop={8}
              style={[styles.avatar, { borderColor: tierAccent }]}
            >
              {suggestion.opponentAvatar ? (
                <Image
                  source={{ uri: getProfilePictureUrl(suggestion.opponentAvatar) ?? '' }}
                  style={styles.avatarImage}
                />
              ) : (
                <View
                  style={[
                    styles.avatarPlaceholder,
                    { backgroundColor: isDark ? neutral[700] : neutral[200] },
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={20}
                    color={isDark ? neutral[400] : neutral[500]}
                  />
                </View>
              )}
            </TouchableOpacity>
            <View style={styles.opponentInfo}>
              <Text
                size="base"
                weight="bold"
                color={colors.text}
                numberOfLines={1}
                style={styles.opponentName}
              >
                {opponentName}
              </Text>
              <RatingBadge
                ratingValue={suggestion.opponentRatingScoreValue}
                ratingLabel={suggestion.opponentRatingLabel}
                certificationStatus={
                  suggestion.opponentBadgeStatus as
                    | 'self_declared'
                    | 'certified'
                    | 'disputed'
                    | null
                }
                isDark={isDark}
                size="sm"
              />
              <ReputationBadge reputationDisplay={reputationDisplay} isDark={isDark} size="sm" />
            </View>
          </View>

          {/* Default attribute chips — mirrors MatchCard's badge row */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            style={styles.chipsScroll}
            contentContainerStyle={styles.chipsContent}
          >
            {defaultChips.map(chip => (
              <View key={chip.key} style={[styles.chip, { backgroundColor: chipBg }]}>
                {chip.courtIcon ? (
                  <RotatedCourtIcon size={12} color={chipFg} style={styles.chipIcon} />
                ) : (
                  <Ionicons name={chip.icon!} size={10} color={chipFg} style={styles.chipIcon} />
                )}
                <Text size="xs" weight="semibold" color={chipFg}>
                  {chip.label}
                </Text>
              </View>
            ))}
          </ScrollView>

          {/* CTA */}
          {onSendInvite && (
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              {inviteState === 'sent' ? (
                <View style={[styles.ctaButton, { backgroundColor: `${courtGreen}20` }]}>
                  <Ionicons
                    name="checkmark-circle"
                    size={14}
                    color={courtGreen}
                    style={styles.ctaIconLeft}
                  />
                  <Text size="sm" weight="bold" color={courtGreen}>
                    {labels.inviteSent}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.ctaButton,
                    { backgroundColor: isDark ? primary[400] : primary[500] },
                  ]}
                  onPress={handleSendInvite}
                  onPressIn={canSend ? handlePressIn : undefined}
                  onPressOut={canSend ? handlePressOut : undefined}
                  activeOpacity={canSend ? 0.8 : 1}
                  disabled={disabled || isSending}
                >
                  {isSending && (
                    <ActivityIndicator
                      size="small"
                      color={base.white}
                      style={StyleSheet.absoluteFill}
                    />
                  )}
                  <Ionicons
                    name="send-outline"
                    size={14}
                    color={base.white}
                    style={[styles.ctaIconLeft, isSending && styles.invisible]}
                  />
                  <Text
                    size="sm"
                    weight="bold"
                    color={base.white}
                    style={isSending ? styles.invisible : undefined}
                  >
                    {labels.sendInvite}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
};

// Re-export formatHour as it was previously used — kept for any external callers.
export { formatHour };

const SLOT_SIZE = 32;

const styles = StyleSheet.create({
  card: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 5,
    marginBottom: spacingPixels[3],
    minHeight: 244,
  },
  content: {
    padding: spacingPixels[4],
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
    gap: spacingPixels[1.5],
  },
  timeText: {
    flexShrink: 1,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
    gap: spacingPixels[1.5],
  },
  locationText: {
    flexShrink: 1,
  },
  opponentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  avatar: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarImage: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  opponentInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacingPixels[3],
    gap: spacingPixels[1.5],
  },
  opponentName: {
    flexShrink: 1,
  },
  chipsScroll: {
    marginBottom: spacingPixels[3],
  },
  chipsContent: {
    flexDirection: 'row',
    gap: spacingPixels[1.5],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  chipIcon: {
    marginRight: spacingPixels[1],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    flex: 1,
    minHeight: 36,
  },
  ctaIconLeft: {
    marginRight: spacingPixels[1],
  },
  invisible: {
    opacity: 0,
  },
});

export default SuggestionCard;
