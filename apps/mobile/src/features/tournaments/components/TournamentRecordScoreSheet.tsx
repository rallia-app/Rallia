/**
 * Tournament Record Score Sheet
 *
 * Organizer-only authoritative score entry for a bracket match. The set grid
 * and the scoring rules are shared with the league-session sheet
 * (ScoreEntrySets + shared-utils scoreEntry); what stays here is the bracket
 * wiring: the two sides are the bracket's two registrations, the winner is
 * derived from the sets, and submit serializes to a "p1-p2" string (player1
 * always on the left, so the bracket renderer orients it) before calling the
 * override RPC.
 *
 * Since 20260825120000 the sheet records an OUTCOME rather than always a
 * score: forfait, abandon and annulée say a game did not happen, which is what
 * Série 1 lacked when 39% of its pairings were advanced by typing a generic
 * 8-6. Only 'completed' needs the set grid; the two walkover-shaped outcomes
 * need a winner and nothing else, and a cancellation needs neither.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  Alert,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  deriveWinningSideFromSets,
  serializeSets,
  validSetsOf,
  firstSetFailingFormat,
  setTargetFor,
  type SetScore,
} from '@rallia/shared-utils';
import { useOverrideTournamentMatchScore } from '@rallia/shared-hooks';
import type { TournamentMatchOutcome } from '@rallia/shared-services';

import { ScoreEntrySets } from '#/components/ScoreEntrySets';
import { useTranslation, useThemeStyles, type TranslationKey } from '#/hooks';

const BASE_WHITE = '#ffffff';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
}

/**
 * Offered in the order an organizer reaches for them: a real score first, then
 * the three ways a game did not happen. 'cancelled' is filtered out on a
 * knockout row, where the server refuses it anyway.
 */
const OUTCOMES = [
  'completed',
  'walkover',
  'retired',
  'cancelled',
] as const satisfies readonly TournamentMatchOutcome[];

