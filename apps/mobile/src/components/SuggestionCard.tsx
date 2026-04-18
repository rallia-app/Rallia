/**
 * SuggestionCard Component — Interactive
 *
 * Displays a match suggestion with:
 * - Opponent info (name, rating badge, reputation badge)
 * - Facility selector (inline chips when 2+ facilities)
 * - Time selector (period chips → hour chips with court availability)
 * - "Send Game Invite" CTA (disabled until time selected)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
  Image,
  Animated,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import RNAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral, base } from '@rallia/design-system';
import { TIER_CONFIGS } from '@rallia/shared-services';
import type { ReputationDisplay } from '@rallia/shared-services';
import type {
  MatchSuggestion,
  SuggestionFacility,
  AvailableTimeSlot,
  OverlapSlot,
} from '@rallia/shared-services';
import { lightHaptic, formatIntuitiveDateInTimezone } from '@rallia/shared-utils';
import RatingBadge from './RatingBadge';
import ReputationBadge from './ReputationBadge';

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
  suggestion: MatchSuggestion;
  selectedFacility: SuggestionFacility;
  selectedTime: Date;
  selectedEndTime: Date | null;
}

export interface SuggestionCardLabels {
  facility: string;
  when: string;
  noAvailableTimes: string;
  unknownPlayer: string;
  sendInvite: string;
  inviteSent: string;
  periodMorning: string;
  periodAfternoon: string;
  periodEvening: string;
  today: string;
  tomorrow: string;
  selectDate: string;
  selectTime: string;
}

export interface SuggestionCardProps {
  suggestion: MatchSuggestion;
  colors: SuggestionCardColors;
  isDark: boolean;
  labels: SuggestionCardLabels;
  locale?: string;
  onSendInvite?: (payload: InvitePayload) => void;
  disabled?: boolean;
  inviteState?: InviteState;
}

// =============================================================================
// HELPERS
// =============================================================================

function buildReputationDisplay(suggestion: MatchSuggestion): ReputationDisplay | undefined {
  const tier = suggestion.opponentReputationTier as keyof typeof TIER_CONFIGS;
  if (!tier || tier === 'unknown') return undefined;
  const config = TIER_CONFIGS[tier];
  if (!config) return undefined;
  return {
    tier,
    score: suggestion.opponentReputationScore ?? 0,
    isVisible: true,
    tierLabel: config.label,
    tierColor: config.color,
    tierIcon: config.icon,
  };
}

function formatHour(hour: number, locale: string): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** Get the day-of-week string for a Date */
function getDayOfWeek(date: Date): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[date.getDay()];
}

/** Get the period string for an hour */
function hourToPeriod(hour: number): string | null {
  if (hour >= 8 && hour <= 12) return 'morning';
  if (hour >= 13 && hour <= 17) return 'afternoon';
  if (hour >= 18 && hour <= 21) return 'evening';
  return null;
}

// =============================================================================
// LIVE DOT (flashing red indicator for real-time availability)
// =============================================================================

const LIVE_RED = '#EF4444';

const LiveDot: React.FC = () => {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <RNAnimated.View style={[styles.liveDot, animStyle]} />;
};

// =============================================================================
// COMPONENT
// =============================================================================

