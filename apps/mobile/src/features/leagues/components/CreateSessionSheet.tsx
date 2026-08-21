/**
 * Create Session Sheet
 *
 * Organizer-side single-step form to schedule a session inside a league's open
 * season. Replaces the former inline form on LeagueDetail's "sessions" tab. The
 * session mutation invalidates the season's sessions query, so the list
 * refreshes on its own.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Button, Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useCreateSession, useCreateSessionSeries } from '@rallia/shared-hooks';
import type { Enums } from '@rallia/shared-types';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';
import { rpcErrorMessage } from '#/utils/rpcErrorMessage';
import { formatTimeOfDay } from '#/utils/dateFormatting';
import * as Analytics from '#/services/analytics';

import { SheetDateField } from '#/components/SheetDateField';

const SHEET_ID = 'create-session';

/**
 * Pairing modes offered to an organizer. The enum also carries 'swiss' and
 * 'balanced_doubles', which the generator resolves to the same ranking order as
 * by_rank; offering them would promise a difference that does not exist.
 * 'manual' is last on purpose: it is the escape hatch, not the default.
 */
const PAIRING_MODES = [
  'by_rank',
  'random',
  'avoid_repeat',
  'manual',
] as const satisfies readonly Enums<'pairing_mode'>[];

/**
 * Games each player plays during the session. It is the generator's round count:
 * every round pairs the whole confirmed roster once. The column accepts 1 to 6.
 */
const ROUND_OPTIONS = [1, 2, 3, 4] as const;

/**
 * Repeat cadences, in days, matching what session_create_series accepts. "once"
 * keeps the plain single-session path. The occurrences are created as drafts;
 * publishing stays a per-session decision.
 */
const REPEAT_OPTIONS = [
  { key: 'once', days: 0 },
  { key: 'weekly', days: 7 },
  { key: 'biweekly', days: 14 },
  { key: 'monthly', days: 28 },
] as const;
type RepeatKey = (typeof REPEAT_OPTIONS)[number]['key'];
const OCCURRENCE_OPTIONS = [4, 6, 8, 12] as const;

