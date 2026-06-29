/**
 * Create Session Sheet
 *
 * Organizer-side single-step form to schedule a session inside a league's open
 * season. Replaces the former inline form on LeagueDetail's "sessions" tab. The
 * session mutation invalidates the season's sessions query, so the list
 * refreshes on its own.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Button, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useCreateSession } from '@rallia/shared-hooks';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { useThemeStyles, useTranslation } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';
import * as Analytics from '#/services/analytics';

import { SheetDateField } from './SheetDateField';

const SHEET_ID = 'create-session';

export function CreateSessionActionSheet({ payload }: SheetProps<'create-session'>) {
  const seasonId = payload?.seasonId ?? '';
  const leagueId = payload?.leagueId ?? '';

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();

  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
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
      toast.error(e.message || t('leagueDetail.errors.generic'));
    },
  });

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
    lightHaptic();
    createSession({
      name: trimmed,
      scheduledAt: scheduledAt.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      capacity: Number.isFinite(parsedCapacity) && parsedCapacity > 0 ? parsedCapacity : undefined,
    });
  }, [name, scheduledAt, capacity, createSession, toast, t]);

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
          disabled={isPending}
          loading={isPending}
          isDark={isDark}
          testID="cta-create-session-submit"
        >
          {isPending ? t('leagueDetail.sessions.creating') : t('leagueDetail.sessions.submit')}
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
});

export default CreateSessionActionSheet;