export const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  colors,
  isDark,
  labels,
  locale = 'en-US',
  onSendInvite,
  disabled,
  inviteState = 'idle',
}) => {
  // ── Local selection state ──────────────────────────────────────────
  const [selectedFacilityIndex, setSelectedFacilityIndex] = useState(0);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null); // e.g. "2026-04-17"
  const [selectedTime, setSelectedTime] = useState<Date | null>(null);
  const [selectedEndTime, setSelectedEndTime] = useState<Date | null>(null);

  const selectedFacility = suggestion.facilities[selectedFacilityIndex];

  // ── Press animation ────────────────────────────────────────────────
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

  // ── Handlers ───────────────────────────────────────────────────────
  const handleFacilitySelect = useCallback((index: number) => {
    lightHaptic();
    setSelectedFacilityIndex(index);
    setSelectedTime(null);
    setSelectedEndTime(null);
  }, []);

  const handleDateSelect = useCallback((dateKey: string) => {
    lightHaptic();
    setSelectedDateKey(dateKey);
    setSelectedTime(null);
    setSelectedEndTime(null);
  }, []);

  const handleTimeSelect = useCallback((slot: AvailableTimeSlot) => {
    lightHaptic();
    setSelectedTime(new Date(slot.datetime));
    setSelectedEndTime(new Date(slot.endDatetime));
  }, []);

  const handleSendInvite = useCallback(() => {
    if (!selectedTime || !selectedFacility || !onSendInvite) return;
    lightHaptic();
    onSendInvite({ suggestion, selectedFacility, selectedTime, selectedEndTime });
  }, [suggestion, selectedFacility, selectedTime, onSendInvite]);

  // ── Derived data ───────────────────────────────────────────────────
  const opponentName =
    `${suggestion.opponentFirstName} ${suggestion.opponentLastName}`.trim() || labels.unknownPlayer;

  const reputationDisplay = buildReputationDisplay(suggestion);
  const hasMultipleFacilities = suggestion.facilities.length > 1;

  // Build date chips: merge periods into unique dates, sorted chronologically
  const visibleDates = useMemo((): Array<{
    key: string;
    date: Date;
    label: string;
    periods: string[];
  }> => {
    if (!selectedFacility) return [];

    const now = new Date();
    const todayIndex = now.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // All facilities now have pre-computed availableSlots (service handles both
    // real-time and generated slots, already conflict-filtered).
    // Only show periods that have at least one available slot.
    const validPeriods = suggestion.sharedAvailability.filter(slot =>
      selectedFacility.availableSlots.some(s => {
        const d = new Date(s.datetime);
        return getDayOfWeek(d) === slot.day && hourToPeriod(d.getHours()) === slot.period;
      })
    );

    // Group by date
    const dateMap = new Map<
      string,
      { key: string; date: Date; label: string; periods: string[] }
    >();
    for (const slot of validPeriods) {
      const targetDayIndex = dayNames.indexOf(slot.day);
      let daysAhead = targetDayIndex - todayIndex;
      if (daysAhead < 0) daysAhead += 7;
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + daysAhead);
      targetDate.setHours(0, 0, 0, 0);
      const key = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

      if (dateMap.has(key)) {
        dateMap.get(key)!.periods.push(slot.period);
      } else {
        // Format using the same intuitive logic as MatchCard: Today, Tomorrow, weekday, or date
        const result = formatIntuitiveDateInTimezone(key, 'UTC', locale);
        let dateLabel: string;
        if (result.type === 'today') {
          dateLabel = labels.today;
        } else if (result.type === 'tomorrow') {
          dateLabel = labels.tomorrow;
        } else {
          dateLabel = result.label;
        }

        dateMap.set(key, {
          key,
          date: targetDate,
          label: dateLabel,
          periods: [slot.period],
        });
      }
    }

    return Array.from(dateMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [suggestion.sharedAvailability, selectedFacility, locale, labels]);

  // Auto-select the first date so hour chips are immediately visible.
  // When facility changes, visibleDates recomputes — keep the current date
  // if still valid, otherwise select the first available one.
  useEffect(() => {
    if (visibleDates.length === 0) {
      if (selectedDateKey) setSelectedDateKey(null);
      return;
    }
    const currentStillValid = selectedDateKey && visibleDates.some(d => d.key === selectedDateKey);
    if (!currentStillValid) {
      setSelectedDateKey(visibleDates[0].key);
    }
  }, [visibleDates, selectedDateKey]);

  // Get available hours for the selected date — all slots are pre-computed by the service
  // (both real availability and generated no-source slots, already conflict-filtered)
  const availableHoursForDate = useMemo((): AvailableTimeSlot[] => {
    if (!selectedDateKey || !selectedFacility) return [];

    const selectedDateChip = visibleDates.find(d => d.key === selectedDateKey);
    if (!selectedDateChip) return [];

    // Filter slots that fall on the selected date and within its merged periods
    const targetDay = getDayOfWeek(selectedDateChip.date);
    const matching = selectedFacility.availableSlots.filter(slot => {
      const d = new Date(slot.datetime);
      const day = getDayOfWeek(d);
      const period = hourToPeriod(d.getHours());
      return day === targetDay && period && selectedDateChip.periods.includes(period);
    });

    // Deduplicate by hour, summing court counts (for facilities with multiple courts)
    const byHour = new Map<number, AvailableTimeSlot>();
    for (const slot of matching) {
      const hourKey = new Date(slot.datetime).getHours();
      const existing = byHour.get(hourKey);
      if (existing) {
        existing.courtCount += slot.courtCount;
      } else {
        byHour.set(hourKey, { ...slot, courtCount: slot.courtCount });
      }
    }
    return Array.from(byHour.values()).sort(
      (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );
  }, [selectedDateKey, selectedFacility, visibleDates]);

  // ── Styling ────────────────────────────────────────────────────────
  const tierAccent = isDark ? primary[400] : primary[500];
  const cardBg = isDark ? primary[950] : primary[50];
  const borderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;

  // Chip color system — mirrors MatchCard badge chip pattern
  // Uses base color at low alpha for bg, solid base color for text
  const chipAlpha = isDark ? '30' : '15';

  // Unselected chips: primary tint (same as MatchCard badge chips)
  const chipUnselectedBg = `${tierAccent}${chipAlpha}`;
  const chipUnselectedBorder = 'transparent';
  const chipUnselectedText = tierAccent;

  // Court availability colors (green)
  const courtGreen = isDark ? '#4ADE80' : '#16A34A';
  const courtGreenBg = `${courtGreen}${chipAlpha}`;
  const courtGreenBorder = 'transparent';

  // No-source amber colors (unknown availability)
  const amberTint = isDark ? '#FBBF24' : '#D97706';
  const amberBg = `${amberTint}${chipAlpha}`;
  const amberBorder = 'transparent';

  const isReady = !!selectedTime;
  const canSend = inviteState === 'idle' && isReady;
  const isSending = inviteState === 'sending';

  return (
    <Animated.View style={{ transform: [{ scale: cardScaleAnimation }] }}>
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
        <View style={styles.content}>
          {/* ── Opponent row ─────────────────────────────────────── */}
          <View style={styles.opponentRow}>
            <View style={[styles.avatar, { borderColor: tierAccent }]}>
              {suggestion.opponentAvatar ? (
                <Image source={{ uri: suggestion.opponentAvatar }} style={styles.avatarImage} />
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
            </View>
            <View style={styles.opponentInfo}>
              <Text size="base" weight="bold" color={colors.text} numberOfLines={1}>
                {opponentName}
              </Text>
              <View style={styles.badgeRow}>
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
          </View>

          {/* ── Facility selector ────────────────────────────────── */}
          <View style={styles.sectionRow}>
            <Ionicons name="location" size={14} color={colors.textMuted} />
            <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionLabel}>
              {labels.facility}
            </Text>
          </View>
          {hasMultipleFacilities ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipContainer}
            >
              {suggestion.facilities.map((fac, index) => {
                const isSelected = index === selectedFacilityIndex;
                return (
                  <TouchableOpacity
                    key={fac.facilityId}
                    style={[
                      styles.chip,
                      styles.facilityChip,
                      isSelected
                        ? { backgroundColor: tierAccent }
                        : { backgroundColor: chipUnselectedBg },
                    ]}
                    onPress={() => handleFacilitySelect(index)}
                    activeOpacity={0.7}
                  >
                    {fac.hasAvailabilitySource && <LiveDot />}
                    <Text
                      size="xs"
                      weight={isSelected ? 'bold' : 'medium'}
                      color={isSelected ? base.white : chipUnselectedText}
                      numberOfLines={1}
                    >
                      {fac.facilityName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.staticFacilityRow}>
              {selectedFacility?.hasAvailabilitySource && <LiveDot />}
              <Text
                size="sm"
                color={colors.textSecondary}
                numberOfLines={1}
                style={styles.staticFacility}
              >
                {selectedFacility?.facilityName}
                {selectedFacility?.facilityCity ? ` \u2022 ${selectedFacility.facilityCity}` : ''}
              </Text>
            </View>
          )}

          {/* ── Date selector ──────────────────────────────────── */}
          <View style={[styles.sectionRow, { marginTop: spacingPixels[3] }]}>
            <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
            <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionLabel}>
              {labels.when}
            </Text>
            {!selectedDateKey && (
              <Text size="xs" color={colors.textMuted} style={styles.helperText}>
                — {labels.selectDate}
              </Text>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipContainer}
          >
            {visibleDates.map(dateChip => {
              const isSelected = selectedDateKey === dateChip.key;
              return (
                <TouchableOpacity
                  key={dateChip.key}
                  style={[
                    styles.chip,
                    isSelected
                      ? { backgroundColor: tierAccent }
                      : { backgroundColor: chipUnselectedBg },
                  ]}
                  onPress={() => handleDateSelect(dateChip.key)}
                  activeOpacity={0.7}
                >
                  <Text
                    size="xs"
                    weight={isSelected ? 'bold' : 'medium'}
                    color={isSelected ? base.white : chipUnselectedText}
                  >
                    {dateChip.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* ── Hour selector (visible when date selected) ────── */}
          {selectedDateKey && (
            <>
              {!selectedTime && availableHoursForDate.length > 0 && (
                <Text size="xs" color={colors.textMuted} style={styles.timeHelperText}>
                  {labels.selectTime}
                </Text>
              )}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.hourScroll}
                contentContainerStyle={styles.chipContainer}
              >
                {availableHoursForDate.length === 0 ? (
                  <Text size="xs" color={colors.textMuted} style={styles.noSlotsText}>
                    {labels.noAvailableTimes}
                  </Text>
                ) : (
                  availableHoursForDate.map(slot => {
                    const slotDate = new Date(slot.datetime);
                    const hour = slotDate.getHours();
                    const isSelected =
                      selectedTime && selectedTime.getTime() === slotDate.getTime();
                    const hasCourtData =
                      selectedFacility?.hasAvailabilitySource && slot.courtCount > 0;
                    const noSourceFacility = !selectedFacility?.hasAvailabilitySource;

                    return (
                      <TouchableOpacity
                        key={slotDate.getTime()}
                        style={[
                          styles.hourChip,
                          isSelected
                            ? { backgroundColor: tierAccent }
                            : hasCourtData
                              ? { backgroundColor: courtGreenBg }
                              : noSourceFacility
                                ? { backgroundColor: amberBg }
                                : { backgroundColor: chipUnselectedBg },
                        ]}
                        onPress={() => handleTimeSelect(slot)}
                        activeOpacity={0.7}
                      >
                        <Text
                          size="xs"
                          weight={isSelected ? 'bold' : 'medium'}
                          color={
                            isSelected
                              ? base.white
                              : hasCourtData
                                ? courtGreen
                                : noSourceFacility
                                  ? amberTint
                                  : chipUnselectedText
                          }
                        >
                          {formatHour(hour, locale)}
                        </Text>
                        {hasCourtData && (
                          <View
                            style={[
                              styles.courtBadge,
                              { backgroundColor: isSelected ? base.white : courtGreen },
                            ]}
                          >
                            <Text
                              size="xs"
                              weight="bold"
                              color={isSelected ? tierAccent : base.white}
                              style={styles.courtBadgeText}
                            >
                              {slot.courtCount}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </>
          )}

          {/* ── CTA ──────────────────────────────────────────────── */}
          {onSendInvite && (
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              {inviteState === 'sent' ? (
                <View
                  style={[styles.ctaButton, styles.ctaSent, { backgroundColor: `${courtGreen}20` }]}
                >
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
                    !isReady && !isSending && styles.ctaDisabled,
                  ]}
                  onPress={handleSendInvite}
                  onPressIn={canSend ? handlePressIn : undefined}
                  onPressOut={canSend ? handlePressOut : undefined}
                  activeOpacity={canSend ? 0.8 : 1}
                  disabled={disabled || isSending || !isReady}
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

// =============================================================================
// STYLES
// =============================================================================

const SLOT_SIZE = 40;

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
  },
  content: {
    padding: spacingPixels[4],
  },

  // Opponent
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
    marginLeft: spacingPixels[3],
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[1],
    gap: spacingPixels[1],
  },

  // Section headers
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1.5],
    gap: spacingPixels[1],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Facility
  facilityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  staticFacilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  staticFacility: {
    flex: 1,
    marginLeft: spacingPixels[0.5],
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: LIVE_RED,
  },

  // Chips (facility + period selectors)
  chipScroll: {
    marginBottom: spacingPixels[1],
  },
  chipContainer: {
    gap: spacingPixels[1.5],
    paddingRight: spacingPixels[2],
  },
  chip: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },

  // Hour chips
  hourScroll: {
    marginTop: spacingPixels[1],
    marginBottom: spacingPixels[1],
  },
  hourChip: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  courtBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courtBadgeText: {
    fontSize: 9,
    lineHeight: 12,
  },
  noSlotsText: {
    paddingVertical: spacingPixels[2],
  },
  helperText: {
    marginLeft: spacingPixels[1],
  },
  timeHelperText: {
    marginTop: spacingPixels[1],
    marginBottom: spacingPixels[1],
    marginLeft: spacingPixels[0.5],
  },

  // Footer / CTA
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacingPixels[3],
    marginTop: spacingPixels[2],
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
  ctaDisabled: {
    opacity: 0.4,
  },
  ctaSent: {
    opacity: 0.9,
  },
  ctaIconLeft: {
    marginRight: spacingPixels[1],
  },
  invisible: {
    opacity: 0,
  },
});

export default SuggestionCard;