/** Map an override RPC error message to a user-facing translation key. */
function overrideErrorKey(message: string): TranslationKey {
  if (message.includes('CANCEL_NEEDS_BRACKET_OUTCOME'))
    return 'tournamentDetail.override.errors.cancelNeedsBracketOutcome';
  if (message.includes('WINNER_REQUIRED')) return 'tournamentDetail.override.errors.winnerRequired';
  if (message.includes('NEXT_MATCH_ALREADY_PLAYED'))
    return 'tournamentDetail.override.errors.nextMatchPlayed';
  if (message.includes('MATCH_NOT_OVERRIDABLE'))
    return 'tournamentDetail.override.errors.notOverridable';
  if (message.includes('WINNER_NOT_IN_MATCH'))
    return 'tournamentDetail.override.errors.winnerNotInMatch';
  if (message.includes('TOURNAMENT_NOT_IN_PROGRESS'))
    return 'tournamentDetail.override.errors.notInProgress';
  if (message.includes('MATCH_SLOTS_INCOMPLETE'))
    return 'tournamentDetail.override.errors.slotsIncomplete';
  if (message.includes('CORRECTION_WINDOW_CLOSED'))
    return 'tournamentDetail.override.errors.correctionWindowClosed';
  return 'tournamentDetail.override.errors.generic';
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TournamentRecordScoreActionSheet({
  payload,
}: SheetProps<'tournament-record-score'>) {
  const tournamentMatchId = payload?.tournamentMatchId ?? '';
  const tournamentId = payload?.tournamentId ?? '';
  const player1RegId = payload?.player1RegId ?? '';
  const player2RegId = payload?.player2RegId ?? '';
  const player1Name = payload?.player1Name ?? '';
  const player2Name = payload?.player2Name ?? '';
  const isPickleballSport = payload?.isPickleball ?? false;
  const matchFormat = payload?.matchFormat;
  const pointsPerGame = payload?.pointsPerGame ?? null;
  const isFinal = payload?.isFinal ?? false;
  const isPoolMatch = payload?.isPoolMatch ?? false;
  const onSuccess = payload?.onSuccess;
  const onDismiss = payload?.onDismiss;

  const { isDark } = useThemeStyles();
  const { t } = useTranslation();

  const theme = isDark ? darkTheme : lightTheme;
  const colors: ThemeColors = useMemo(
    () => ({
      background: theme.background,
      cardBackground: theme.card,
      text: theme.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: theme.mutedForeground,
      border: theme.border,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonInactive: theme.muted,
      buttonTextActive: BASE_WHITE,
    }),
    [theme, isDark]
  );

  const [sets, setSets] = useState<SetScore[]>([{ player1Score: null, player2Score: null }]);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TournamentMatchOutcome>('completed');
  // Only meaningful for the outcomes that have a winner but no score to derive
  // it from. 1 = player 1, 2 = player 2, mirroring winningSide.
  const [declaredSide, setDeclaredSide] = useState<1 | 2 | null>(null);

  const validSets = useMemo(() => validSetsOf(sets), [sets]);
  const winningSide = useMemo(() => deriveWinningSideFromSets(validSets), [validSets]);

  // Track whether submit succeeded so onClose can skip the dismiss callback.
  const didSubmitRef = useRef(false);

  const override = useOverrideTournamentMatchScore({
    onSuccess: () => {
      successHaptic();
      didSubmitRef.current = true;
      SheetManager.hide('tournament-record-score');
      onSuccess?.();
    },
    onError: e => {
      warningHaptic();
      setError(t(overrideErrorKey(e.message || '')));
    },
  });

  // What each outcome needs before it can be written: a score for a real
  // result, a named winner for the two walkover-shaped ones, nothing at all
  // for a cancellation.
  const canSubmit =
    !override.isPending &&
    (outcome === 'cancelled'
      ? true
      : outcome === 'completed'
        ? validSets.length > 0 && winningSide !== null
        : declaredSide !== null);

  const handleSheetClose = useCallback(() => {
    if (!didSubmitRef.current) {
      onDismiss?.();
    }
    didSubmitRef.current = false;
  }, [onDismiss]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    lightHaptic();
    SheetManager.hide('tournament-record-score');
  }, []);

  const handleSubmit = useCallback(() => {
    // The three outcomes that say no game happened skip the score rules
    // entirely: there is nothing to validate about a match nobody played.
    if (outcome !== 'completed') {
      if (outcome !== 'cancelled' && declaredSide === null) {
        setError(t('registerMatchScore.error.noWinner'));
        return;
      }
      Keyboard.dismiss();
      lightHaptic();
      setError(null);
      override.mutate({
        tournamentMatchId,
        winnerRegistrationId:
          outcome === 'cancelled' ? null : declaredSide === 1 ? player1RegId : player2RegId,
        // A retirement keeps whatever was played up to the abandon; a walkover
        // has no score at all and the server stamps its own W/O.
        score: outcome === 'retired' && validSets.length > 0 ? serializeSets(validSets) : undefined,
        outcome,
        tournamentId,
      });
      return;
    }

    if (validSets.length === 0) {
      setError(
        t(
          isPickleballSport
            ? 'registerMatchScore.error.enterGames'
            : 'registerMatchScore.error.enterScores'
        )
      );
      return;
    }
    if (!winningSide) {
      setError(t('registerMatchScore.error.noWinner'));
      return;
    }
    // A score from the other sport (6-4 in a to-11 draw) used to be accepted
    // outright; the format's target is the only thing that can rule it out.
    const badSet = firstSetFailingFormat(validSets, matchFormat, pointsPerGame);
    if (badSet !== null) {
      setError(
        t('registerMatchScore.error.formatMismatch', {
          set: String(badSet),
          target: String(setTargetFor(matchFormat, pointsPerGame) ?? ''),
        })
      );
      return;
    }
    Keyboard.dismiss();
    lightHaptic();
    setError(null);

    const submit = () =>
      override.mutate({
        tournamentMatchId,
        winnerRegistrationId: winningSide === 1 ? player1RegId : player2RegId,
        score: serializeSets(validSets),
        tournamentId,
      });

    // The final crowns the champion and releases the ranking points, and it can
    // only be corrected for a short window afterwards. Confirm before writing.
    if (isFinal) {
      Alert.alert(
        t('tournamentDetail.override.confirmFinal.title'),
        t('tournamentDetail.override.confirmFinal.message', {
          champion: winningSide === 1 ? player1Name : player2Name,
          score: serializeSets(validSets),
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('tournamentDetail.override.confirmFinal.cta'), onPress: submit },
        ]
      );
      return;
    }

    submit();
  }, [
    validSets,
    winningSide,
    outcome,
    declaredSide,
    isPickleballSport,
    isFinal,
    matchFormat,
    pointsPerGame,
    override,
    tournamentMatchId,
    tournamentId,
    player1RegId,
    player2RegId,
    player1Name,
    player2Name,
    t,
  ]);

  return (
    <ActionSheet
      gestureEnabled
      onClose={handleSheetClose}
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft} />
          <Text
            size="lg"
            weight="semibold"
            color={colors.text}
            style={styles.headerTitle}
            numberOfLines={1}
          >
            {t('tournamentDetail.override.title')}
          </Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.headerButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content: set scores */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('tournamentDetail.override.subtitle')}
          </Text>

          {/* What happened. Naming it is the whole point: without these the
              only way to settle an unplayed pairing was to invent a score. */}
          <View style={styles.outcomeRow}>
            {OUTCOMES.filter(o => o !== 'cancelled' || isPoolMatch).map(o => (
              <TouchableOpacity
                key={o}
                onPress={() => {
                  lightHaptic();
                  setOutcome(o);
                  setError(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: outcome === o }}
                testID={`override-outcome-${o}`}
                style={[
                  styles.outcomeChip,
                  { borderColor: outcome === o ? colors.buttonActive : colors.border },
                ]}
              >
                <Text
                  size="sm"
                  weight="semibold"
                  color={outcome === o ? colors.buttonActive : colors.text}
                >
                  {t(`tournamentDetail.override.outcome.${o}` as TranslationKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {outcome === 'completed' ? (
            <ScoreEntrySets
              sets={sets}
              onSetsChange={setSets}
              player1Name={player1Name}
              player2Name={player2Name}
              isPickleball={isPickleballSport}
              matchFormat={matchFormat}
              colors={colors}
              onDirty={() => setError(null)}
            />
          ) : outcome === 'cancelled' ? (
            <Text size="sm" color={colors.textMuted} style={styles.outcomeHint}>
              {t('tournamentDetail.override.outcome.cancelledHint')}
            </Text>
          ) : (
            <>
              <Text size="sm" color={colors.textMuted} style={styles.outcomeHint}>
                {t(
                  outcome === 'walkover'
                    ? 'tournamentDetail.override.outcome.walkoverHint'
                    : 'tournamentDetail.override.outcome.retiredHint'
                )}
              </Text>
              <View style={styles.outcomeRow}>
                {([1, 2] as const).map(side => (
                  <TouchableOpacity
                    key={side}
                    onPress={() => {
                      lightHaptic();
                      setDeclaredSide(side);
                      setError(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: declaredSide === side }}
                    testID={`override-winner-${side}`}
                    style={[
                      styles.outcomeChip,
                      { borderColor: declaredSide === side ? colors.buttonActive : colors.border },
                    ]}
                  >
                    <Text
                      size="sm"
                      weight="semibold"
                      color={declaredSide === side ? colors.buttonActive : colors.text}
                    >
                      {side === 1 ? player1Name : player2Name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* A retirement still has the score played up to the abandon. */}
              {outcome === 'retired' ? (
                <ScoreEntrySets
                  sets={sets}
                  onSetsChange={setSets}
                  player1Name={player1Name}
                  player2Name={player2Name}
                  isPickleball={isPickleballSport}
                  matchFormat={matchFormat}
                  colors={colors}
                  onDirty={() => setError(null)}
                />
              ) : null}
            </>
          )}

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={18} color={colors.textMuted} />
              <Text size="sm" color={colors.textMuted}>
                {error}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              {
                backgroundColor: canSubmit ? colors.buttonActive : colors.buttonInactive,
              },
              !canSubmit && styles.primaryButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.8}
            testID="record-score-save"
          >
            {override.isPending ? (
              <ActivityIndicator color={colors.buttonTextActive} />
            ) : (
              <>
                <Text
                  size="lg"
                  weight="semibold"
                  color={canSubmit ? colors.buttonTextActive : colors.textMuted}
                >
                  {t('tournamentDetail.override.confirm')}
                </Text>
                <Ionicons
                  name="checkmark"
                  size={20}
                  color={canSubmit ? colors.buttonTextActive : colors.textMuted}
                />
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

// =============================================================================
// STYLES (aligned with RegisterMatchScoreSheet)
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  subtitle: {
    marginTop: spacingPixels[3],
  },
  outcomeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
    marginTop: spacingPixels[3],
  },
  outcomeChip: {
    borderWidth: 1,
    borderRadius: radiusPixels.full,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
  },
  outcomeHint: {
    marginTop: spacingPixels[3],
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[4],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[6],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
});
