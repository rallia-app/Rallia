/**
 * Session Record Score Sheet
 *
 * Organizer-only score entry for a league-session pairing. Replaces the
 * free-text box that used to live inline in SessionDetail, where the organizer
 * picked a winner AND typed a score with nothing tying the two together (you
 * could save "team A won" next to a score team B won).
 *
 * Same set grid and rules as the tournament sheet (ScoreEntrySets +
 * shared-utils scoreEntry), so the winner is derived from the sets rather than
 * chosen. session_record_score already takes the serialized "6-4 6-2" string,
 * so nothing changed server-side.
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
import { lightTheme, darkTheme, spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  deriveWinningSideFromSets,
  serializeSets,
  validSetsOf,
  type SetScore,
} from '@rallia/shared-utils';
import { useRecordSessionScore } from '@rallia/shared-hooks';

import { ScoreEntrySets } from '#/components/ScoreEntrySets';
import { useTranslation, useThemeStyles } from '#/hooks';

const BASE_WHITE = '#ffffff';

export function SessionRecordScoreActionSheet({ payload }: SheetProps<'session-record-score'>) {
  const sessionMatchId = payload?.sessionMatchId ?? '';
  const sessionId = payload?.sessionId ?? '';
  const seasonId = payload?.seasonId ?? '';
  const versionWas = payload?.versionWas ?? 0;
  const teamAName = payload?.teamAName ?? '';
  const teamBName = payload?.teamBName ?? '';
  const isPickleball = payload?.isPickleball ?? false;
  const matchFormat = payload?.matchFormat;
  const isEdit = payload?.isEdit ?? false;
  const isDecider = payload?.isDecider ?? false;
  const onSuccess = payload?.onSuccess;
  const onDismiss = payload?.onDismiss;

  const { isDark } = useThemeStyles();
  const { t } = useTranslation();

  const theme = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      cardBackground: theme.card,
      text: theme.foreground,
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

  const didSubmitRef = useRef(false);

  const { mutate: recordScore, isPending } = useRecordSessionScore(sessionId, seasonId, {
    onSuccess: () => {
      successHaptic();
      didSubmitRef.current = true;
      void SheetManager.hide('session-record-score');
      onSuccess?.();
    },
    onError: e => {
      warningHaptic();
      setError(
        e.message?.includes('CORRECTION_WINDOW_CLOSED')
          ? t('sessionDetail.score.errors.correctionWindowClosed')
          : e.message || t('sessionDetail.errors.generic')
      );
    },
  });

  const canSubmit = validSets.length > 0 && winningSide !== null && !isPending;

  const handleSheetClose = useCallback(() => {
    if (!didSubmitRef.current) onDismiss?.();
    didSubmitRef.current = false;
  }, [onDismiss]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    void lightHaptic();
    void SheetManager.hide('session-record-score');
  }, []);

  const handleSubmit = useCallback(() => {
    if (validSets.length === 0) {
      setError(
        t(
          isPickleball
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
    void lightHaptic();
    setError(null);
    // Side 1 is team A, side 2 is team B: ScoreEntrySets renders them in that
    // order, so the derived side maps straight onto the pairing.
    const submit = () =>
      recordScore({
        sessionMatchId,
        winnerTeam: winningSide === 1 ? 'a' : 'b',
        score: serializeSets(validSets),
        status: 'completed',
        versionWas,
      });

    // This result leaves no playable match behind, so it closes the session and
    // freezes the sheet once the correction window lapses. Confirm first.
    if (isDecider) {
      Alert.alert(
        t('sessionDetail.score.confirmLast.title'),
        t('sessionDetail.score.confirmLast.message'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('sessionDetail.score.confirmLast.cta'), onPress: submit },
        ]
      );
      return;
    }

    submit();
  }, [validSets, winningSide, isPickleball, isDecider, recordScore, sessionMatchId, versionWas, t]);

  return (
    <ActionSheet
      gestureEnabled
      onClose={handleSheetClose}
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft} />
          <Text
            size="lg"
            weight="semibold"
            color={colors.text}
            style={styles.headerTitle}
            numberOfLines={1}
          >
            {t(isEdit ? 'sessionDetail.score.edit' : 'sessionDetail.score.title')}
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

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('sessionDetail.score.subtitle')}
          </Text>

          <ScoreEntrySets
            sets={sets}
            onSetsChange={setSets}
            player1Name={teamAName}
            player2Name={teamBName}
            isPickleball={isPickleball}
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

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: canSubmit ? colors.buttonActive : colors.buttonInactive },
              !canSubmit && styles.primaryButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.8}
            testID="session-record-score-save"
          >
            {isPending ? (
              <ActivityIndicator color={colors.buttonTextActive} />
            ) : (
              <>
                <Text
                  size="lg"
                  weight="semibold"
                  color={canSubmit ? colors.buttonTextActive : colors.textMuted}
                >
                  {t('sessionDetail.score.save')}
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

export default SessionRecordScoreActionSheet;
