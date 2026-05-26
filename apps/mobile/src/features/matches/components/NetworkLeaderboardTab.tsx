/**
 * NetworkLeaderboardTab — story-driven orchestrator.
 *
 * Lays out the four lanes (PULSE → YOU → COMPETE → DISCOVER) using a single
 * `useNetworkPulse` query for all data. Lane components live under
 * `./leaderboard/`.
 */

import React, { useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, SkeletonAvatar, Text } from '@rallia/shared-components';
import { radiusPixels, spacingPixels } from '@rallia/design-system';
import { useNetworkPulse, type NetworkPulseLeaderboardEntry } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '#/hooks';

import { PulseHero } from './leaderboard/PulseHero';
import { FormStrip } from './leaderboard/FormStrip';
import { YourStoryCard } from './leaderboard/YourStoryCard';
import { MyStatsCarousel } from './leaderboard/MyStatsCarousel';
import { CompeteList } from './leaderboard/CompeteList';
import { UnplayedPairingsCard } from './leaderboard/UnplayedPairingsCard';
import { RivalryCard } from './leaderboard/RivalryCard';
import { PowerPairCard } from './leaderboard/PowerPairCard';
import { NewFacesCard } from './leaderboard/NewFacesCard';
import { MomentsList } from './leaderboard/MomentsList';
import { MatchupExtremesCard } from './leaderboard/MatchupExtremesCard';
import { H2HMatrix } from './leaderboard/H2HMatrix';
import { showComparisonOverlay } from './leaderboard/ComparisonOverlay';

export interface NetworkLeaderboardTabProps {
  networkId: string;
  networkType: 'group' | 'community';
  /** Player ID of the signed-in user. */
  currentPlayerId?: string;
  /** Tap a row / form-strip avatar / moment / new-face → player profile. */
  onPlayerPress?: (playerId: string) => void;
  /** "Challenge X" CTA — opens match creation pre-filled. */
  onChallengePress?: (peerId: string) => void;
  /** Empty-state CTA. */
  onAddScorePress?: () => void;
}

const DAYS_BACK = 30;

