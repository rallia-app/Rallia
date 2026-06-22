/**
 * Tournament Record Score Sheet
 *
 * Organizer-only authoritative score entry for a bracket match. Mirrors the
 * RegisterMatchScoreSheet UX (per-set inputs, add/remove sets, sport-specific
 * labels) — the two sides are the bracket's two registrations and the winner
 * is derived from the set scores. On submit it serializes the score as a
 * "p1-p2" string (player1 always on the left, so the bracket renderer orients
 * it correctly) and calls the override RPC with the derived winner.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
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
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useOverrideTournamentMatchScore } from '@rallia/shared-hooks';
import type { Enums } from '@rallia/shared-types';

import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';

const MAX_SETS = 5;
const BASE_WHITE = '#ffffff';

// Sets the organizer can enter, per the tournament's match format: the cap on
// set count and how many set wins clinch the match (so we stop offering "add
// set" once the result is already decided). Pickleball "to N" formats are
// single games. Unknown/absent format falls back to the old loose cap.
const FORMAT_SET_RULES: Partial<
  Record<Enums<'match_format'>, { maxSets: number; setsToWin: number }>
> = {
  one_set: { maxSets: 1, setsToWin: 1 },
  two_of_three: { maxSets: 3, setsToWin: 2 },
  three_of_five: { maxSets: 5, setsToWin: 3 },
  pickleball_to_11: { maxSets: 1, setsToWin: 1 },
  pickleball_to_15: { maxSets: 1, setsToWin: 1 },
  pickleball_to_21: { maxSets: 1, setsToWin: 1 },
};

function setRulesFor(format: Enums<'match_format'> | undefined): {
  maxSets: number;
  setsToWin: number;
} {
  return (format && FORMAT_SET_RULES[format]) || { maxSets: MAX_SETS, setsToWin: MAX_SETS + 1 };
}

interface SetScore {
  player1Score: number | null;
  player2Score: number | null;
}

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
 * Validate a single score value against sport-specific ranges.
 * Returns a warning translation key if the score seems unusual, null otherwise.
 */
function getScoreWarning(score: number | null, isPickleballSport: boolean): TranslationKey | null {
  if (score === null) return null;
  if (isPickleballSport) {
    if (score > 25) return 'registerMatchScore.error.pickleballScoreRange';
  } else {
    if (score > 7) return 'registerMatchScore.error.tennisScoreRange';
  }
  return null;
}

/** Derive winning side (1 = player1, 2 = player2) — whoever took more sets. */
function deriveWinningSideFromSets(sets: SetScore[]): 1 | 2 | null {
  let p1Wins = 0;
  let p2Wins = 0;
  for (const s of sets) {
    if (s.player1Score === null || s.player2Score === null) continue;
    if (s.player1Score > s.player2Score) p1Wins += 1;
    else if (s.player2Score > s.player1Score) p2Wins += 1;
  }
  if (p1Wins > p2Wins) return 1;
  if (p2Wins > p1Wins) return 2;
  return null;
}

/** Serialize valid sets to the bracket score string, player1 always on the left ("6-4 6-2"). */
function serializeSets(sets: SetScore[]): string {
  return sets
    .filter(s => s.player1Score !== null && s.player2Score !== null)
    .map(s => `${s.player1Score}-${s.player2Score}`)
    .join(' ');
}

