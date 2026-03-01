/**
 * Register Match Score Sheet
 *
 * Single-step form for registering the match score (from match detail during
 * the 48h feedback window). For doubles: select your partner then enter set
 * scores. Winner is derived from the scores (team that won more sets).
 *
 * Possible scores (per set/game):
 * - Tennis: games per set, typically 0–7 (6 to win, 7 if tiebreak 7-6).
 * - Pickleball: points per game, typically to 11, 15, or 21 (win by 2).
 * Inputs allow 0–99; focus auto-advances after one digit for faster entry.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
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
import { lightHaptic, selectionHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { usePlayer } from '@rallia/shared-hooks';
import { submitMatchResultForMatch } from '@rallia/shared-services';
import type { MatchWithDetails, MatchParticipantWithPlayer } from '@rallia/shared-types';

const MAX_SETS = 5;
const BASE_WHITE = '#ffffff';

interface SetScore {
  team1Score: number | null;
  team2Score: number | null;
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
  progressActive: string;
  progressInactive: string;
}

/** Derive winning team (1 or 2) from set scores: team that won more sets wins the match. */
function deriveWinningTeamFromSets(sets: SetScore[]): 1 | 2 | null {
  let team1Wins = 0;
  let team2Wins = 0;
  for (const s of sets) {
    if (s.team1Score === null || s.team2Score === null) continue;
    if (s.team1Score > s.team2Score) team1Wins += 1;
    else if (s.team2Score > s.team1Score) team2Wins += 1;
  }
  if (team1Wins > team2Wins) return 1;
  if (team2Wins > team1Wins) return 2;
  return null;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function RegisterMatchScoreActionSheet({ payload }: SheetProps<'register-match-score'>) {
  const match = payload?.match as MatchWithDetails | null | undefined;
  const onSuccess = payload?.onSuccess;
  const onDismiss = payload?.onDismiss;

  const { isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { player } = usePlayer();
  const playerId = player?.id ?? '';

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
      progressActive: isDark ? primary[500] : primary[600],
      progressInactive: theme.muted,
    }),
    [theme, isDark]
  );

  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [sets, setSets] = useState<SetScore[]>([{ team1Score: null, team2Score: null }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDoubles = match?.format === 'doubles';
  const joinedParticipants = useMemo(
    () => (match?.participants ?? []).filter(p => p.status === 'joined'),
    [match?.participants]
  );
  const otherParticipants = useMemo(
    () => joinedParticipants.filter(p => p.player_id !== playerId),
    [joinedParticipants, playerId]
  );

  const validSets = useMemo(
    () => sets.filter(s => s.team1Score !== null && s.team2Score !== null),
    [sets]
  );
  const winningTeam = useMemo(() => deriveWinningTeamFromSets(validSets), [validSets]);
  const canSubmit = useMemo(() => {
    if (validSets.length === 0) return false;
    if (isDoubles && !partnerId) return false;
    return winningTeam !== null;
  }, [validSets.length, isDoubles, partnerId, winningTeam]);

  const getParticipantName = useCallback((p: MatchParticipantWithPlayer) => {
    const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
    const profile = playerObj?.profile;
    if (!profile) return 'Player';
    return (
      profile.display_name ||
      `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() ||
      'Player'
    );
  }, []);

  /** Labels for the two sides of the score (team 1 = you/your team, team 2 = opponent(s)) */
  const { team1Label, team2Label } = useMemo(() => {
    if (isDoubles) {
      if (partnerId) {
        const partner = otherParticipants.find(p => p.player_id === partnerId);
        const opponents = otherParticipants.filter(p => p.player_id !== partnerId);
        const team1 = partner
          ? t('registerMatchScore.teamYouAndPartner', {
              name: getParticipantName(partner),
            })
          : t('registerMatchScore.teamYourTeam');
        const team2 =
          opponents.length === 2
            ? t('registerMatchScore.teamOpponentsNames', {
                name1: getParticipantName(opponents[0]),
                name2: getParticipantName(opponents[1]),
              })
            : t('registerMatchScore.teamOpponents');
        return { team1Label: team1, team2Label: team2 };
      }
      return {
        team1Label: t('registerMatchScore.teamYourTeam'),
        team2Label: t('registerMatchScore.teamOpponents'),
      };
    }
    const opponentName = otherParticipants[0] ? getParticipantName(otherParticipants[0]) : null;
    return {
      team1Label: t('registerMatchScore.teamYou'),
      team2Label: opponentName ?? t('registerMatchScore.teamOpponent'),
    };
  }, [isDoubles, partnerId, otherParticipants, getParticipantName, t]);

  // Track whether submit succeeded so onClose can skip onDismiss (onSuccess already reopens the detail sheet)
  const didSubmitRef = useRef(false);

  const handleSheetClose = useCallback(() => {
    if (!didSubmitRef.current) {
      onDismiss?.();
    }
    didSubmitRef.current = false;
  }, [onDismiss]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    lightHaptic();
    SheetManager.hide('register-match-score');
  }, []);

  const handleAddSet = useCallback(() => {
    if (sets.length < MAX_SETS) {
      lightHaptic();
      setSets(prev => [...prev, { team1Score: null, team2Score: null }]);
    }
  }, [sets.length]);

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
    (setIndex: number, team: 'team1' | 'team2', value: string) => {
      const numValue = value === '' ? null : parseInt(value, 10);
      if (numValue !== null && (isNaN(numValue) || numValue < 0 || numValue > 99)) {
        return;
      }
      setSets(prev =>
        prev.map((set, i) =>
          i === setIndex
            ? {
                ...set,
                [team === 'team1' ? 'team1Score' : 'team2Score']: numValue,
              }
            : set
        )
      );
      setError(null);
      // Auto-advance: one digit in left input → focus right input
      if (team === 'team1' && value.length === 1) {
        setTimeout(() => rightInputRefs.current[setIndex]?.focus(), 0);
      }
      // Auto-move back: right input cleared → focus left input
      if (team === 'team2' && value === '') {
        setTimeout(() => leftInputRefs.current[setIndex]?.focus(), 0);
      }
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    if (!match || !playerId || validSets.length === 0) {
      setError(t('registerMatchScore.error.enterScores'));
      return;
    }
    if (winningTeam === null) {
      setError(t('registerMatchScore.error.noWinner'));
      return;
    }
    if (isDoubles && !partnerId) {
      setError(t('registerMatchScore.error.selectPartner'));
      return;
    }

    Keyboard.dismiss();
    setIsSubmitting(true);
    setError(null);
    try {
      await submitMatchResultForMatch({
        matchId: match.id,
        submittedByPlayerId: playerId,
        winningTeam,
        sets: validSets.map(s => ({
          team1_score: s.team1Score!,
          team2_score: s.team2Score!,
        })),
      });
      successHaptic();
      didSubmitRef.current = true;
      SheetManager.hide('register-match-score');
      onSuccess?.();
    } catch (err) {
      warningHaptic();
      setError(err instanceof Error ? err.message : 'Failed to submit score');
    } finally {
      setIsSubmitting(false);
    }
  }, [match, playerId, winningTeam, validSets, isDoubles, partnerId, onSuccess, t]);

  if (!match) return null;

  const expectedCount = isDoubles ? 4 : 2;
  if (joinedParticipants.length !== expectedCount) {
    return (
      <ActionSheet
        gestureEnabled
        onClose={handleSheetClose}
        containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
        indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      >
        <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={handleClose} style={styles.headerButton} hitSlop={8}>
              <Ionicons name="close-circle-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
            <Text size="lg" weight="semibold" color={colors.text}>
              {t('registerMatchScore.title')}
            </Text>
            <View style={styles.headerButton} />
          </View>
          <View style={styles.errorStateContent}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
            <Text size="base" color={colors.textMuted} style={styles.errorStateText}>
              {t('registerMatchScore.error.invalidParticipants')}
            </Text>
          </View>
        </View>
      </ActionSheet>
    );
  }

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
            {t('registerMatchScore.title')}
          </Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.headerButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content: partner (doubles) + set scores */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isDoubles && (
            <>
              <Text
                size="sm"
                weight="semibold"
                color={colors.textMuted}
                style={styles.sectionLabel}
              >
                {t('registerMatchScore.yourPartner')}
              </Text>
              <View style={styles.partnerRow}>
                {otherParticipants.map(p => {
                  const id = p.player_id;
                  const selected = partnerId === id;
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[
                        styles.partnerCard,
                        {
                          backgroundColor: selected
                            ? `${colors.buttonActive}15`
                            : colors.buttonInactive,
                          borderColor: selected ? colors.buttonActive : colors.border,
                        },
                      ]}
                      onPress={() => {
                        selectionHaptic();
                        setPartnerId(selected ? null : id);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        size="base"
                        weight={selected ? 'semibold' : 'regular'}
                        color={selected ? colors.buttonActive : colors.text}
                      >
                        {getParticipantName(p)}
                      </Text>
                      {selected && (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={colors.buttonActive}
                          style={styles.partnerCardCheck}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <Text size="sm" weight="semibold" color={colors.textMuted} style={styles.sectionLabel}>
            {t('registerMatchScore.sets')}
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
                  {t('registerMatchScore.setN', { number: idx + 1 })}
                </Text>
                {sets.length > 1 && idx > 0 && (
                  <TouchableOpacity
                    onPress={() => handleRemoveSet(idx)}
                    style={styles.removeSetButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={t('registerMatchScore.removeSet')}
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
                    {team1Label}
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
                    {team2Label}
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
                    value={set.team1Score !== null ? String(set.team1Score) : ''}
                    onChangeText={v => handleScoreChange(idx, 'team1', v)}
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
                    value={set.team2Score !== null ? String(set.team2Score) : ''}
                    onChangeText={v => handleScoreChange(idx, 'team2', v)}
                  />
                </View>
              </View>
            </View>
          ))}

          {sets.length < MAX_SETS && (
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
                {t('registerMatchScore.addSet')}
              </Text>
            </TouchableOpacity>
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
                backgroundColor:
                  canSubmit && !isSubmitting ? colors.buttonActive : colors.buttonInactive,
              },
              (!canSubmit || isSubmitting) && styles.primaryButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.buttonTextActive} />
            ) : (
              <>
                <Text
                  size="lg"
                  weight="semibold"
                  color={canSubmit ? colors.buttonTextActive : colors.textMuted}
                >
                  {t('registerMatchScore.submit')}
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
// STYLES (aligned with MatchFeedbackWizard / MatchCreationWizard)
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
  sectionLabel: {
    marginBottom: spacingPixels[2],
    marginTop: spacingPixels[4],
  },
  partnerRow: {
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  partnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  partnerCardCheck: {
    marginLeft: spacingPixels[2],
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
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[4],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[8],
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
  errorStateContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  errorStateText: {
    textAlign: 'center',
    marginTop: spacingPixels[4],
  },
});