export function NetworkLeaderboardTab({
  networkId,
  networkType,
  currentPlayerId,
  onPlayerPress,
  onChallengePress,
  onAddScorePress,
}: NetworkLeaderboardTabProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const newFacesAnchorRef = useRef<View | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const { data: pulse, isLoading } = useNetworkPulse(networkId, DAYS_BACK);

  // Compute next-move client-side from the data we already have.
  const enrichedSummary = useMemo(() => {
    if (!pulse?.your_summary) return null;
    return enrichWithNextMove(pulse, currentPlayerId);
  }, [pulse, currentPlayerId]);

  if (isLoading) return <LoadingSkeleton />;

  if (!pulse) {
    return <EmptyState onAddScorePress={onAddScorePress} />;
  }

  const totalActivity =
    pulse.leaderboard.length + pulse.settling_in.length + pulse.form_strip.length;
  if (totalActivity === 0) {
    return <EmptyState onAddScorePress={onAddScorePress} />;
  }

  const handleRowPress = (entry: NetworkPulseLeaderboardEntry) => {
    if (!currentPlayerId || entry.player_id === currentPlayerId) {
      onPlayerPress?.(entry.player_id);
      return;
    }
    showComparisonOverlay({
      pulse,
      callerId: currentPlayerId,
      peerId: entry.player_id,
      onChallenge: onChallengePress,
      onPlayerPress,
    });
  };

  const handleSettlingPress = () => {
    // Scroll to NewFacesCard.
    newFacesAnchorRef.current?.measureInWindow((_x, y) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
    });
  };

  const youCtaPress = () => {
    const nm = enrichedSummary?.next_move;
    if (!nm) return;
    if (nm.type === 'log_missing_score') {
      onAddScorePress?.();
    } else if (nm.type === 'first_match') {
      onAddScorePress?.();
    } else if (nm.target_player_id) {
      onChallengePress?.(nm.target_player_id);
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* LANE 1 — PULSE */}
      <PulseHero insight={pulse.headline_insight} onPlayerPress={onPlayerPress} />
      <FormStrip entries={pulse.form_strip} onPlayerPress={onPlayerPress} />

      {/* LANE 2 — YOU */}
      {enrichedSummary && (
        <View style={{ marginTop: spacingPixels[5] }}>
          <YourStoryCard summary={enrichedSummary} onCtaPress={youCtaPress} />
          <MyStatsCarousel stats={enrichedSummary.stats} daysBack={DAYS_BACK} />
        </View>
      )}

      {/* LANE 3 — COMPETE */}
      <CompeteList
        entries={pulse.leaderboard}
        settlingInCount={pulse.settling_in.length}
        currentPlayerId={currentPlayerId}
        networkType={networkType}
        onRowPress={handleRowPress}
        onSettlingPress={handleSettlingPress}
      />

      {/* LANE 4 — DISCOVER */}
      <View>
        <Text size="lg" weight="bold" style={[styles.discoverTitle, { color: colors.text }]}>
          {t('groups.leaderboard.discover.title')}
        </Text>

        <UnplayedPairingsCard
          pairings={pulse.discover.unplayed_pairings}
          onChallenge={onChallengePress}
          onPlayerPress={onPlayerPress}
        />
        {pulse.discover.rivalry_of_week && (
          <RivalryCard
            rivalry={pulse.discover.rivalry_of_week}
            onPress={() => {
              const r = pulse.discover.rivalry_of_week!;
              showComparisonOverlay({
                pulse,
                callerId: r.player_a_id,
                peerId: r.player_b_id,
                onChallenge: onChallengePress,
                onPlayerPress,
              });
            }}
          />
        )}
        {pulse.discover.power_pair && <PowerPairCard pair={pulse.discover.power_pair} />}
        {currentPlayerId && enrichedSummary && (
          <MatchupExtremesCard
            favorite={enrichedSummary.matchup_extremes.favorite}
            nemesis={enrichedSummary.matchup_extremes.nemesis}
            onOpponentPress={oppId => {
              showComparisonOverlay({
                pulse,
                callerId: currentPlayerId,
                peerId: oppId,
                onChallenge: onChallengePress,
                onPlayerPress,
              });
            }}
          />
        )}
        <NewFacesCard
          ref={newFacesAnchorRef}
          members={pulse.settling_in}
          onInvite={onChallengePress}
          onPlayerPress={onPlayerPress}
        />
        <MomentsList moments={pulse.discover.moments} onPlayerPress={onPlayerPress} />
        {networkType === 'group' && pulse.discover.h2h_matrix && (
          <H2HMatrix
            cells={pulse.discover.h2h_matrix}
            members={[...pulse.leaderboard, ...pulse.settling_in]}
            currentPlayerId={currentPlayerId}
            onCellPress={(rowId, colId) => {
              if (currentPlayerId && (rowId === currentPlayerId || colId === currentPlayerId)) {
                const peerId = rowId === currentPlayerId ? colId : rowId;
                showComparisonOverlay({
                  pulse,
                  callerId: currentPlayerId,
                  peerId,
                  onChallenge: onChallengePress,
                  onPlayerPress,
                });
              } else {
                showComparisonOverlay({
                  pulse,
                  callerId: rowId,
                  peerId: colId,
                  onChallenge: onChallengePress,
                  onPlayerPress,
                });
              }
            }}
          />
        )}
      </View>
    </ScrollView>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function enrichWithNextMove(
  pulse: NonNullable<ReturnType<typeof useNetworkPulse>['data']>,
  callerId: string | undefined
): NonNullable<typeof pulse.your_summary> | null {
  if (!pulse.your_summary) return null;
  const sum = { ...pulse.your_summary };

  if (!callerId) return sum;

  // Priority order: first-match → log-missing → challenge-unplayed → climb-one
  const me =
    pulse.leaderboard.find(e => e.player_id === callerId) ??
    pulse.settling_in.find(e => e.player_id === callerId);

  // First match — caller has zero matches in window.
  if (!me || ('games_played' in me && me.games_played === 0)) {
    sum.next_move = {
      type: 'first_match',
      copy_key: 'groups.leaderboard.yourStory.nextFirst',
    };
    return sum;
  }

  // Challenge unplayed — first available unplayed pairing.
  const unplayed = pulse.discover.unplayed_pairings[0];
  if (unplayed) {
    sum.next_move = {
      type: 'challenge_unplayed',
      copy_key: 'groups.leaderboard.yourStory.nextChallenge',
      copy_params: { name: unplayed.first_name },
      target_player_id: unplayed.peer_player_id,
    };
    return sum;
  }

  // Climb one — overtake the player one rank above.
  if (sum.rank && sum.rank > 1) {
    const above = pulse.leaderboard[sum.rank - 2];
    if (above) {
      const winsToOvertake = Math.max(1, above.wins - sum.wins + 1);
      sum.next_move = {
        type: 'climb_one',
        copy_key:
          winsToOvertake === 1
            ? 'groups.leaderboard.yourStory.nextClimbOne'
            : 'groups.leaderboard.yourStory.nextClimb',
        copy_params: { count: winsToOvertake, name: above.first_name },
        target_player_id: above.player_id,
      };
    }
  }

  return sum;
}

// ============================================================================
// States
// ============================================================================

interface EmptyStateProps {
  onAddScorePress?: () => void;
}

function EmptyState({ onAddScorePress }: EmptyStateProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  return (
    <View style={styles.empty}>
      <Ionicons name="trophy-outline" size={56} color={colors.textMuted} />
      <Text
        size="base"
        style={{ color: colors.textSecondary, marginTop: spacingPixels[3], textAlign: 'center' }}
      >
        {t('groups.detail.playGamesToAppear')}
      </Text>
      {onAddScorePress && (
        <View style={{ marginTop: spacingPixels[5], minWidth: 220 }}>
          <Button variant="primary" onPress={onAddScorePress} fullWidth isDark={isDark}>
            {t('groups.leaderboard.addPlayedGame')}
          </Button>
        </View>
      )}
    </View>
  );
}

function LoadingSkeleton() {
  const { colors } = useThemeStyles();
  return (
    <View style={styles.skeletonRoot}>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <View
          key={i}
          style={[
            styles.skeletonRow,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <SkeletonAvatar size={32} />
          <View style={{ marginLeft: spacingPixels[3], flex: 1 }}>
            <View
              style={{
                height: 12,
                width: '60%',
                borderRadius: radiusPixels.sm,
                backgroundColor: colors.border,
              }}
            />
            <View
              style={{
                height: 10,
                width: '35%',
                borderRadius: radiusPixels.sm,
                backgroundColor: colors.border,
                marginTop: 6,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[10],
  },
  discoverTitle: {
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[3],
  },
  empty: {
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[12],
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonRoot: {
    paddingHorizontal: spacingPixels[4],
    marginTop: spacingPixels[4],
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacingPixels[2],
  },
});

export default NetworkLeaderboardTab;
