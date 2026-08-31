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

import { Button, Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, base } from '@rallia/design-system';
import type { PoolStandingRow, TournamentMatch } from '@rallia/shared-services';

type Colors = {
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  /** Tint behind the caller's own unplayed game, so the row reads as theirs. */
  highlightBg: string;
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
  membersByRegId: Map<string, string[]>;
  qualifiersPerPool: number;
  currentUserId: string | undefined;
  isOrganizer: boolean;
  /** Participant taps their own pending game → link a played match. */
  onMatchPress?: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  /** Organizer taps a game they are not playing in → record/correct the result. */
  onOrganizerOverride?: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  colors: Colors;
  t: (k: string) => string;
}> = ({
  standings,
  poolMatches,
  nameByRegId,
  membersByRegId,
  qualifiersPerPool,
  currentUserId,
  isOrganizer,
  onMatchPress,
  onOrganizerOverride,
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
              {/* One qualifier needs its own phrasing: "Les 1 premiers" is not French. */}
              {qualifiersPerPool === 1
                ? t('tournamentDetail.pools.qualifyHintOne')
                : t('tournamentDetail.pools.qualifyHint').replace(
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
              // Same gating as the knockout renderer: participants act on their
              // own pending game, the organizer records others' games and may
              // quietly correct a completed one; everyone else just reads.
              const callerInMatch =
                !!currentUserId &&
                [m.player1_registration_id, m.player2_registration_id].some(
                  regId => !!regId && (membersByRegId.get(regId) ?? []).includes(currentUserId)
                );
              const canAttach = m.status === 'pending' && callerInMatch && !!onMatchPress;
              const canOverride =
                isOrganizer &&
                !canAttach &&
                (m.status === 'pending' || m.status === 'completed') &&
                !!onOrganizerOverride;
              const tappable = canAttach || canOverride;
              // The caller's own unplayed game is the one row here they can do
              // something about. It used to look exactly like every other
              // pending row (11px of tinted text), so it got missed.
              const isMyTurn = canAttach && !settled;
              // A cancelled game is settled but carries no score, so it reads as
              // a status rather than a result.
              const noResult = m.status === 'cancelled';
              const label = !settled
                ? t('tournamentDetail.pools.toPlay')
                : m.status === 'walkover'
                  ? t('tournamentDetail.pools.walkover')
                  : noResult
                    ? t('tournamentDetail.pools.cancelled')
                    : (m.score ?? '—');
              const pendingAccent = tappable ? colors.primary : colors.textMuted;
              const identity = (
                <>
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
                    {/* Attached to a real Rallia game: its score comes from that
                        game rather than from the organizer, and nothing said so. */}
                    {!!m.match_id && (
                      <Ionicons
                        name="link"
                        size={12}
                        color={colors.textMuted}
                        accessibilityLabel={t('tournamentDetail.pools.linkedGame')}
                      />
                    )}
                    <Text
                      size="xs"
                      weight={settled && !noResult ? 'semibold' : 'regular'}
                      color={noResult ? colors.textMuted : settled ? colors.text : pendingAccent}
                    >
                      {label}
                    </Text>
                    {tappable && !isMyTurn && (
                      <Ionicons
                        name={settled ? 'create-outline' : 'chevron-forward'}
                        size={13}
                        color={settled ? colors.textMuted : colors.primary}
                      />
                    )}
                  </View>
                </>
              );

              // The caller's own game stacks: names and status keep the whole
              // width, the CTA sits under them. Side by side, a long pair of
              // doubles names and the button fought over the same row.
              if (isMyTurn) {
                return (
                  <View
                    key={m.id}
                    style={[styles.matchRowMine, { backgroundColor: colors.highlightBg }]}
                    testID={`pool-match-${m.id}`}
                  >
                    <View style={styles.matchRowIdentity}>{identity}</View>
                    <Button
                      variant="primary"
                      size="sm"
                      fullWidth
                      onPress={() =>
                        onMatchPress?.(m.id, m.player1_registration_id!, m.player2_registration_id!)
                      }
                      leftIcon={<Ionicons name="add-circle" size={16} color={base.white} />}
                      testID="pool-match-cta"
                    >
                      {t('tournamentDetail.pools.enterScore')}
                    </Button>
                  </View>
                );
              }

              return (
                <TouchableOpacity
                  key={m.id}
                  disabled={!tappable}
                  onPress={() =>
                    (canAttach ? onMatchPress : onOrganizerOverride)?.(
                      m.id,
                      m.player1_registration_id!,
                      m.player2_registration_id!
                    )
                  }
                  activeOpacity={0.7}
                  testID={`pool-match-${m.id}`}
                >
                  <View style={styles.matchRow}>{identity}</View>
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
  matchRowMine: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    gap: spacingPixels[2],
  },
  matchRowIdentity: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  matchPlayers: { flexShrink: 1 },
  matchStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[0.5],
  },
});