/** Map an override RPC error message to a user-facing translation key. */
function overrideErrorKey(message: string): TranslationKey {
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
  const [scoreWarning, setScoreWarning] = useState<TranslationKey | null>(null);

  const validSets = useMemo(
    () => sets.filter(s => s.player1Score !== null && s.player2Score !== null),
    [sets]
  );
  const winningSide = useMemo(() => deriveWinningSideFromSets(validSets), [validSets]);

  // Cap set entry to the tournament's match-format winning-sets logic.
  const { maxSets, setsToWin } = useMemo(() => setRulesFor(matchFormat), [matchFormat]);
  const someoneClinched = useMemo(() => {
    let p1 = 0;
    let p2 = 0;
    for (const s of validSets) {
      if (s.player1Score === null || s.player2Score === null) continue;
      if (s.player1Score > s.player2Score) p1 += 1;
      else if (s.player2Score > s.player1Score) p2 += 1;
    }
    return p1 >= setsToWin || p2 >= setsToWin;
  }, [validSets, setsToWin]);
  const canAddSet = sets.length < maxSets && !someoneClinched;

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

  const canSubmit = validSets.length > 0 && winningSide !== null && !override.isPending;

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

  const handleAddSet = useCallback(() => {
    if (canAddSet) {
      lightHaptic();
      setSets(prev => [...prev, { player1Score: null, player2Score: null }]);
    }
  }, [canAddSet]);

  const handleRemoveSet = useCallback(
    (setIndex: number) => {
      if (sets.length <= 1 || setIndex < 0 || setIndex >= sets.length) return;
      lightHaptic();
      setSets(prev => prev.filter((_, i) => i !== setIndex));
      setError(null);
    },
    [sets.length]
  );

  const leftInputRefs = useRef<(TextInput | null)[]>([]);
  const rightInputRefs = useRef<(TextInput | null)[]>([]);

  const handleScoreChange = useCallback(
    (setIndex: number, side: 'player1' | 'player2', value: string) => {
      const numValue = value === '' ? null : parseInt(value, 10);
      if (numValue !== null && (isNaN(numValue) || numValue < 0 || numValue > 99)) {
        return;
      }
      setSets(prev =>
        prev.map((set, i) =>
          i === setIndex
            ? {
                ...set,
                [side === 'player1' ? 'player1Score' : 'player2Score']: numValue,
              }
            : set
        )
      );
      setError(null);
      setScoreWarning(getScoreWarning(numValue, isPickleballSport));
      // Auto-advance: one digit in left input → focus right input
      if (side === 'player1' && value.length === 1) {
        setTimeout(() => rightInputRefs.current[setIndex]?.focus(), 0);
      }
      // Auto-move back: right input cleared → focus left input
      if (side === 'player2' && value === '') {
        setTimeout(() => leftInputRefs.current[setIndex]?.focus(), 0);
      }
    },
    [isPickleballSport]
  );

  const handleSubmit = useCallback(() => {
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
    Keyboard.dismiss();
    lightHaptic();
    setError(null);
    override.mutate({
      tournamentMatchId,
      winnerRegistrationId: winningSide === 1 ? player1RegId : player2RegId,
      score: serializeSets(validSets),
      tournamentId,
    });
  }, [
    validSets,
    winningSide,
    isPickleballSport,
    override,
    tournamentMatchId,
    tournamentId,
    player1RegId,
    player2RegId,
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

          <Text size="sm" weight="semibold" color={colors.textMuted} style={styles.sectionLabel}>
            {t(isPickleballSport ? 'registerMatchScore.games' : 'registerMatchScore.sets')}
          </Text>
          <Text size="xs" color={colors.textMuted} style={styles.scoreHint}>
            {t(
              isPickleballSport
                ? 'registerMatchScore.pickleballScoreHint'
                : 'registerMatchScore.tennisScoreHint'
            )}
          </Text>

          {sets.map((set, idx) => (
            <View
              key={idx}
              style={[
                styles.setCard,
                { backgroundColor: colors.buttonInactive, borderColor: colors.border },
              ]}
            >
              <View style={styles.setCardHeader}>
                <Text
                  size="sm"
                  weight="medium"
                  color={colors.textMuted}
                  style={styles.setCardLabel}
                >
                  {t(isPickleballSport ? 'registerMatchScore.gameN' : 'registerMatchScore.setN', {
                    number: idx + 1,
                  })}
                </Text>
                {sets.length > 1 && idx > 0 && (
                  <TouchableOpacity
                    onPress={() => handleRemoveSet(idx)}
                    style={styles.removeSetButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={t(
                      isPickleballSport
                        ? 'registerMatchScore.removeGame'
                        : 'registerMatchScore.removeSet'
                    )}
                    accessibilityRole="button"
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.setCardLabelsRow}>
                <View style={styles.scoreCell}>
                  <Text
                    size="xs"
                    weight="medium"
                    color={colors.textMuted}
                    style={styles.scoreCellLabel}
                    numberOfLines={1}
                  >
                    {player1Name}
                  </Text>
                </View>
                <View style={styles.setCardDashSpacer} />
                <View style={styles.scoreCell}>
                  <Text
                    size="xs"
                    weight="medium"
                    color={colors.textMuted}
                    style={styles.scoreCellLabel}
                    numberOfLines={1}
                  >
                    {player2Name}
                  </Text>
                </View>
              </View>
              <View style={styles.setCardInputsRow}>
                <View style={styles.scoreCell}>
                  <TextInput
                    ref={el => {
                      leftInputRefs.current[idx] = el;
                    }}
                    style={[
                      styles.scoreInput,
                      {
                        backgroundColor: colors.cardBackground,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    value={set.player1Score !== null ? String(set.player1Score) : ''}
                    onChangeText={v => handleScoreChange(idx, 'player1', v)}
                    testID={`score-input-p1-${idx}`}
                  />
                </View>
                <Text
                  size="base"
                  weight="medium"
                  color={colors.textMuted}
                  style={styles.setCardDash}
                >
                  –
                </Text>
                <View style={styles.scoreCell}>
                  <TextInput
                    ref={el => {
                      rightInputRefs.current[idx] = el;
                    }}
                    style={[
                      styles.scoreInput,
                      {
                        backgroundColor: colors.cardBackground,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    value={set.player2Score !== null ? String(set.player2Score) : ''}
                    onChangeText={v => handleScoreChange(idx, 'player2', v)}
                    testID={`score-input-p2-${idx}`}
                  />
                </View>
              </View>
            </View>
          ))}

          {canAddSet && (
            <TouchableOpacity
              style={[styles.addSetButton, { borderColor: colors.border }]}
              onPress={handleAddSet}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={22} color={colors.buttonActive} />
              <Text
                size="base"
                weight="medium"
                color={colors.buttonActive}
                style={styles.addSetLabel}
              >
                {t(isPickleballSport ? 'registerMatchScore.addGame' : 'registerMatchScore.addSet')}
              </Text>
            </TouchableOpacity>
          )}

          {scoreWarning && !error ? (
            <View style={styles.warningRow}>
              <Ionicons name="warning-outline" size={18} color="#F59E0B" />
              <Text size="sm" color="#F59E0B">
                {t(scoreWarning)}
              </Text>
            </View>
          ) : null}

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
  sectionLabel: {
    marginBottom: spacingPixels[2],
    marginTop: spacingPixels[4],
  },
  setCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
  },
  setCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  setCardLabel: {
    marginBottom: 0,
  },
  removeSetButton: {
    padding: spacingPixels[1],
  },
  setCardLabelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[1],
  },
  setCardDashSpacer: {
    minWidth: 20,
  },
  setCardInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  scoreCell: {
    flex: 1,
    minWidth: 0,
  },
  scoreCellLabel: {
    minWidth: 0,
  },
  setCardDash: {
    minWidth: 20,
    textAlign: 'center',
  },
  scoreInput: {
    flex: 1,
    minWidth: 56,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    fontSize: 18,
    textAlign: 'center',
  },
  addSetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  addSetLabel: {
    marginLeft: spacingPixels[1],
  },
  scoreHint: {
    marginBottom: spacingPixels[3],
    marginTop: -spacingPixels[1],
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
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
