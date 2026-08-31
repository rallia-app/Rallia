/**
 * Tournament Availability Gate Sheet
 *
 * The scheduling gate (scheduling-funnel.md § 3, S1): a registered player
 * confirms or adjusts their hours for the phase window, which acknowledges the
 * phase, snapshots the grid server-side, and unlocks the pool room composer
 * and the pairing rooms. Skipping still answers the gate (ack with no hours).
 *
 * The grid edited here is seeded from the player's weekly availability but is
 * NOT written back to it: the gate freezes a phase-scoped snapshot, and only
 * an explicit profile edit changes the master grid.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Button, Text, useToast } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import { successHaptic } from '@rallia/shared-utils';
import { useSubmitPhaseAvailability } from '@rallia/shared-hooks';
import type { PhaseAvailabilityOutcome } from '@rallia/shared-services';
import type { DayEnum } from '@rallia/shared-types';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { useThemeStyles, useTranslation } from '#/hooks';
import { useLocale } from '#/context';
import { rpcErrorMessage, type RpcErrorOverrides } from '#/utils/rpcErrorMessage';
import { useAvailabilityKeys } from '#/features/weekly-checkin/api';
import {
  HourlyAvailabilityGrid,
  emptyGrid,
  type HourGrid,
} from '#/features/onboarding/components/HourlyAvailabilityGrid';
import { HourlyAvailabilityPresets } from '#/features/onboarding/components/HourlyAvailabilityPresets';

const SHEET_ID = 'tournament-availability-gate';

const ERROR_OVERRIDES: RpcErrorOverrides = {
  PHASE_DEADLINE_NOT_SET: 'tournamentDetail.availabilityGate.errorNoDeadline',
  PHASE_WINDOW_CLOSED: 'tournamentDetail.availabilityGate.errorWindowClosed',
  NOT_A_PARTICIPANT: 'tournamentDetail.availabilityGate.errorNotParticipant',
  TOURNAMENT_NOT_IN_PROGRESS: 'tournamentDetail.availabilityGate.errorNotInProgress',
};

export function TournamentAvailabilityGateSheet({
  payload,
}: SheetProps<'tournament-availability-gate'>) {
  const tournamentId = payload?.tournamentId ?? '';
  const bracketSide = payload?.bracketSide ?? 'pool';
  const roundNumber = payload?.roundNumber ?? 0;
  const phaseLabel = payload?.phaseLabel ?? '';
  const deadlineAt = payload?.deadlineAt ?? null;
  const minHours = payload?.minHours ?? null;
  const initialCells = payload?.initialCells ?? null;

  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const toast = useToast();

  // Seed once: from the previous answer's snapshot when reopening, else from
  // the player's weekly grid. Edits stay local to the phase either way.
  const { data: weeklyKeys } = useAvailabilityKeys({ enabled: !initialCells });
  const [selection, setSelection] = useState<HourGrid | null>(null);
  const [seed, setSeed] = useState<HourGrid>(emptyGrid());
  useEffect(() => {
    if (selection !== null) return;
    const source = initialCells ?? weeklyKeys;
    if (source) {
      const seeded: HourGrid = new Set(source);
      setSeed(seeded);
      setSelection(seeded);
    }
  }, [selection, weeklyKeys, initialCells]);

  const submit = useSubmitPhaseAvailability({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.availabilityGate.saved'));
      void SheetManager.hide(SHEET_ID);
    },
    onError: error => {
      toast.error(
        rpcErrorMessage(error, t, 'tournamentDetail.availabilityGate.errorGeneric', ERROR_OVERRIDES)
      );
    },
  });

  const dirty = useMemo(() => {
    if (selection === null) return false;
    if (selection.size !== seed.size) return true;
    for (const key of selection) if (!seed.has(key)) return true;
    return false;
  }, [selection, seed]);

  const gridColors = useMemo(
    () => ({
      text: colors.text,
      textSecondary: colors.textSecondary,
      textMuted: colors.textMuted,
      border: colors.inputBorder,
      cellInactive: colors.inputBackground,
      cellActive: colors.primary,
    }),
    [colors]
  );

  const presetColors = useMemo(
    () => ({
      presetActiveBg: colors.primary,
      presetInactiveBg: colors.inputBackground,
      presetActiveBorder: colors.primary,
      presetInactiveBorder: colors.inputBorder,
      presetActiveText: colors.primaryForeground,
      presetInactiveText: colors.text,
      textMuted: colors.textMuted,
      border: colors.inputBorder,
    }),
    [colors]
  );

  const windowHint = useMemo(() => {
    if (!deadlineAt) return null;
    return t('tournamentDetail.availabilityGate.window').replace(
      '{date}',
      new Date(deadlineAt).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
    );
  }, [deadlineAt, locale, t]);

  const handleSubmit = (outcome: PhaseAvailabilityOutcome) => {
    if (submit.isPending) return;
    const grid =
      outcome === 'skipped' || selection === null
        ? []
        : Array.from(selection).map(key => {
            const sepIdx = key.lastIndexOf('-');
            return { day: key.slice(0, sepIdx) as DayEnum, hour: Number(key.slice(sepIdx + 1)) };
          });
    submit.mutate({
      tournamentId,
      bracketSide,
      roundNumber,
      outcome,
      grid,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  };

  const belowMin =
    minHours !== null && minHours > 0 && selection !== null && selection.size < minHours;

  return (
    <BaseActionSheet
      title={phaseLabel || t('tournamentDetail.availabilityGate.title')}
      onClose={() => void SheetManager.hide(SHEET_ID)}
      scrollable={false}
      footer={
        <View style={styles.footer}>
          <Button
            onPress={() => handleSubmit(dirty ? 'edited' : 'confirmed')}
            disabled={selection === null || submit.isPending}
            loading={submit.isPending}
            fullWidth
            testID="gate-submit"
          >
            {dirty
              ? t('tournamentDetail.availabilityGate.saveEdited')
              : t('tournamentDetail.availabilityGate.confirm')}
          </Button>
          <TouchableOpacity
            onPress={() => handleSubmit('skipped')}
            disabled={submit.isPending}
            style={styles.skipButton}
            testID="gate-skip"
          >
            <Text size="sm" style={{ color: colors.textMuted }}>
              {t('tournamentDetail.availabilityGate.skip')}
            </Text>
          </TouchableOpacity>
        </View>
      }
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {windowHint && (
          <Text size="sm" style={{ color: colors.textMuted }}>
            {windowHint}
          </Text>
        )}

        {/* The consequence, at the moment the player decides whether to bother.
            Skipping is the single act most likely to lose them their games, and
            until now the only place that said so was the notification after it
            had already happened. */}
        <Text size="sm" style={[styles.stakes, { color: colors.text }]}>
          {t('tournamentDetail.availabilityGate.stakes')}
        </Text>
        <TouchableOpacity
          onPress={() => void SheetManager.show('tournament-rules')}
          testID="gate-rules-link"
        >
          <Text size="sm" weight="semibold" style={{ color: colors.primary }}>
            {t('tournamentDetail.availabilityGate.rulesLink')}
          </Text>
        </TouchableOpacity>

        {selection !== null && (
          <>
            <HourlyAvailabilityPresets
              value={selection}
              onChange={setSelection}
              colors={presetColors}
              t={t}
            />
            <View style={styles.gridWrapper}>
              <HourlyAvailabilityGrid
                value={selection}
                onChange={setSelection}
                colors={gridColors}
                t={t}
                locale={locale}
              />
            </View>
          </>
        )}

        {belowMin && (
          <Text size="xs" style={[styles.minHint, { color: colors.textMuted }]}>
            {t('tournamentDetail.availabilityGate.minHint').replace('{hours}', String(minHours))}
          </Text>
        )}
      </ScrollView>
    </BaseActionSheet>
  );
}

export default TournamentAvailabilityGateSheet;

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[2],
  },
  gridWrapper: {
    marginTop: spacingPixels[1],
  },
  stakes: {
    lineHeight: 20,
  },
  minHint: {
    textAlign: 'center',
  },
  footer: {
    gap: spacingPixels[2],
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
  },
});
