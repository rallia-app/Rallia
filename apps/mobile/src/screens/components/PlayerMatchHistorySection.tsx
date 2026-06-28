/**
 * PlayerMatchHistorySection
 *
 * Profile section listing a player's past games that have a verified score, so a
 * prospective opponent can gauge their level. Each row is a result card: the
 * opponent(s), a tennis-style per-set scoreboard from the viewed player's
 * perspective, and an outcome-coloured avatar ring. Tapping opens the shared
 * match-detail bottom sheet for the full breakdown.
 *
 * Data comes from `usePlayerMatchHistory` → `get_player_match_history` RPC.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import { usePlayerMatchHistory } from '@rallia/shared-hooks';
import type { PlayerMatchHistoryItem } from '@rallia/shared-types';
import { getHumanName, getProfilePictureUrl, lightHaptic } from '@rallia/shared-utils';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  primary,
  status,
} from '@rallia/design-system';

import { SportIcon } from '#/components/SportIcon';
import { useThemeStyles, useTranslation } from '#/hooks';
import { useMatchDetailSheet, type MatchDetailData } from '#/context';

interface PlayerMatchHistorySectionProps {
  playerId: string;
  sportId?: string;
  sportName?: string;
}

type Outcome = 'win' | 'loss' | 'draw';

/**
 * Minimal MatchDetailData built from a history row. Used as a fallback when the
 * full match can't be read directly (e.g. a private game the viewer isn't part
 * of), so the detail sheet still shows the verified score.
 */
const historyItemToMatchSeed = (item: PlayerMatchHistoryItem): MatchDetailData =>
  ({
    id: item.match_id,
    sport_id: item.sport_id,
    created_by: item.created_by,
    match_date: item.match_date,
    start_time: item.start_time,
    end_time: item.start_time,
    player_expectation: item.player_expectation,
    format: item.format,
    timezone: 'UTC',
    visibility: 'private',
    location_name: item.location_name,
    host_edited_at: null,
    sport: { id: item.sport_id, name: item.sport_name, icon_url: item.sport_icon_url },
    participants: item.participants.map(p => ({ ...p, match_id: item.match_id, status: 'joined' })),
    result: {
      id: item.result_id,
      match_id: item.match_id,
      winning_team: item.winning_team,
      team1_score: item.team1_score,
      team2_score: item.team2_score,
      is_verified: item.is_verified,
      sets: item.sets,
    },
  }) as unknown as MatchDetailData;

/** One scoreboard column: the viewed player's games on top, opponent's below. */
interface ScoreCol {
  top: number;
  bottom: number;
  topWon: boolean;
  bottomWon: boolean;
}

// Parse "YYYY-MM-DD" in local time so the displayed day doesn't shift west of UTC.
const formatRowDate = (ymd: string, locale: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(ymd);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
};

