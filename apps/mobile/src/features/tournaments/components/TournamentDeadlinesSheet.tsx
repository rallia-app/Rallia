/**
 * Tournament Round Deadlines Sheet
 *
 * Organizer-only editor for the pool-phase and knockout-round deadlines that
 * every automated resolution keys on. Without one the resolver never runs, so
 * this is the switch that arms the whole funnel.
 *
 * The deadline is absolute (unplayed-match-resolution principle 7): nothing
 * extends it later, so it can only be moved while it is still ahead, and
 * pulling one closer than 48 h is refused rather than stealing a window that
 * was already promised to the players.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Button, Text, useToast } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import { successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useTournamentRoundDeadlines, useSetTournamentRoundDeadlines } from '@rallia/shared-hooks';
import type { RoundDeadlineInput } from '@rallia/shared-services';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { SheetDateField } from '#/components/SheetDateField';
import { roundLabel } from '#/features/tournaments/detail/BracketSection';
import { useThemeStyles, useTranslation } from '#/hooks';
import { rpcErrorMessage } from '#/utils/rpcErrorMessage';

const SHEET_ID = 'tournament-deadlines';

/** Pulling a deadline closer than this steals a window players were promised. */
const MIN_NOTICE_MS = 48 * 3600000;

interface RoundRow {
  key: string;
  bracketSide: 'pool' | 'main';
  roundNumber: number;
  label: string;
}

/** A deadline means "playable through the end of that day", never 00:00. */
const endOfDay = (d: Date): Date => {
  const out = new Date(d);
  out.setHours(23, 59, 0, 0);
  return out;
};

