/**
 * Create Season Sheet
 *
 * Organizer-side single-step form to create a season for a league. Replaces the
 * former inline form on LeagueDetail's "seasons" tab. The season mutation
 * invalidates the league's seasons query, so the list refreshes on its own.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Button, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useCreateSeason } from '@rallia/shared-hooks';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { useThemeStyles, useTranslation } from '#/hooks';
import * as Analytics from '#/services/analytics';

import { SheetDateField } from './SheetDateField';

const SHEET_ID = 'create-season';

export function CreateSeasonActionSheet({ payload }: SheetProps<'create-season'>) {
  const leagueId = payload?.leagueId ?? '';

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState<Date>(() => new Date());
  const [endDate, setEndDate] = useState<Date>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d;
  });

  const formatDate = useCallback(
    (d: Date): string =>
      d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    [locale]
  );

  const { mutate: createSeason, isPending } = useCreateSeason(leagueId, {
    onSuccess: season => {
      void SheetManager.hide(SHEET_ID).then(() => {
        successHaptic();
        toast.success(t('leagueDetail.seasonCreated'));
        Analytics.seasonCreatedAnalytics({ leagueId, seasonId: season.id, hasOverride: false });
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

  const handleStartChange = useCallback((date: Date) => {
    setStartDate(date);
    setEndDate(prev => (prev < date ? date : prev));
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      warningHaptic();
      toast.error(t('leagueDetail.validation.seasonNameRequired'));
      return;
    }
    if (endDate < startDate) {
      warningHaptic();
      toast.error(t('leagueDetail.validation.endBeforeStart'));
      return;
    }
    lightHaptic();
    createSeason({
      name: trimmed,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    });
  }, [name, startDate, endDate, createSeason, toast, t]);

  return (
    <BaseActionSheet
      title={t('leagueDetail.createSeason.title')}
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
          testID="cta-create-season-submit"
        >
          {isPending
            ? t('leagueDetail.createSeason.creating')
            : t('leagueDetail.createSeason.submit')}
        </Button>
      }
    >
      <View style={styles.body}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('leagueDetail.createSeason.namePlaceholder')}
          placeholderTextColor={colors.textMuted}
          testID="season-name-input"
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />
        <SheetDateField
          label={t('leagueDetail.createSeason.startDate')}
          value={startDate}
          displayValue={formatDate(startDate)}
          mode="date"
          onChange={handleStartChange}
          colors={colors}
          isDark={isDark}
          testID="season-start-field"
        />
        <SheetDateField
          label={t('leagueDetail.createSeason.endDate')}
          value={endDate}
          displayValue={formatDate(endDate)}
          mode="date"
          minimumDate={startDate}
          onChange={setEndDate}
          colors={colors}
          isDark={isDark}
          testID="season-end-field"
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
});

export default CreateSeasonActionSheet;