const HistoryRow: React.FC<{ item: PlayerMatchHistoryItem }> = ({ item }) => {
  const { t, locale } = useTranslation();
  const { colors } = useThemeStyles();
  const { openSheet: openMatchDetail } = useMatchDetailSheet();

  const targetTeam = item.target_team_number ?? 1;
  const targetIsTeam1 = targetTeam === 1;
  const opponents = item.participants.filter(p => p.team_number !== targetTeam);

  const outcome: Outcome =
    item.winning_team == null ? 'draw' : item.winning_team === targetTeam ? 'win' : 'loss';
  const outcomeColor =
    outcome === 'win'
      ? status.success.DEFAULT
      : outcome === 'loss'
        ? status.error.DEFAULT
        : colors.textMuted;
  const outcomeLabel =
    outcome === 'win'
      ? t('playerProfile.gameHistory.win')
      : outcome === 'loss'
        ? t('playerProfile.gameHistory.loss')
        : t('playerProfile.gameHistory.draw');

  // Scoreboard columns from the viewed player's perspective.
  const columns: ScoreCol[] = (() => {
    if (item.sets.length > 0) {
      return [...item.sets]
        .sort((a, b) => a.set_number - b.set_number)
        .map(s => {
          const top = targetIsTeam1 ? s.team1_score : s.team2_score;
          const bottom = targetIsTeam1 ? s.team2_score : s.team1_score;
          return { top, bottom, topWon: top > bottom, bottomWon: bottom > top };
        });
    }
    const top = targetIsTeam1 ? item.team1_score : item.team2_score;
    const bottom = targetIsTeam1 ? item.team2_score : item.team1_score;
    if (top == null || bottom == null) return [];
    return [{ top, bottom, topWon: top > bottom, bottomWon: bottom > top }];
  })();

  const opponentName = opponents.length
    ? opponents.map(o => getHumanName(o.player?.profile, t('common.player'))).join(' & ')
    : t('common.player');

  const formatLabel = item.format ? t(`match.format.${item.format}`) : null;
  const metaParts = [formatRowDate(item.match_date, locale), formatLabel].filter(Boolean);

  const openDetail = useCallback(() => {
    void lightHaptic();
    openMatchDetail(historyItemToMatchSeed(item) as MatchDetailData, {
      source: 'profile_history',
    });
  }, [item, openMatchDetail]);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      activeOpacity={0.7}
      onPress={() => void openDetail()}
      accessibilityRole="button"
      accessibilityLabel={`${outcomeLabel}, ${t('playerProfile.gameHistory.vs')} ${opponentName}`}
    >
      {/* Avatar(s) with an outcome-coloured ring. */}
      <View style={styles.avatars}>
        {opponents.slice(0, 2).map((o, i) => {
          const uri = getProfilePictureUrl(o.player?.profile?.profile_picture_url);
          const ringColor = i === 0 ? outcomeColor : colors.card;
          return (
            <View
              key={o.id}
              style={[
                styles.avatar,
                { borderColor: ringColor },
                i > 0 && { marginLeft: -14, zIndex: 2 - i },
              ]}
            >
              {uri ? (
                <Image source={{ uri }} style={styles.avatarImg} />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: primary[100] }]}>
                  <Text style={styles.avatarInitial}>
                    {getHumanName(o.player?.profile, '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Opponent + meta. */}
      <View style={styles.middle}>
        <Text style={[styles.opponentName, { color: colors.text }]} numberOfLines={1}>
          {opponentName}
        </Text>
        <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
          <Text style={[styles.outcomeWord, { color: outcomeColor }]}>{outcomeLabel}</Text>
          {`  ·  ${metaParts.join('  ·  ')}`}
        </Text>
      </View>

      {/* Per-set scoreboard. */}
      {columns.length > 0 && (
        <View style={styles.scoreboard}>
          {columns.map((c, idx) => (
            <View key={idx} style={styles.scoreCol}>
              <Text
                style={[
                  styles.scoreNum,
                  {
                    color: c.topWon ? colors.text : colors.textMuted,
                    fontWeight: c.topWon ? '800' : '500',
                  },
                ]}
              >
                {c.top}
              </Text>
              <Text
                style={[
                  styles.scoreNum,
                  {
                    color: c.bottomWon ? colors.text : colors.textMuted,
                    fontWeight: c.bottomWon ? '800' : '500',
                  },
                ]}
              >
                {c.bottom}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={styles.chevron} />
    </TouchableOpacity>
  );
};

export const PlayerMatchHistorySection: React.FC<PlayerMatchHistorySectionProps> = ({
  playerId,
  sportId,
  sportName,
}) => {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const skeletonBg = isDark ? '#262626' : '#E1E9EE';
  const skeletonHighlight = isDark ? '#404040' : '#F2F8FC';

  const { matches, isLoading, isError, hasMore, isFetchingMore, fetchMore } = usePlayerMatchHistory(
    {
      playerId,
      sportId,
    }
  );

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name="trophy-outline" size={18} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {t('playerProfile.sections.gameHistory')}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.list}>
          {[0, 1].map(i => (
            <Skeleton
              key={i}
              width="100%"
              height={68}
              borderRadius={radiusPixels.xl}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          ))}
        </View>
      ) : isError ? (
        <View
          style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.stateText, { color: colors.textMuted }]}>
            {t('playerProfile.gameHistory.error')}
          </Text>
        </View>
      ) : matches.length === 0 ? (
        <View
          style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <SportIcon sportName={sportName ?? 'tennis'} size={22} color={colors.textMuted} />
          <Text style={[styles.stateText, { color: colors.textMuted }]}>
            {t('playerProfile.gameHistory.empty')}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {matches.map(item => (
            <HistoryRow key={item.match_id} item={item} />
          ))}
          {hasMore && (
            <TouchableOpacity
              style={[styles.showMore, { borderColor: colors.border }]}
              activeOpacity={0.7}
              onPress={fetchMore}
              disabled={isFetchingMore}
              accessibilityRole="button"
            >
              {isFetchingMore ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.showMoreText, { color: colors.primary }]}>
                  {t('playerProfile.gameHistory.showMore')}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const AVATAR = 42;

const styles = StyleSheet.create({
  // Matches PlayerProfile's `section`: the scroll container has no horizontal
  // padding, so each section insets itself by spacingPixels[4].
  section: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: '600',
  },
  list: {
    gap: spacingPixels[3],
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    gap: spacingPixels[3],
  },
  avatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: 'hidden',
    borderWidth: 2,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: primary[500],
    fontWeight: '600',
    fontSize: fontSizePixels.base,
  },
  middle: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  opponentName: {
    fontSize: fontSizePixels.sm,
    fontWeight: '600',
  },
  meta: {
    fontSize: fontSizePixels.xs,
  },
  outcomeWord: {
    fontWeight: '700',
  },
  scoreboard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  scoreCol: {
    alignItems: 'center',
    minWidth: 14,
    gap: 1,
  },
  scoreNum: {
    fontSize: fontSizePixels.sm,
    fontVariant: ['tabular-nums'],
    lineHeight: fontSizePixels.sm + 4,
  },
  chevron: {
    marginLeft: -spacingPixels[1],
  },
  stateCard: {
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  stateText: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
  },
  showMore: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    borderStyle: 'dashed',
  },
  showMoreText: {
    fontSize: fontSizePixels.sm,
    fontWeight: '600',
  },
});

export default PlayerMatchHistorySection;