export function TournamentDeadlinesActionSheet({ payload }: SheetProps<'tournament-deadlines'>) {
  const tournamentId = payload?.tournamentId ?? '';
  const hasPoolPhase = payload?.hasPoolPhase ?? false;
  const knockoutRounds = useMemo(() => payload?.knockoutRounds ?? [], [payload?.knockoutRounds]);
  const totalRounds = payload?.totalRounds ?? 0;

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const toast = useToast();

  const { data: existing = [] } = useTournamentRoundDeadlines(tournamentId);

  const rows: RoundRow[] = useMemo(() => {
    const out: RoundRow[] = [];
    if (hasPoolPhase) {
      out.push({
        key: 'pool:0',
        bracketSide: 'pool',
        roundNumber: 0,
        label: t('tournamentDetail.deadlinesEditor.poolPhase'),
      });
    }
    for (const round of knockoutRounds) {
      out.push({
        key: `main:${round}`,
        bracketSide: 'main',
        roundNumber: round,
        label: roundLabel(round, totalRounds, t),
      });
    }
    return out;
  }, [hasPoolPhase, knockoutRounds, totalRounds, t]);

  const saved = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of existing) map[`${d.bracket_side}:${d.round_number}`] = d.deadline_at;
    return map;
  }, [existing]);

  // Only the rows the organizer actually touched are sent, so an untouched
  // round never re-notifies its players.
  const [edits, setEdits] = useState<Record<string, Date>>({});

  // Read the clock once, at open: the sheet is short-lived, and reading it
  // during render is impure (React Compiler is on).
  const [openedAt] = useState(() => Date.now());

  const valueFor = useCallback(
    (key: string): Date | null => {
      if (edits[key]) return edits[key];
      const iso = saved[key];
      return iso ? new Date(iso) : null;
    },
    [edits, saved]
  );

  const formatDay = useCallback(
    (d: Date): string =>
      d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    [locale]
  );

  const handlePick = useCallback((key: string, date: Date) => {
    setEdits(prev => ({ ...prev, [key]: endOfDay(date) }));
  }, []);

  const setDeadlines = useSetTournamentRoundDeadlines({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.deadlinesEditor.saved'));
      void SheetManager.hide(SHEET_ID);
    },
    onError: e => {
      warningHaptic();
      toast.error(
        rpcErrorMessage(e, t, 'tournamentDetail.deadlinesEditor.errorGeneric', {
          DEADLINES_NOT_INCREASING: 'tournamentDetail.deadlinesEditor.errorNotIncreasing',
          DEADLINE_IN_PAST: 'tournamentDetail.deadlinesEditor.errorInPast',
          DEADLINE_PASSED: 'tournamentDetail.deadlinesEditor.errorPassed',
          DEADLINE_TOO_SOON: 'tournamentDetail.deadlinesEditor.errorTooSoon',
          TOURNAMENT_NOT_READY: 'tournamentDetail.deadlinesEditor.errorNotReady',
          INVALID_DEADLINES: 'tournamentDetail.deadlinesEditor.errorInvalid',
        })
      );
    },
  });

  const handleClose = useCallback(() => {
    void SheetManager.hide(SHEET_ID);
  }, []);

  const handleSave = useCallback(() => {
    if (setDeadlines.isPending) return;
    const changed = Object.keys(edits);
    if (changed.length === 0) {
      void SheetManager.hide(SHEET_ID);
      return;
    }
    const now = Date.now();

    for (const key of changed) {
      const next = edits[key].getTime();
      if (next <= now) {
        warningHaptic();
        toast.error(t('tournamentDetail.deadlinesEditor.errorInPast'));
        return;
      }
      const before = saved[key] ? new Date(saved[key]).getTime() : null;
      // Reached means settled: the pairing is decided and the clock is not the
      // way back (unplayed-match-resolution § 9).
      if (before !== null && before <= now) {
        warningHaptic();
        toast.error(t('tournamentDetail.deadlinesEditor.errorPassed'));
        return;
      }
      // Moving one closer is the only direction that can hurt a player who
      // was already counting on the old date.
      if (before !== null && next < before && next - now < MIN_NOTICE_MS) {
        warningHaptic();
        toast.error(t('tournamentDetail.deadlinesEditor.errorTooSoon'));
        return;
      }
    }

    // The knockout ladder has to stay strictly increasing across rounds; the
    // RPC refuses otherwise, and catching it here names the offending round.
    const mainRows = rows.filter(r => r.bracketSide === 'main');
    let previous: number | null = null;
    for (const row of mainRows) {
      const at = valueFor(row.key)?.getTime();
      if (at === undefined) continue;
      if (previous !== null && at <= previous) {
        warningHaptic();
        toast.error(
          t('tournamentDetail.deadlinesEditor.errorNotIncreasingRound').replace(
            '{round}',
            row.label
          )
        );
        return;
      }
      previous = at;
    }

    const input: RoundDeadlineInput[] = changed.map(key => {
      const row = rows.find(r => r.key === key)!;
      return {
        bracketSide: row.bracketSide,
        roundNumber: row.roundNumber,
        deadlineAt: edits[key].toISOString(),
      };
    });
    setDeadlines.mutate({ tournamentId, rounds: input });
  }, [edits, rows, saved, setDeadlines, t, toast, tournamentId, valueFor]);

  const dirty = Object.keys(edits).length > 0;

  return (
    <BaseActionSheet
      title={t('tournamentDetail.deadlinesEditor.title')}
      onClose={handleClose}
      flex={false}
      scrollable
      footer={
        <Button
          onPress={handleSave}
          disabled={!dirty || setDeadlines.isPending}
          loading={setDeadlines.isPending}
          fullWidth
        >
          {t('tournamentDetail.deadlinesEditor.save')}
        </Button>
      }
    >
      <View style={styles.body}>
        <Text size="sm" color={colors.textMuted}>
          {t('tournamentDetail.deadlinesEditor.hint')}
        </Text>

        {rows.map(row => {
          const value = valueFor(row.key);
          const passed = value !== null && value.getTime() <= openedAt;
          return (
            <View key={row.key} style={styles.row}>
              <SheetDateField
                label={row.label}
                value={value ?? endOfDay(new Date(openedAt))}
                displayValue={
                  value ? formatDay(value) : t('tournamentDetail.deadlinesEditor.notSet')
                }
                mode="date"
                minimumDate={new Date(openedAt)}
                onChange={date => handlePick(row.key, date)}
                colors={colors}
                isDark={isDark}
                testID={`deadline-field-${row.key}`}
              />
              {passed && (
                <Text size="xs" color={colors.textMuted}>
                  {t('tournamentDetail.deadlinesEditor.passed')}
                </Text>
              )}
            </View>
          );
        })}

        {rows.length === 0 && (
          <Text size="sm" color={colors.textMuted}>
            {t('tournamentDetail.deadlinesEditor.noRounds')}
          </Text>
        )}
      </View>
    </BaseActionSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[4],
    gap: spacingPixels[3],
  },
  row: { gap: spacingPixels[1] },
});