export function CreateSessionActionSheet({ payload }: SheetProps<'create-session'>) {
  const seasonId = payload?.seasonId ?? '';
  const leagueId = payload?.leagueId ?? '';

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();

  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [pairingMode, setPairingMode] = useState<Enums<'pairing_mode'>>('by_rank');
  // Opens on the season's own games-per-player, still overridable per session.
  const [rounds, setRounds] = useState<number>(payload?.defaultRounds ?? 1);
  const [repeat, setRepeat] = useState<RepeatKey>('once');
  const [occurrences, setOccurrences] = useState<number>(6);
  const [scheduledAt, setScheduledAt] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(18, 0, 0, 0);
    return d;
  });

  const formatDate = useCallback(
    (d: Date): string =>
      d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    [locale]
  );
  const formatTime = useCallback((d: Date): string => formatTimeOfDay(d, locale), [locale]);

  const { mutate: createSession, isPending } = useCreateSession(seasonId, {
    onSuccess: created => {
      void SheetManager.hide(SHEET_ID).then(() => {
        successHaptic();
        toast.success(t('leagueDetail.sessions.created'));
        Analytics.sessionCreatedAnalytics({ leagueId, seasonId, sessionId: created.id });
      });
    },
    onError: e => {
      warningHaptic();
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          INVALID_NAME: 'leagueDetail.createErrors.invalidName',
          INVALID_SCHEDULE: 'leagueDetail.createErrors.invalidSchedule',
          SEASON_NOT_OPEN: 'leagueDetail.seasonErrors.seasonNotOpen',
        })
      );
    },
  });

  const { mutate: createSeries, isPending: isCreatingSeries } = useCreateSessionSeries(seasonId, {
    onSuccess: created => {
      void SheetManager.hide(SHEET_ID).then(() => {
        successHaptic();
        toast.success(t('leagueDetail.sessions.seriesCreated', { count: String(created.length) }));
        if (created[0]) {
          Analytics.sessionCreatedAnalytics({ leagueId, seasonId, sessionId: created[0].id });
        }
      });
    },
    onError: e => {
      warningHaptic();
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          SERIES_EXCEEDS_SEASON: 'leagueDetail.sessions.errors.seriesTooLong',
          INVALID_SCHEDULE: 'leagueDetail.createErrors.invalidSchedule',
          SEASON_NOT_OPEN: 'leagueDetail.seasonErrors.seasonNotOpen',
        })
      );
    },
  });

  const busy = isPending || isCreatingSeries;

  const handleClose = useCallback(() => {
    void SheetManager.hide(SHEET_ID);
  }, []);

  const handleDateChange = useCallback((date: Date) => {
    setScheduledAt(prev => {
      const next = new Date(prev);
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      return next;
    });
  }, []);

  const handleTimeChange = useCallback((date: Date) => {
    setScheduledAt(prev => {
      const next = new Date(prev);
      next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      warningHaptic();
      toast.error(t('leagueDetail.sessions.validation.nameRequired'));
      return;
    }
    if (scheduledAt <= new Date()) {
      warningHaptic();
      toast.error(t('leagueDetail.sessions.validation.future'));
      return;
    }
    const parsedCapacity = capacity.trim() ? Number.parseInt(capacity, 10) : NaN;
    const resolvedCapacity =
      Number.isFinite(parsedCapacity) && parsedCapacity > 0 ? parsedCapacity : undefined;
    const cadence = REPEAT_OPTIONS.find(o => o.key === repeat)?.days ?? 0;
    lightHaptic();
    if (cadence > 0) {
      createSeries({
        name: trimmed,
        firstAt: scheduledAt.toISOString(),
        repeatEveryDays: cadence,
        occurrences,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        capacity: resolvedCapacity,
        rounds,
        pairingMode,
      });
      return;
    }
    createSession({
      name: trimmed,
      scheduledAt: scheduledAt.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      capacity: resolvedCapacity,
      rounds,
      pairingMode,
    });
  }, [
    name,
    scheduledAt,
    capacity,
    rounds,
    pairingMode,
    repeat,
    occurrences,
    createSession,
    createSeries,
    toast,
    t,
  ]);

  return (
    <BaseActionSheet
      title={t('leagueDetail.sessions.createTitle')}
      onClose={handleClose}
      flex={false}
      scrollable
      footer={
        <Button
          variant="primary"
          fullWidth
          onPress={handleSubmit}
          disabled={busy}
          loading={busy}
          isDark={isDark}
          testID="cta-create-session-submit"
        >
          {busy ? t('leagueDetail.sessions.creating') : t('leagueDetail.sessions.submit')}
        </Button>
      }
    >
      <View style={styles.body}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('leagueDetail.sessions.namePlaceholder')}
          placeholderTextColor={colors.textMuted}
          testID="session-name-input"
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />
        <View style={styles.dateTimeRow}>
          <SheetDateField
            label={t('leagueDetail.sessions.date')}
            value={scheduledAt}
            displayValue={formatDate(scheduledAt)}
            mode="date"
            minimumDate={new Date()}
            onChange={handleDateChange}
            colors={colors}
            isDark={isDark}
            style={styles.dateTimeField}
            testID="session-date-field"
          />
          <SheetDateField
            label={t('leagueDetail.sessions.time')}
            value={scheduledAt}
            displayValue={formatTime(scheduledAt)}
            mode="time"
            onChange={handleTimeChange}
            colors={colors}
            isDark={isDark}
            style={styles.dateTimeField}
            testID="session-time-field"
          />
        </View>
        <TextInput
          value={capacity}
          onChangeText={setCapacity}
          placeholder={t('leagueDetail.sessions.capacityPlaceholder')}
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          testID="session-capacity-input"
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />

        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.text}>
            {t('leagueDetail.sessions.repeat.label')}
          </Text>
          <View style={styles.chipRow}>
            {REPEAT_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.key}
                onPress={() => {
                  lightHaptic();
                  setRepeat(option.key);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: repeat === option.key }}
                testID={`session-repeat-${option.key}`}
                style={[
                  styles.chip,
                  { borderColor: repeat === option.key ? colors.primary : colors.border },
                ]}
              >
                <Text
                  size="xs"
                  weight="semibold"
                  color={repeat === option.key ? colors.primary : colors.text}
                >
                  {t(`leagueDetail.sessions.repeat.${option.key}` as TranslationKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {repeat !== 'once' && (
            <>
              <Text size="xs" color={colors.textMuted}>
                {t('leagueDetail.sessions.repeat.countLabel')}
              </Text>
              <View style={styles.chipRow}>
                {OCCURRENCE_OPTIONS.map(n => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => {
                      lightHaptic();
                      setOccurrences(n);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: occurrences === n }}
                    testID={`session-occurrences-${n}`}
                    style={[
                      styles.chip,
                      { borderColor: occurrences === n ? colors.primary : colors.border },
                    ]}
                  >
                    <Text
                      size="sm"
                      weight="semibold"
                      color={occurrences === n ? colors.primary : colors.text}
                    >
                      {String(n)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text size="xs" color={colors.textMuted}>
                {t('leagueDetail.sessions.repeat.hint')}
              </Text>
            </>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.text}>
            {t('leagueDetail.sessions.rounds.label')}
          </Text>
          <Text size="xs" color={colors.textMuted}>
            {t('leagueDetail.sessions.rounds.hint')}
          </Text>
          <View style={styles.chipRow}>
            {ROUND_OPTIONS.map(value => (
              <TouchableOpacity
                key={value}
                onPress={() => {
                  lightHaptic();
                  setRounds(value);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: rounds === value }}
                testID={`session-rounds-${value}`}
                style={[
                  styles.chip,
                  { borderColor: rounds === value ? colors.primary : colors.border },
                ]}
              >
                <Text
                  size="sm"
                  weight="semibold"
                  color={rounds === value ? colors.primary : colors.text}
                >
                  {String(value)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.text}>
            {t('leagueDetail.sessions.pairing.label')}
          </Text>
          {PAIRING_MODES.map(mode => (
            <TouchableOpacity
              key={mode}
              onPress={() => {
                lightHaptic();
                setPairingMode(mode);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: pairingMode === mode }}
              testID={`session-pairing-${mode}`}
              style={[
                styles.option,
                { borderColor: pairingMode === mode ? colors.primary : colors.border },
              ]}
            >
              <View style={styles.optionText}>
                <Text size="sm" weight="semibold" color={colors.text}>
                  {t(`leagueDetail.sessions.pairing.${mode}.title`)}
                </Text>
                <Text size="xs" color={colors.textMuted}>
                  {t(`leagueDetail.sessions.pairing.${mode}.description`)}
                </Text>
              </View>
              {pairingMode === mode && (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </BaseActionSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacingPixels[3],
  },
  input: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    fontSize: 16,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  dateTimeField: {
    flex: 1,
  },
  fieldGroup: {
    gap: spacingPixels[2],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
  },
  optionText: {
    flex: 1,
    gap: spacingPixels[1],
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  chip: {
    minWidth: 52,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
  },
});

export default CreateSessionActionSheet;
