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
