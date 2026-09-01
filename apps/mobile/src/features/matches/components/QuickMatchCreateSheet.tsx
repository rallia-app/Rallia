/**
 * QuickMatchCreateSheet
 *
 * The fastest path from "I want to play" to a real, joinable game. Opened from
 * a community chat, where the habit today is to type a message and hope someone
 * answers.
 *
 * It asks only for what a reader cannot guess — day, time, how long, and
 * singles or doubles. Everything else is inferred: the sport
 * from the community (or the player's current one), and the duration and the
 * play style from their sport preferences. The inferred parts are shown as a
 * summary line rather than hidden, so nobody is surprised by what they posted.
 *
 * Place defaults to TBD — who is in usually decides where — but the player's
 * own courts are one tap away, and the strip re-ranks as the day and time
 * change: courts with a free slot AT THE CHOSEN HOUR lead, because that is what
 * "relevant" means once a slot is picked. Their remaining favourites fill in
 * behind, since most park courts have no booking provider at all and a court
 * without bookable inventory is still a fine place to play.
 *
 * The game is public and request-to-join: it goes out to a whole community, so
 * the host still gets the last word on who actually plays. It is recruitment,
 * not consensus. (Consensus among a known set is the Match Organizer's job.)
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { Button, SelectableChip, Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, base } from '@rallia/design-system';
import {
  lightHaptic,
  selectionHaptic,
  successHaptic,
  warningHaptic,
  formatIntuitiveDateInTimezone,
} from '@rallia/shared-utils';
import {
  DEFAULT_FACILITY_FILTERS,
  useCreateQuickMatch,
  useFacilitySearch,
  useFavoriteFacilities,
  usePlayerSports,
} from '@rallia/shared-hooks';
import type { MatchDurationEnum, MatchTypeEnum } from '@rallia/shared-types';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { SportIcon } from '#/components/SportIcon';
import * as Analytics from '#/services/analytics';
import { useAuth, useEffectiveLocation, useThemeStyles, useTranslation } from '#/hooks';
import { useSport } from '#/context';
import { formatTimeOfDay } from '#/utils/dateFormatting';

const SHEET_ID = 'quick-match-create';

/** How many days ahead the day strip offers before the date picker takes over. */
const DAY_CHIP_COUNT = 7;
/** The slice of a facility this sheet needs: chip label + the zone to stamp. */
type QuickFacility = { id: string; name: string; timezone: string | null };

/** Offered durations. 'custom' stays in the full wizard; this flow is a chip row. */
const DURATION_OPTIONS = ['30', '60', '90', '120'] as const;

/** Courts offered as chips before the list would stop being scannable. */
const FACILITY_CHIP_LIMIT = 6;
/** The hours a game realistically starts at. Anything else goes via the picker. */
const FIRST_HOUR = 6;
const LAST_HOUR = 22;

const pad = (n: number) => String(n).padStart(2, '0');

const localDateKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Next half-hour boundary, so the default time is always still bookable. */
const nextHalfHour = (): { dateKey: string; time: string } => {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30);
  return { dateKey: localDateKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

const addMinutes = (time: string, minutes: number): string => {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
};

const durationMinutes = (duration: MatchDurationEnum, custom?: number | null): number => {
  if (duration === 'custom') return custom && custom > 0 ? custom : 60;
  const parsed = parseInt(duration, 10);
  return Number.isFinite(parsed) ? parsed : 60;
};

export function QuickMatchCreateActionSheet({ payload }: SheetProps<'quick-match-create'>) {
  const conversationId = payload?.conversationId;
  const networkSportId = payload?.networkSportId ?? null;
  const networkName = payload?.networkName ?? null;

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const { selectedSport, userSports } = useSport();
  const playerId = session?.user?.id;

  const accent = isDark ? primary[500] : primary[600];

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  // A sport-scoped community pins the game to its sport; elsewhere the player's
  // current sport is the default, and they can switch if they play more than one.
  const pinnedSport = useMemo(
    () => (networkSportId ? (userSports.find(sp => sp.id === networkSportId) ?? null) : null),
    [networkSportId, userSports]
  );
  const [chosenSportId, setChosenSportId] = useState<string | null>(null);
  const sportId = networkSportId ?? chosenSportId ?? selectedSport?.id ?? null;
  const sport = useMemo(
    () => userSports.find(sp => sp.id === sportId) ?? pinnedSport ?? selectedSport,
    [userSports, sportId, pinnedSport, selectedSport]
  );
  const canPickSport = !networkSportId && userSports.length > 1;

  const initial = useMemo(() => nextHalfHour(), []);
  const [dateKey, setDateKey] = useState(initial.dateKey);
  const [startTime, setStartTime] = useState(initial.time);
  const [format, setFormat] = useState<'singles' | 'doubles'>('singles');
  /** null = the place is TBD, which is the default and the first chip. The whole
   *  facility is held, not just its id: the ranked list below re-queries on
   *  every day/time change, and a pick must survive dropping out of it. */
  const [selectedFacility, setSelectedFacility] = useState<QuickFacility | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Duration and play style are the player's own preferences for this sport —
  // the two settings they already told us about, so we never ask twice.
  const { playerSports } = usePlayerSports(playerId);
  const preference = useMemo(
    () => playerSports.find(ps => ps.sport_id === sportId) ?? null,
    [playerSports, sportId]
  );
  // Seeded from the player's sport preference, then theirs to change.
  const preferredDuration = (preference?.preferred_match_duration ?? '60') as MatchDurationEnum;
  const [duration, setDuration] = useState<MatchDurationEnum | null>(null);
  const effectiveDuration = duration ?? preferredDuration;
  const minutes = durationMinutes(effectiveDuration);
  // Always open to both, never the host's own preferred_match_type: a game
  // posted as "competitive" tells half the community it isn't for them, which
  // is the opposite of what an open recruitment post is for.
  const playerExpectation: MatchTypeEnum = 'both';

  const { location } = useEffectiveLocation();

  // Courts with a free slot at the hour the player just picked. Re-queries as
  // day/time change, so the strip always answers "open when I want to play"
  // rather than "open right now". playerId sorts the player's own courts first.
  const selectedHour = useMemo(() => Number(startTime.split(':')[0]), [startTime]);
  const openFilters = useMemo(
    () => ({
      ...DEFAULT_FACILITY_FILTERS,
      hasOpenSlots: true,
      slotDate: dateKey,
      hourRange: { minHour: selectedHour, maxHour: selectedHour },
    }),
    [dateKey, selectedHour]
  );
  const { facilities: openAtSlot } = useFacilitySearch({
    sportIds: sportId ? [sportId] : undefined,
    latitude: location?.latitude,
    longitude: location?.longitude,
    searchQuery: '',
    filters: openFilters,
    playerId,
    pageSize: FACILITY_CHIP_LIMIT,
    enabled: !!location && !!sportId,
  });

  // Their own courts, which are what most players actually mean by "where I
  // play" — many are parks with no bookable inventory at all.
  const { favorites } = useFavoriteFacilities(playerId ?? null, sportId);

  const facilityOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: QuickFacility[] = [];
    // The player's own pick always leads and always renders, even when the new
    // slot re-ranks it out of the top few.
    if (selectedFacility) {
      seen.add(selectedFacility.id);
      out.push(selectedFacility);
    }
    for (const f of openAtSlot) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ id: f.id, name: f.name, timezone: f.timezone ?? null });
    }
    for (const fav of favorites) {
      if (seen.has(fav.facilityId)) continue;
      seen.add(fav.facilityId);
      out.push({
        id: fav.facilityId,
        name: fav.facility.name,
        timezone: fav.facility.timezone ?? null,
      });
    }
    return out.slice(0, FACILITY_CHIP_LIMIT);
  }, [selectedFacility, openAtSlot, favorites]);

  const dayOptions = useMemo(() => {
    const base0 = startOfToday();
    return Array.from({ length: DAY_CHIP_COUNT }, (_, i) => {
      const d = new Date(base0);
      d.setDate(d.getDate() + i);
      const key = localDateKey(d);
      const intuitive = formatIntuitiveDateInTimezone(key, timezone, locale);
      return {
        key,
        label: intuitive.translationKey ? t(intuitive.translationKey) : intuitive.label,
      };
    });
  }, [timezone, locale, t]);

  const labelForTime = useCallback(
    (value: string) => {
      const [h, m] = value.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return formatTimeOfDay(d, locale);
    },
    [locale]
  );

  // Today's strip starts at the next usable hour: offering 07:00 at 6pm is noise.
  // The chosen time is always present, even off-grid (picked via "Other time",
  // or a late-night rollover), so the strip never reads as nothing selected.
  const hourOptions = useMemo(() => {
    const isToday = dateKey === localDateKey(new Date());
    const earliest = isToday ? new Date().getHours() + 1 : FIRST_HOUR;
    const from = Math.max(FIRST_HOUR, earliest);
    const values = new Set<string>();
    for (let hour = from; hour <= LAST_HOUR; hour++) values.add(`${pad(hour)}:00`);
    values.add(startTime);
    return [...values].sort().map(value => ({ value, label: labelForTime(value) }));
  }, [dateKey, startTime, labelForTime]);

  const timeValue = useMemo(() => {
    const [h, m] = startTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }, [startTime]);

  const dateValue = useMemo(() => {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [dateKey]);

  const endTime = addMinutes(startTime, minutes);

  // Only what the player did NOT choose. Place used to belong here, back when it
  // was always TBD; it is a chip now, so listing it would just echo the row above.
  const summary = useMemo(
    () =>
      [
        t('quickGame.summary.anyStyle'),
        t('quickGame.summary.anyRating'),
        t('quickGame.summary.anyGender'),
        t('quickGame.summary.youApprove'),
      ].join(' · '),
    [t]
  );

  // Moving the game onto today can strand the time in the past; pull it forward
  // rather than letting the submit guard reject it later.
  const handleSelectDay = useCallback(
    (key: string) => {
      void selectionHaptic();
      setDateKey(key);
      const [y, mo, d] = key.split('-').map(Number);
      const [h, m] = startTime.split(':').map(Number);
      if (new Date(y, mo - 1, d, h, m).getTime() <= Date.now()) {
        setStartTime(nextHalfHour().time);
      }
    },
    [startTime]
  );

  const handleSelectHour = useCallback((value: string) => {
    void selectionHaptic();
    setStartTime(value);
  }, []);

  const handleDateChange = useCallback((_: unknown, picked?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (picked) setDateKey(localDateKey(picked));
  }, []);

  const handleTimeChange = useCallback((_: unknown, picked?: Date) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (picked) setStartTime(`${pad(picked.getHours())}:${pad(picked.getMinutes())}`);
  }, []);

  const handleClose = useCallback(() => {
    void lightHaptic();
    void SheetManager.hide(SHEET_ID);
  }, []);

  const createQuickMatch = useCreateQuickMatch();

  const handleSubmit = useCallback(() => {
    if (!conversationId || !playerId || !sportId || submitting) return;

    // The strip already hides past hours, but the picker does not: a game in
    // the past can never fill, so refuse it rather than posting a dead card.
    const [h, m] = startTime.split(':').map(Number);
    const [y, mo, d] = dateKey.split('-').map(Number);
    if (new Date(y, mo - 1, d, h, m).getTime() <= Date.now()) {
      void warningHaptic();
      const next = nextHalfHour();
      setDateKey(next.dateKey);
      setStartTime(next.time);
      // Toasts render behind a sheet, so in-sheet errors use Alert.
      Alert.alert(t('quickGame.error.pastTitle'), t('quickGame.error.pastBody'));
      return;
    }

    setSubmitting(true);
    // Promise chaining rather than try/catch: React Compiler bails out of a
    // component containing a try statement.
    void createQuickMatch
      .mutateAsync({
        conversationId,
        match: {
          sportId,
          createdBy: playerId,
          matchDate: dateKey,
          startTime,
          endTime,
          // The wall-clock the player picked is the COURT's local time, so a
          // facility in another timezone must stamp its own, not the device's.
          timezone: selectedFacility?.timezone ?? timezone,
          format,
          playerExpectation,
          duration: effectiveDuration,
          // Inferred, and deliberately so — see the file header.
          locationType: selectedFacility ? 'facility' : 'tbd',
          facilityId: selectedFacility?.id,
          isCourtFree: true,
          costSplitType: 'equal',
          // No filters: a community post should not quietly exclude anyone.
          // ('any' is mapped to a null column by createMatch.)
          preferredOpponentGender: 'any',
          minRatingScoreId: undefined,
          visibility: 'public',
          visibleInGroups: true,
          visibleInCommunities: true,
          // The audience is a whole community, so the host approves each player.
          joinMode: 'request',
        },
      })
      .then(match => {
        Analytics.quickGameCreated({
          match_id: match.id,
          sport_id: sportId,
          sport_name: sport?.name ?? 'unknown',
          format,
          network_scoped_sport: !!networkSportId,
          has_facility: !!selectedFacility,
          days_ahead: Math.round(
            (new Date(y, mo - 1, d).getTime() - startOfToday().getTime()) / 86_400_000
          ),
        });
        void successHaptic();
        return SheetManager.hide(SHEET_ID);
      })
      .catch(() => {
        void warningHaptic();
        // Toasts render behind a sheet, so in-sheet errors use Alert.
        Alert.alert(t('common.error'), t('quickGame.error.createFailed'));
      })
      .finally(() => setSubmitting(false));
  }, [
    conversationId,
    playerId,
    sportId,
    sport,
    submitting,
    dateKey,
    startTime,
    endTime,
    timezone,
    selectedFacility,
    format,
    playerExpectation,
    effectiveDuration,
    networkSportId,
    createQuickMatch,
    t,
  ]);

  return (
    <BaseActionSheet
      title={t('quickGame.sheet.title')}
      onClose={handleClose}
      flex={false}
      scrollable
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!sportId || !conversationId}
          onPress={handleSubmit}
          leftIcon={<Ionicons name="megaphone-outline" size={18} color={base.white} />}
        >
          {t('quickGame.sheet.submit')}
        </Button>
      }
    >
      {networkName ? (
        <Text size="sm" color={colors.textMuted} style={styles.intro}>
          {t('quickGame.sheet.intro').replace('{community}', networkName)}
        </Text>
      ) : null}

      {canPickSport ? (
        <View style={styles.section}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('quickGame.sheet.sportLabel')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {userSports.map(sp => {
              const active = sp.id === sportId;
              return (
                <SelectableChip
                  key={sp.id}
                  label={sp.display_name}
                  selected={active}
                  accentColor={accent}
                  icon={
                    <SportIcon
                      sportName={sp.name}
                      size={16}
                      color={active ? base.white : colors.textMuted}
                    />
                  }
                  onPress={() => {
                    void selectionHaptic();
                    setChosenSportId(sp.id);
                  }}
                />
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Day */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('quickGame.sheet.dayLabel')}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {dayOptions.map(day => (
            <SelectableChip
              key={day.key}
              label={day.label}
              selected={day.key === dateKey}
              accentColor={accent}
              onPress={() => handleSelectDay(day.key)}
            />
          ))}
          <SelectableChip
            variant="ghost"
            label={t('quickGame.sheet.otherDay')}
            icon={<Ionicons name="calendar-outline" size={16} color={colors.textMuted} />}
            onPress={() => {
              void lightHaptic();
              setShowDatePicker(v => !v);
            }}
          />
        </ScrollView>
        {showDatePicker ? (
          <DateTimePicker
            value={dateValue}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            minimumDate={startOfToday()}
            onChange={handleDateChange}
            themeVariant={isDark ? 'dark' : 'light'}
          />
        ) : null}
      </View>

      {/* Time */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('quickGame.sheet.timeLabel')}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {hourOptions.map(hour => (
            <SelectableChip
              key={hour.value}
              label={hour.label}
              selected={hour.value === startTime}
              accentColor={accent}
              onPress={() => handleSelectHour(hour.value)}
            />
          ))}
          <SelectableChip
            variant="ghost"
            label={t('quickGame.sheet.otherTime')}
            icon={<Ionicons name="time-outline" size={16} color={colors.textMuted} />}
            onPress={() => {
              void lightHaptic();
              setShowTimePicker(v => !v);
            }}
          />
        </ScrollView>
        {showTimePicker ? (
          <DateTimePicker
            value={timeValue}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minuteInterval={5}
            onChange={handleTimeChange}
            themeVariant={isDark ? 'dark' : 'light'}
          />
        ) : null}
      </View>

      {/* How long */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('quickGame.sheet.durationLabel')}
        </Text>
        <View style={styles.strip}>
          {DURATION_OPTIONS.map(value => (
            <SelectableChip
              key={value}
              label={t(`matchCreation.duration.${value}`)}
              selected={effectiveDuration === value}
              accentColor={accent}
              onPress={() => {
                void selectionHaptic();
                setDuration(value);
              }}
            />
          ))}
        </View>
      </View>

      {/* Where — TBD first, then the player's own relevant courts. */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('quickGame.sheet.whereLabel')}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          <SelectableChip
            label={t('quickGame.sheet.placeTbd')}
            selected={!selectedFacility}
            accentColor={accent}
            icon={
              <Ionicons
                name="help-circle-outline"
                size={15}
                color={!selectedFacility ? base.white : colors.textMuted}
              />
            }
            onPress={() => {
              void selectionHaptic();
              setSelectedFacility(null);
            }}
          />
          {facilityOptions.map(facility => {
            const active = facility.id === selectedFacility?.id;
            return (
              <SelectableChip
                key={facility.id}
                label={facility.name}
                selected={active}
                accentColor={accent}
                icon={
                  <Ionicons
                    name="location-outline"
                    size={15}
                    color={active ? base.white : colors.textMuted}
                  />
                }
                onPress={() => {
                  void selectionHaptic();
                  setSelectedFacility(facility);
                }}
              />
            );
          })}
        </ScrollView>
      </View>

      {/* Format */}
      <View style={styles.section}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('quickGame.sheet.formatLabel')}
        </Text>
        <View style={styles.strip}>
          <SelectableChip
            label={t('quickGame.sheet.singles')}
            selected={format === 'singles'}
            accentColor={accent}
            icon={
              <Ionicons
                name="person-outline"
                size={15}
                color={format === 'singles' ? base.white : colors.textMuted}
              />
            }
            onPress={() => {
              void selectionHaptic();
              setFormat('singles');
            }}
          />
          <SelectableChip
            label={t('quickGame.sheet.doubles')}
            selected={format === 'doubles'}
            accentColor={accent}
            icon={
              <Ionicons
                name="people-outline"
                size={15}
                color={format === 'doubles' ? base.white : colors.textMuted}
              />
            }
            onPress={() => {
              void selectionHaptic();
              setFormat('doubles');
            }}
          />
        </View>
      </View>

      {/* What we filled in for them. Shown, never hidden. */}
      <View style={[styles.summary, { backgroundColor: colors.buttonInactive }]}>
        <Ionicons name="sparkles-outline" size={16} color={colors.textMuted} />
        <Text size="xs" color={colors.textMuted} style={styles.summaryText}>
          {summary}
        </Text>
      </View>
    </BaseActionSheet>
  );
}

export default QuickMatchCreateActionSheet;

const styles = StyleSheet.create({
  intro: {
    marginBottom: spacingPixels[4],
  },
  section: {
    marginBottom: spacingPixels[5],
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  strip: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    paddingRight: spacingPixels[2],
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
    borderRadius: radiusPixels.lg,
  },
  summaryText: {
    flex: 1,
  },
});
