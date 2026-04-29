/**
 * SuggestionCard Component — Interactive
 *
 * Displays a match suggestion with:
 * - Opponent info (name, rating badge, reputation badge)
 * - Three compact summary pills with auto-picked defaults:
 *     facility (best affinity) · soonest day · random available time
 * - Tapping a pill expands its chip selector for manual override
 * - "Send Game Invite" CTA — usable in one tap
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /** When true, the facility / date / time pills are display-only and the
   *  auto-picked defaults can't be changed. Used in the unified feed where
   *  each suggestion should look like a concrete pre-filled match. */
  lockSelections?: boolean;
  /** Locked-mode override: explicit slot to display. Required to keep the
   *  card's displayed time identical to the slot used by the unified feed's
   *  chronological sort key. Ignored in interactive (non-locked) mode. */
  pickedSlot?: AvailableTimeSlot;
  /** Locked-mode override: index into `suggestion.facilities` of the facility
   *  whose `pickedSlot` was chosen. The facility-fallback in
   *  `pickSlotForSuggestion` may pick from a non-default facility, so the
   *  location row needs this to render the right name. Defaults to 0. */
  pickedFacilityIndex?: number;
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
  lockSelections = false,
  pickedSlot,
  pickedFacilityIndex,
}) => {
  // Local selection state. `null` for date/time means "use the auto-pick";
  // a non-null value means the user manually overrode that field.
  const [selectedFacilityIndex, setSelectedFacilityIndex] = useState(pickedFacilityIndex ?? 0);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<Date | null>(null);
  const [selectedEndTime, setSelectedEndTime] = useState<Date | null>(null);
  const [expandedSection, setExpandedSection] = useState<'facility' | 'date' | 'time' | null>(null);

  // Stable random-time pick keyed by (facility, dateKey). Re-rolls only when
  // the cached slot is no longer in the available list (e.g. became past).
  const randomPickRef = useRef(new Map<string, AvailableTimeSlot>());

  // Tick every minute so past time chips drop off while the sheet stays open.
  // In locked mode (used by the unified feed) this is unnecessary — the feed's
  // own ticker drives slot expiry — so we skip the timer to avoid pointless
  // re-renders across many cards.
  const lockedAndPicked = lockSelections && !!pickedSlot;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (lockedAndPicked) return;
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [lockedAndPicked]);

  const selectedFacility = suggestion.facilities[selectedFacilityIndex];

  // Press animation
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

  // Handlers
  const handleFacilitySelect = useCallback((index: number) => {
    lightHaptic();
    setSelectedFacilityIndex(index);
    // Reset manual date/time — they may not apply to the new facility.
    setSelectedDateKey(null);
    setSelectedTime(null);
    setSelectedEndTime(null);
    setExpandedSection(null);
  }, []);

  const handleDateSelect = useCallback((dateKey: string) => {
    lightHaptic();
    setSelectedDateKey(dateKey);
    setSelectedTime(null);
    setSelectedEndTime(null);
    setExpandedSection(null);
  }, []);

  const handleTimeSelect = useCallback((slot: AvailableTimeSlot) => {
    lightHaptic();
    setSelectedTime(new Date(slot.datetime));
    setSelectedEndTime(new Date(slot.endDatetime));
    setExpandedSection(null);
  }, []);

  const togglePill = useCallback((section: 'facility' | 'date' | 'time') => {
    lightHaptic();
    setExpandedSection(prev => (prev === section ? null : section));
  }, []);

  // Derived data
  const opponentName =
    `${suggestion.opponentFirstName} ${suggestion.opponentLastName}`.trim() || labels.unknownPlayer;

  const reputationDisplay = buildReputationDisplay(suggestion);
  const hasMultipleFacilities = suggestion.facilities.length > 1;

  // Build date chips: merge periods into unique dates, sorted chronologically.
  // Only include periods with at least one slot still in the future — the
  // service filters at fetch time, but slots that were future then may now
  // be past (the nowMs tick above triggers a recompute).
  const visibleDates = useMemo((): Array<{
    key: string;
    date: Date;
    label: string;
    periods: string[];
  }> => {
    // Locked mode renders only the static match-style rows — no date pill, no
    // hour pill — so the (relatively expensive) shared-availability ∩ slot
    // join is wasted work. Short-circuit.
    if (lockedAndPicked) return [];
    if (!selectedFacility) return [];

    const now = new Date(nowMs);
    const todayIndex = now.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    const validPeriods = suggestion.sharedAvailability.filter(slot =>
      selectedFacility.availableSlots.some(s => {
        const d = new Date(s.datetime);
        if (d.getTime() <= nowMs) return false;
        return getDayOfWeek(d) === slot.day && hourToPeriod(d.getHours()) === slot.period;
      })
    );

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
        // The `key` is built from the user's *local* date components, so we
        // must compare against "today" in the same (device) timezone — not
        // UTC, which can be a day ahead/behind and produce a wrong label.
        const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = formatIntuitiveDateInTimezone(key, deviceTz, locale);
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
  }, [suggestion.sharedAvailability, selectedFacility, locale, labels, nowMs, lockedAndPicked]);

  // Effective date = manual override (if still valid) else soonest visible date.
  const effectiveDateKey = useMemo<string | null>(() => {
    if (selectedDateKey && visibleDates.some(d => d.key === selectedDateKey)) {
      return selectedDateKey;
    }
    return visibleDates[0]?.key ?? null;
  }, [selectedDateKey, visibleDates]);

  // Hours available on the effective date, deduped by hour and dropping past slots.
  const availableHoursForDate = useMemo((): AvailableTimeSlot[] => {
    // Locked mode renders no hour pills — skip the work.
    if (lockedAndPicked) return [];
    if (!effectiveDateKey || !selectedFacility) return [];

    const selectedDateChip = visibleDates.find(d => d.key === effectiveDateKey);
    if (!selectedDateChip) return [];

    const targetDay = getDayOfWeek(selectedDateChip.date);
    const matching = selectedFacility.availableSlots.filter(slot => {
      const d = new Date(slot.datetime);
      if (d.getTime() <= nowMs) return false;
      const day = getDayOfWeek(d);
      const period = hourToPeriod(d.getHours());
      return day === targetDay && period && selectedDateChip.periods.includes(period);
    });

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
  }, [effectiveDateKey, selectedFacility, visibleDates, nowMs, lockedAndPicked]);

  // Auto-picked time: a stable random slot per (facility, date). Re-rolls only
  // when the cached slot is no longer in availableHoursForDate (e.g. it slid
  // into the past via the 1-min tick, or the user changed facility/date).
  const autoPickedTime = useMemo<AvailableTimeSlot | null>(() => {
    // Locked mode: use the slot pre-picked by useUnifiedMatchFeed so the
    // displayed time is exactly the slot used as the chronological sort key.
    // Falls back to the first available slot if no pickedSlot was provided
    // (defensive — the feed always passes one).
    if (lockSelections) {
      return pickedSlot ?? availableHoursForDate[0] ?? null;
    }
    if (!selectedFacility || !effectiveDateKey || availableHoursForDate.length === 0) {
      return null;
    }
    const cacheKey = `${selectedFacility.facilityId}:${effectiveDateKey}`;
    const cached = randomPickRef.current.get(cacheKey);
    if (cached) {
      const stillValid = availableHoursForDate.find(
        s => new Date(s.datetime).getTime() === new Date(cached.datetime).getTime()
      );
      if (stillValid) return stillValid;
    }
    const pick = availableHoursForDate[Math.floor(Math.random() * availableHoursForDate.length)];
    randomPickRef.current.set(cacheKey, pick);
    return pick;
  }, [selectedFacility, effectiveDateKey, availableHoursForDate, lockSelections, pickedSlot]);

  // Effective time = manual override (if still in the available list) else auto-pick.
  const manualSlotStillValid = useMemo(() => {
    if (!selectedTime) return false;
    const ts = selectedTime.getTime();
    return availableHoursForDate.some(s => new Date(s.datetime).getTime() === ts);
  }, [selectedTime, availableHoursForDate]);

  const effectiveTime = useMemo<Date | null>(() => {
    if (manualSlotStillValid) return selectedTime;
    return autoPickedTime ? new Date(autoPickedTime.datetime) : null;
  }, [manualSlotStillValid, selectedTime, autoPickedTime]);

  const effectiveEndTime = useMemo<Date | null>(() => {
    if (manualSlotStillValid) return selectedEndTime;
    return autoPickedTime ? new Date(autoPickedTime.endDatetime) : null;
  }, [manualSlotStillValid, selectedEndTime, autoPickedTime]);

  const handleSendInvite = useCallback(() => {
    if (!effectiveTime || !selectedFacility || !onSendInvite) return;
    lightHaptic();
    onSendInvite({
      suggestion,
      selectedFacility,
      selectedTime: effectiveTime,
      selectedEndTime: effectiveEndTime,
    });
  }, [suggestion, selectedFacility, effectiveTime, effectiveEndTime, onSendInvite]);

  // Styling
  const tierAccent = isDark ? primary[400] : primary[500];
  const cardBg = isDark ? primary[950] : primary[50];
  const borderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;

  const chipAlpha = isDark ? '30' : '15';

  const chipUnselectedBg = `${tierAccent}${chipAlpha}`;
  const chipUnselectedText = tierAccent;

  const courtGreen = isDark ? '#4ADE80' : '#16A34A';
  const courtGreenBg = `${courtGreen}${chipAlpha}`;

  const amberTint = isDark ? '#FBBF24' : '#D97706';
  const amberBg = `${amberTint}${chipAlpha}`;

  const isReady = !!effectiveTime;
  const canSend = inviteState === 'idle' && isReady;
  const isSending = inviteState === 'sending';

  // Pill rendering — used for facility, date, and time summary pills.
  const renderPill = (
    key: 'facility' | 'date' | 'time',
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    interactive: boolean,
    extraLeft?: React.ReactNode
  ) => {
    const isExpanded = expandedSection === key;
    return (
      <TouchableOpacity
        key={key}
        style={[
          styles.summaryPill,
          { backgroundColor: isExpanded ? tierAccent : chipUnselectedBg },
          !interactive && styles.summaryPillInert,
        ]}
        onPress={() => (interactive ? togglePill(key) : undefined)}
        activeOpacity={interactive ? 0.7 : 1}
        disabled={!interactive}
      >
        {extraLeft}
        <Ionicons name={icon} size={12} color={isExpanded ? base.white : chipUnselectedText} />
        <Text
          size="xs"
          weight={isExpanded ? 'bold' : 'medium'}
          color={isExpanded ? base.white : chipUnselectedText}
          numberOfLines={1}
          style={styles.summaryPillLabel}
        >
          {label}
        </Text>
        {interactive && (
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={isExpanded ? base.white : chipUnselectedText}
          />
        )}
      </TouchableOpacity>
    );
  };

  const effectiveDateChip = visibleDates.find(d => d.key === effectiveDateKey);
  // In locked mode the feed pre-selects an exact slot; derive the date label
  // straight from it so it always matches the displayed start time. In
  // interactive mode keep the visible-dates-driven label for the date pill.
  const dateLabel = (() => {
    if (lockSelections && effectiveTime) {
      const d = effectiveTime;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = formatIntuitiveDateInTimezone(key, deviceTz, locale);
      if (result.type === 'today') return labels.today;
      if (result.type === 'tomorrow') return labels.tomorrow;
      return result.label;
    }
    return effectiveDateChip?.label ?? labels.selectDate;
  })();
  const timeLabel =
    effectiveTime && effectiveEndTime
      ? `${formatHour(effectiveTime.getHours(), locale)} – ${formatHour(effectiveEndTime.getHours(), locale)}`
      : effectiveTime
        ? formatHour(effectiveTime.getHours(), locale)
        : labels.noAvailableTimes;

  // Match-card-style "{date} • {start} • {duration}" label, used when locked.
  const TIME_SEPARATOR = ' • ';
  const startTimeText = effectiveTime
    ? effectiveTime.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    : null;
  const durationText = (() => {
    if (!effectiveTime || !effectiveEndTime) return null;
    let mins = Math.round((effectiveEndTime.getTime() - effectiveTime.getTime()) / 60000);
    if (mins <= 0) mins += 24 * 60;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
  })();
  const matchStyleTimeLabel = effectiveTime
    ? [dateLabel, startTimeText, durationText].filter(Boolean).join(TIME_SEPARATOR)
    : labels.noAvailableTimes;

  return (
    <Animated.View style={{ transform: [{ scale: cardScaleAnimation }] }}>
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
        <View style={styles.content}>
          {/* Match-style time + location rows shown when selections are locked */}
          {lockSelections && (
            <>
              <View style={styles.matchStyleTimeRow}>
                <Ionicons name="calendar-outline" size={16} color={tierAccent} />
                <Text
                  size="base"
                  weight="bold"
                  color={colors.text}
                  numberOfLines={1}
                  style={styles.matchStyleTimeText}
                >
                  {matchStyleTimeLabel}
                </Text>
              </View>
              <View style={styles.matchStyleLocationRow}>
                <Ionicons name="location" size={14} color={colors.textMuted} />
                {selectedFacility?.hasAvailabilitySource && <LiveDot />}
                <Text
                  size="sm"
                  color={colors.textMuted}
                  numberOfLines={1}
                  style={styles.matchStyleLocationText}
                >
                  {selectedFacility?.facilityName ?? ''}
                </Text>
              </View>
            </>
          )}

          {/* Opponent row */}
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

          {/* Facility summary pill — interactive mode only (locked mode renders a
              match-style location row above instead). */}
          {!lockSelections && (
            <View style={styles.summaryRow}>
              {renderPill(
                'facility',
                'location',
                selectedFacility?.facilityName ?? '',
                hasMultipleFacilities,
                selectedFacility?.hasAvailabilitySource ? <LiveDot /> : undefined
              )}
            </View>
          )}

          {/* Expanded panel: facility chips */}
          {!lockSelections && expandedSection === 'facility' && hasMultipleFacilities && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.expandedScroll}
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
          )}

          {/* Date + time summary pills — interactive mode only. */}
          {!lockSelections && (
            <View style={styles.summaryRow}>
              {renderPill('date', 'calendar-outline', dateLabel, visibleDates.length > 1)}
              {renderPill('time', 'time-outline', timeLabel, availableHoursForDate.length > 1)}
            </View>
          )}

          {/* Expanded panel: date chips */}
          {!lockSelections && expandedSection === 'date' && visibleDates.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.expandedScroll}
              contentContainerStyle={styles.chipContainer}
            >
              {visibleDates.map(dateChip => {
                const isSelected = effectiveDateKey === dateChip.key;
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
          )}

          {/* Expanded panel: hour chips */}
          {!lockSelections && expandedSection === 'time' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.expandedScroll}
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
                    !!effectiveTime && effectiveTime.getTime() === slotDate.getTime();
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
          )}

          {/* CTA */}
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
  matchStyleTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
    gap: spacingPixels[1.5],
  },
  matchStyleTimeText: {
    flexShrink: 1,
  },
  matchStyleLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
    gap: spacingPixels[1.5],
  },
  matchStyleLocationText: {
    flexShrink: 1,
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

  // Summary pills row
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[1.5],
    marginBottom: spacingPixels[2],
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    maxWidth: '100%',
  },
  summaryPillInert: {
    opacity: 0.85,
  },
  summaryPillLabel: {
    flexShrink: 1,
  },

  // Expanded chip panels
  expandedScroll: {
    marginBottom: spacingPixels[2],
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: LIVE_RED,
  },

  // Chips inside expanded panels
  chipContainer: {
    gap: spacingPixels[1.5],
    paddingRight: spacingPixels[2],
  },
  chip: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  facilityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
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
