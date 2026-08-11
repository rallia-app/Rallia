/**
 * PoolsSection — the pool phase of a pool_knockout tournament.
 *
 * One card per pool: derived standings (rank, W-L, sets, qualifier band,
 * withdrawn dimming) above the pool's games with their status/score. The
 * knockout launch CTA is the parent's business; this component only reports
 * whether every pool game is settled via poolsComplete.
 */
import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { PoolStandingRow, TournamentMatch } from '@rallia/shared-services';

type Colors = {
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  statusPositiveBg: string;
  statusPositiveText: string;
};

const POOL_LETTERS = 'ABCDEFGHIJ';

const TERMINAL = new Set(['completed', 'retired', 'walkover', 'cancelled']);

export function poolsComplete(poolMatches: TournamentMatch[]): boolean {
  return poolMatches.length > 0 && poolMatches.every(m => TERMINAL.has(m.status));
}

export const PoolsSection: React.FC<{
  standings: PoolStandingRow[];
  poolMatches: TournamentMatch[];
  nameByRegId: Map<string, string>;
  qualifiersPerPool: number;
  currentUserId: string | undefined;
  /** Tap a playable pool game (both mine and others'; parent gates actions). */
  onMatchPress?: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  colors: Colors;
  t: (k: string) => string;
}> = ({
  standings,
  poolMatches,
  nameByRegId,
  qualifiersPerPool,
  currentUserId,
  onMatchPress,
  colors,
  t,
}) => {
  const pools = useMemo(() => {
    const byPool = new Map<number, { rows: PoolStandingRow[]; matches: TournamentMatch[] }>();
    for (const row of standings) {
      const entry = byPool.get(row.pool_number) ?? { rows: [], matches: [] };
      entry.rows.push(row);
      byPool.set(row.pool_number, entry);
    }
    for (const m of poolMatches) {
      if (m.pool_number == null) continue;
      const entry = byPool.get(m.pool_number) ?? { rows: [], matches: [] };
      entry.matches.push(m);
      byPool.set(m.pool_number, entry);
    }
    return [...byPool.entries()]
      .sort(([a], [b]) => a - b)
      .map(([pool, entry]) => ({
        pool,
        rows: [...entry.rows].sort((a, b) => a.pool_rank - b.pool_rank),
        matches: [...entry.matches].sort(
          (a, b) => a.round_number - b.round_number || a.match_position - b.match_position
        ),
      }));
  }, [standings, poolMatches]);

  if (pools.length === 0) return null;

  return (
    <View>
      {pools.map(({ pool, rows, matches }) => (
        <View
          key={pool}
          style={[styles.poolCard, { borderColor: colors.border }]}
          testID={`pool-card-${pool}`}
        >
          <View style={[styles.poolHeader, { borderBottomColor: colors.border }]}>
            <Text size="sm" weight="semibold" color={colors.text}>
              {t('tournamentDetail.pools.poolTitle').replace(
                '{letter}',
                POOL_LETTERS[pool - 1] ?? String(pool)
              )}
            </Text>
            <Text size="xs" color={colors.textMuted}>
              {t('tournamentDetail.pools.qualifyHint').replace(
                '{count}',
                String(qualifiersPerPool)
              )}
            </Text>
          </View>

          <View style={styles.standingRow}>
            <View style={styles.rankCell} />
            <View style={styles.nameCell} />
            <Text size="xs" color={colors.textMuted} style={styles.statCell}>
              {t('tournamentDetail.pools.headerRecord')}
            </Text>
            <Text size="xs" color={colors.textMuted} style={styles.statCell}>
              {t('tournamentDetail.pools.headerSets')}
            </Text>
          </View>

          {rows.map(row => {
            const isMe =
              !!currentUserId &&
              (row.user_id === currentUserId || row.partner_user_id === currentUserId);
            const qualifies = row.eligible && row.pool_rank <= qualifiersPerPool;
            return (
              <View
                key={row.registration_id}
                style={[
                  styles.standingRow,
                  qualifies && { backgroundColor: colors.statusPositiveBg },
                ]}
              >
                <Text
                  size="xs"
                  weight="semibold"
                  color={qualifies ? colors.statusPositiveText : colors.textMuted}
                  style={styles.rankCell}
                >
                  {row.pool_rank}
                </Text>
                <Text
                  size="sm"
                  weight={isMe ? 'semibold' : 'regular'}
                  color={row.withdrawn ? colors.textMuted : colors.text}
                  style={row.withdrawn ? [styles.nameCell, styles.withdrawnName] : styles.nameCell}
                  numberOfLines={1}
                >
                  {nameByRegId.get(row.registration_id) ?? '—'}
                </Text>
                <Text size="xs" color={colors.textMuted} style={styles.statCell}>
                  {row.wins}-{row.settled - row.wins}
                </Text>
                <Text size="xs" color={colors.textMuted} style={styles.statCell}>
                  {row.sets_won}-{row.sets_lost}
                </Text>
              </View>
            );
          })}

          <View style={[styles.matchesBlock, { borderTopColor: colors.border }]}>
            {matches.map(m => {
              const p1 = m.player1_registration_id
                ? (nameByRegId.get(m.player1_registration_id) ?? '—')
                : '—';
              const p2 = m.player2_registration_id
                ? (nameByRegId.get(m.player2_registration_id) ?? '—')
                : '—';
              const settled = TERMINAL.has(m.status);
              const tappable = !settled && !!onMatchPress;
              const label = settled
                ? m.status === 'walkover'
                  ? t('tournamentDetail.pools.walkover')
                  : (m.score ?? '')
                : t('tournamentDetail.pools.toPlay');
              return (
                <TouchableOpacity
                  key={m.id}
                  disabled={!tappable}
                  onPress={() =>
                    onMatchPress?.(m.id, m.player1_registration_id!, m.player2_registration_id!)
                  }
                  activeOpacity={0.7}
                  style={styles.matchRow}
                  testID={`pool-match-${m.id}`}
                >
                  <Text size="xs" color={colors.text} numberOfLines={1} style={styles.matchPlayers}>
                    {p1}
                    <Text size="xs" color={colors.textMuted}>
                      {'  '}
                      {t('tournamentDetail.pools.vs')}
                      {'  '}
                    </Text>
                    {p2}
                  </Text>
                  <View style={styles.matchStatus}>
                    <Text
                      size="xs"
                      weight={settled ? 'semibold' : 'regular'}
                      color={settled ? colors.text : colors.primary}
                    >
                      {label}
                    </Text>
                    {tappable && (
                      <Ionicons name="chevron-forward" size={13} color={colors.primary} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  poolCard: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
    overflow: 'hidden',
  },
  poolHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderBottomWidth: 1,
  },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[1.5],
    gap: spacingPixels[2],
  },
  rankCell: { width: spacingPixels[6] },
  nameCell: { flex: 1 },
  withdrawnName: { textDecorationLine: 'line-through' },
  statCell: { width: spacingPixels[10], textAlign: 'right' },
  matchesBlock: {
    borderTopWidth: 1,
    paddingVertical: spacingPixels[1.5],
  },
  matchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[1.5],
    gap: spacingPixels[2],
  },
  matchPlayers: { flexShrink: 1 },
  matchStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[0.5],
  },
});
