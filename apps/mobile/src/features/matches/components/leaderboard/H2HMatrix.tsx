/**
 * H2HMatrix
 *
 * N×N grid showing W-L between every pair of group members. Groups only
 * (hidden in communities). Horizontally scrollable when the row gets wide.
 * Tapping any cell fires onCellPress(rowId, colId).
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@rallia/shared-components';
import { neutral, primary, radiusPixels, spacingPixels, status } from '@rallia/design-system';
import type {
  NetworkPulseH2HCell,
  NetworkPulseLeaderboardEntry,
  NetworkPulseSettlingInEntry,
} from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '#/hooks';

interface H2HMatrixProps {
  cells: NetworkPulseH2HCell[];
  members: Array<NetworkPulseLeaderboardEntry | NetworkPulseSettlingInEntry>;
  currentPlayerId?: string;
  onCellPress?: (rowPlayerId: string, colPlayerId: string) => void;
}

const CELL_W = 44;
const CELL_H = 36;
const NAME_W = 64;

export function H2HMatrix({ cells, members, currentPlayerId, onCellPress }: H2HMatrixProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const ids = useMemo(() => members.map(m => m.player_id), [members]);
  const nameById = useMemo(
    () => Object.fromEntries(members.map(m => [m.player_id, m.first_name])),
    [members]
  );

  // Build a quick lookup: "rowId|colId" -> {wins, losses}
  const lookup = useMemo(() => {
    const m = new Map<string, { wins: number; losses: number }>();
    for (const c of cells) {
      m.set(`${c.row_player_id}|${c.col_player_id}`, { wins: c.wins, losses: c.losses });
      // Reciprocal: from B's perspective.
      m.set(`${c.col_player_id}|${c.row_player_id}`, { wins: c.losses, losses: c.wins });
    }
    return m;
  }, [cells]);

  if (members.length < 2 || cells.length === 0) return null;

  const youAccent = isDark ? `${primary[700]}33` : primary[50];

  return (
    <View style={styles.section}>
      <Text size="sm" weight="bold" style={[styles.title, { color: colors.text }]}>
        {t('groups.leaderboard.discover.h2hMatrixTitle')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View
          style={[
            styles.matrix,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          {/* Header row: blank corner + col names */}
          <View style={styles.headRow}>
            <View style={[styles.nameCell, { width: NAME_W, height: CELL_H }]} />
            {ids.map(id => (
              <View
                key={`h-${id}`}
                style={[
                  styles.headCell,
                  { width: CELL_W, height: CELL_H },
                  id === currentPlayerId && { backgroundColor: youAccent },
                ]}
              >
                <Text
                  size="xs"
                  weight="semibold"
                  style={{ color: colors.textMuted }}
                  numberOfLines={1}
                >
                  {(nameById[id] ?? '').slice(0, 3)}
                </Text>
              </View>
            ))}
          </View>

          {/* Body rows */}
          {ids.map(rowId => (
            <View key={`r-${rowId}`} style={styles.bodyRow}>
              <View
                style={[
                  styles.nameCell,
                  { width: NAME_W, height: CELL_H },
                  rowId === currentPlayerId && { backgroundColor: youAccent },
                ]}
              >
                <Text size="xs" weight="semibold" style={{ color: colors.text }} numberOfLines={1}>
                  {nameById[rowId] ?? ''}
                </Text>
              </View>
              {ids.map(colId => {
                const isDiagonal = rowId === colId;
                const data = lookup.get(`${rowId}|${colId}`);
                const isYouRow = rowId === currentPlayerId;
                const isYouCol = colId === currentPlayerId;
                return (
                  <TouchableOpacity
                    key={`c-${rowId}-${colId}`}
                    disabled={isDiagonal || !data}
                    activeOpacity={0.7}
                    onPress={() => onCellPress?.(rowId, colId)}
                    style={[
                      styles.cell,
                      {
                        width: CELL_W,
                        height: CELL_H,
                        borderColor: colors.border,
                      },
                      (isYouRow || isYouCol) && { backgroundColor: youAccent },
                    ]}
                  >
                    {isDiagonal ? (
                      <Text size="xs" style={{ color: isDark ? neutral[700] : neutral[300] }}>
                        {t('groups.leaderboard.discover.h2hCellNever')}
                      </Text>
                    ) : data ? (
                      <Text
                        size="xs"
                        weight="semibold"
                        style={{
                          color:
                            data.wins > data.losses
                              ? status.success.DEFAULT
                              : data.wins < data.losses
                                ? status.error.DEFAULT
                                : colors.text,
                        }}
                      >
                        {data.wins}–{data.losses}
                      </Text>
                    ) : (
                      <Text size="xs" style={{ color: colors.textMuted }}>
                        {t('groups.leaderboard.discover.h2hCellNever')}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[4],
  },
  title: {
    marginBottom: spacingPixels[2],
  },
  matrix: {
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  headRow: {
    flexDirection: 'row',
  },
  bodyRow: {
    flexDirection: 'row',
  },
  nameCell: {
    paddingHorizontal: spacingPixels[2],
    justifyContent: 'center',
  },
  headCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'transparent',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});

export default H2HMatrix;
