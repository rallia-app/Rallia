/**
 * ScoreEntrySets
 *
 * The per-set score grid shared by every structured score sheet: one card per
 * set with both sides' boxes, add/remove, sport-aware labels, and the
 * out-of-range warning. Controlled — the parent owns the sets array and decides
 * what to do on submit, so each caller keeps its own RPC and error semantics.
 *
 * Rules (how many sets, what clinches, how it serializes) live in
 * @rallia/shared-utils scoreEntry, not here.
 */

import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, status } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import {
  canAddSet as canAddSetRule,
  isScoreOutOfRange,
  setRulesFor,
  type SetScore,
} from '@rallia/shared-utils';
import type { Enums } from '@rallia/shared-types';

import { useTranslation } from '#/hooks';

export interface ScoreEntryColors {
  cardBackground: string;
  text: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
}

interface ScoreEntrySetsProps {
  sets: SetScore[];
  onSetsChange: (next: SetScore[]) => void;
  player1Name: string;
  player2Name: string;
  isPickleball: boolean;
  matchFormat?: Enums<'match_format'> | null;
  colors: ScoreEntryColors;
  /** Cleared by the parent when it sets its own error. */
  onDirty?: () => void;
}

export function ScoreEntrySets({
  sets,
  onSetsChange,
  player1Name,
  player2Name,
  isPickleball,
  matchFormat,
  colors,
  onDirty,
}: ScoreEntrySetsProps) {
  const { t } = useTranslation();

  const leftInputRefs = useRef<(TextInput | null)[]>([]);
  const rightInputRefs = useRef<(TextInput | null)[]>([]);

  const rules = setRulesFor(matchFormat);
  const canAdd = canAddSetRule(sets, rules);

  // Advisory only: flags a value that looks mistyped for the sport.
  const hasOutOfRange = sets.some(
    s =>
      isScoreOutOfRange(s.player1Score, isPickleball) ||
      isScoreOutOfRange(s.player2Score, isPickleball)
  );

  const handleAddSet = useCallback(() => {
    if (!canAdd) return;
    void lightHaptic();
    onSetsChange([...sets, { player1Score: null, player2Score: null }]);
  }, [canAdd, sets, onSetsChange]);

  const handleRemoveSet = useCallback(
    (setIndex: number) => {
      if (sets.length <= 1 || setIndex < 0 || setIndex >= sets.length) return;
      void lightHaptic();
      onSetsChange(sets.filter((_, i) => i !== setIndex));
      onDirty?.();
    },
    [sets, onSetsChange, onDirty]
  );

  const handleScoreChange = useCallback(
    (setIndex: number, side: 'player1' | 'player2', value: string) => {
      const numValue = value === '' ? null : parseInt(value, 10);
      if (numValue !== null && (isNaN(numValue) || numValue < 0 || numValue > 99)) return;

      onSetsChange(
        sets.map((set, i) =>
          i === setIndex
            ? { ...set, [side === 'player1' ? 'player1Score' : 'player2Score']: numValue }
            : set
        )
      );
      onDirty?.();

      // One digit on the left jumps to the right box; clearing the right box
      // jumps back.
      if (side === 'player1' && value.length === 1) {
        setTimeout(() => rightInputRefs.current[setIndex]?.focus(), 0);
      }
      if (side === 'player2' && value === '') {
        setTimeout(() => leftInputRefs.current[setIndex]?.focus(), 0);
      }
    },
    [sets, onSetsChange, onDirty]
  );

  return (
    <>
      <Text size="sm" weight="semibold" color={colors.textMuted} style={styles.sectionLabel}>
        {t(isPickleball ? 'registerMatchScore.games' : 'registerMatchScore.sets')}
      </Text>
      <Text size="xs" color={colors.textMuted} style={styles.scoreHint}>
        {t(
          isPickleball
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
            <Text size="sm" weight="medium" color={colors.textMuted} style={styles.setCardLabel}>
              {t(isPickleball ? 'registerMatchScore.gameN' : 'registerMatchScore.setN', {
                number: idx + 1,
              })}
            </Text>
            {sets.length > 1 && idx > 0 && (
              <TouchableOpacity
                onPress={() => handleRemoveSet(idx)}
                style={styles.removeSetButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={t(
                  isPickleball ? 'registerMatchScore.removeGame' : 'registerMatchScore.removeSet'
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
            <Text size="base" weight="medium" color={colors.textMuted} style={styles.setCardDash}>
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

      {canAdd && (
        <TouchableOpacity
          style={[styles.addSetButton, { borderColor: colors.border }]}
          onPress={handleAddSet}
          activeOpacity={0.7}
          testID="score-add-set"
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.buttonActive} />
          <Text size="base" weight="medium" color={colors.buttonActive} style={styles.addSetLabel}>
            {t(isPickleball ? 'registerMatchScore.addGame' : 'registerMatchScore.addSet')}
          </Text>
        </TouchableOpacity>
      )}

      {hasOutOfRange && (
        <View style={styles.warningRow}>
          <Ionicons name="warning-outline" size={18} color={status.warning.DEFAULT} />
          <Text size="sm" color={status.warning.DEFAULT}>
            {t(
              isPickleball
                ? 'registerMatchScore.error.pickleballScoreRange'
                : 'registerMatchScore.error.tennisScoreRange'
            )}
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    marginBottom: spacingPixels[2],
    marginTop: spacingPixels[4],
  },
  scoreHint: {
    marginBottom: spacingPixels[3],
    marginTop: -spacingPixels[1],
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
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[3],
  },
});

export default ScoreEntrySets;
