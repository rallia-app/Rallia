/**
 * PlayedMatchDetail Screen
 * Shows detailed information about a completed/played match with scores
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Image, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import type { MatchFormatEnum, MatchTypeEnum } from '@rallia/shared-types';
import { useThemeStyles, useNavigateToPlayerProfile } from '../hooks';
import { SportIcon } from '../components/SportIcon';
import { getSafeAreaEdges } from '../utils';
import {
  spacingPixels,
  fontSizePixels,
  radiusPixels,
  primary,
  status,
} from '@rallia/design-system';
import type { RootStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type PlayedMatchDetailRouteProp = RouteProp<RootStackParamList, 'PlayedMatchDetail'>;

// MatchSet structure for individual set scores
interface MatchSet {
  id: string;
  set_number: number;
  team1_score: number;
  team2_score: number;
}

// GroupMatch structure from groupService
interface GroupMatch {
  id: string;
  match_id: string;
  network_id: string;
  posted_by: string;
  posted_at: string;
  match: {
    id: string;
    sport_id: string;
    match_date: string;
    start_time: string;
    player_expectation: MatchTypeEnum;
    cancelled_at: string | null;
    format: MatchFormatEnum;
    created_by: string;
    sport?: {
      id: string;
      name: string;
      icon_url: string | null;
    };
    participants: Array<{
      id: string;
      player_id: string;
      team_number: number | null;
      is_host: boolean;
      player?: {
        id: string;
        profile?: {
          first_name: string;
          last_name: string | null;
          display_name: string | null;
          profile_picture_url: string | null;
        };
      };
    }>;
    result?: {
      id: string;
      winning_team: number | null;
      team1_score: number | null;
      team2_score: number | null;
      is_verified: boolean;
      sets?: MatchSet[];
    } | null;
  };
  posted_by_player?: {
    id: string;
    profile?: {
      first_name: string;
      last_name: string | null;
      display_name: string | null;
      profile_picture_url: string | null;
    };
  };
}

export default function PlayedMatchDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<PlayedMatchDetailRouteProp>();
  const { match: groupMatch } = route.params;
  const { colors, isDark } = useThemeStyles();

  // Parse group match data - the actual match data is nested inside .match
  const data = groupMatch as GroupMatch;
  const matchData = data.match;

  // Format date and time
  const formattedDate = useMemo(() => {
    if (!matchData?.match_date) return 'Unknown date';
    const date = new Date(matchData.match_date);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
    });
  }, [matchData]);

  const formattedTime = useMemo(() => {
    if (!matchData?.start_time) return 'Unknown time';
    const [hours, minutes] = matchData.start_time.split(':');
    const date = new Date();
    date.setHours(parseInt(hours, 10), parseInt(minutes, 10));
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }, [matchData]);

  // Sport name for icon (SportIcon uses tennis/pickleball SVGs; others fallback to tennis)
  const sportNameForIcon = matchData?.sport?.name ?? 'tennis';

  // Organize participants by team
  const { team1, team2 } = useMemo(() => {
    const participants = matchData?.participants || [];
    const t1: typeof participants = [];
    const t2: typeof participants = [];

    participants.forEach(p => {
      if (p.team_number === 1) t1.push(p);
      else if (p.team_number === 2) t2.push(p);
      else {
        // If no team number, distribute evenly for display
        if (t1.length <= t2.length) t1.push(p);
        else t2.push(p);
      }
    });

    return { team1: t1, team2: t2 };
  }, [matchData]);

  // Determine winner
  const winningTeam = matchData?.result?.winning_team;
  const matchSets = matchData?.result?.sets || [];

  // Format set scores for display (e.g., "6  4  7" for three sets)
  const getSetScoresDisplay = (teamNumber: 1 | 2): string => {
    if (matchSets.length === 0) {
      // Fallback to total score if no individual sets
      const totalScore =
        teamNumber === 1 ? matchData?.result?.team1_score : matchData?.result?.team2_score;
      return totalScore?.toString() ?? '-';
    }

    return matchSets
      .sort((a, b) => a.set_number - b.set_number)
      .map(set => (teamNumber === 1 ? set.team1_score : set.team2_score))
      .join('  ');
  };

  // Get player display name
  const getPlayerName = (participant: NonNullable<typeof matchData>['participants'][0]) => {
    const profile = participant.player?.profile;
    if (!profile) return 'Unknown';
    if (profile.display_name) return profile.display_name;
    return profile.first_name + (profile.last_name ? ` ${profile.last_name.charAt(0)}.` : '');
  };

  // Get player avatar
  const getPlayerAvatar = (participant: NonNullable<typeof matchData>['participants'][0]) => {
    return participant.player?.profile?.profile_picture_url;
  };

  const handleBack = () => {
    navigation.goBack();
  };

  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  const handlePlayerPress = (playerId: string) => {
    navigateToPlayerProfile(playerId);
  };

  // Render a player row (list style like the design)
  const renderPlayerRow = (
    participants: NonNullable<typeof matchData>['participants'],
    teamNumber: 1 | 2,
    isWinner: boolean
  ) => (
    <View style={styles.playerRow}>
      {/* Trophy icon for winner */}
      <View style={styles.trophyContainer}>
        {isWinner && <Ionicons name="trophy-outline" size={20} color="#F59E0B" />}
      </View>

      {/* Avatar(s) - Show overlapping avatars for doubles, tappable to view profile */}
      <View style={styles.teamAvatarsContainer}>
        {participants.map((participant, index) => (
          <TouchableOpacity
            key={participant.id}
            style={[
              styles.playerAvatarSmall,
              index > 0 && { marginLeft: -12, zIndex: participants.length - index },
            ]}
            onPress={() => participant.player_id && handlePlayerPress(participant.player_id)}
            activeOpacity={0.7}
          >
            {getPlayerAvatar(participant) ? (
              <Image source={{ uri: getPlayerAvatar(participant)! }} style={styles.avatarSmall} />
            ) : (
              <View style={[styles.avatarPlaceholderSmall, { backgroundColor: primary[100] }]}>
                <Text
                  style={{ color: primary[500], fontWeight: '600', fontSize: fontSizePixels.sm }}
                >
                  {getPlayerName(participant).charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Player name(s) */}
      <Text
        style={[styles.playerNameRow, { color: colors.text, fontWeight: isWinner ? '600' : '400' }]}
        numberOfLines={1}
      >
        {participants.map(p => getPlayerName(p)).join(' & ')}
      </Text>

      {/* Score - show individual set scores */}
      <Text
        style={[
          styles.scoreText,
          { color: isWinner ? '#F59E0B' : colors.textMuted, fontWeight: isWinner ? '700' : '400' },
        ]}
      >
        {getSetScoresDisplay(teamNumber)}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header with sport image */}
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/tennis.jpg')}
          style={styles.headerImage}
          defaultSource={require('../../assets/images/tennis.jpg')}
        />
        <View style={styles.headerOverlay} />

        {/* Back button */}
        <SafeAreaView edges={getSafeAreaEdges(['top'])} style={styles.headerContent}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Status badge */}
          <View style={[styles.statusBadge, { backgroundColor: status.info.DEFAULT }]}>
            <Text style={styles.statusText}>Played</Text>
          </View>

          {/* Match title */}
          <Text style={styles.matchTitle}>{matchData?.sport?.name || 'Match'}</Text>
          <Text style={styles.matchSubtitle}>
            {formattedDate} • {formattedTime}
          </Text>
        </SafeAreaView>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Players Section */}
        <View
          style={[
            styles.section,
            { backgroundColor: isDark ? colors.card : '#FFFFFF', borderRadius: radiusPixels.lg },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="people-outline" size={20} color={colors.text} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Players</Text>
          </View>

          {/* Player rows */}
          <View style={styles.playersListContainer}>
            {renderPlayerRow(team1, 1, winningTeam === 1)}
            {renderPlayerRow(team2, 2, winningTeam === 2)}
          </View>
        </View>

        {/* Game Type */}
        <View style={styles.detailRow}>
          <View style={styles.detailIcon}>
            <Ionicons name="options-outline" size={20} color={colors.textMuted} />
          </View>
          <View style={styles.detailContent}>
            <Text style={[styles.detailLabel, { color: colors.text }]}>Game type</Text>
            <Text style={[styles.detailValue, { color: colors.textMuted }]}>
              {matchData?.format === 'singles' ? 'Singles' : 'Doubles'}
            </Text>
          </View>
        </View>

        {/* Sport */}
        <View style={styles.detailRow}>
          <View style={styles.detailIcon}>
            <SportIcon sportName={sportNameForIcon} size={20} color={colors.textMuted} />
          </View>
          <View style={styles.detailContent}>
            <Text style={[styles.detailLabel, { color: colors.text }]}>Sport</Text>
            <Text style={[styles.detailValue, { color: colors.textMuted }]}>
              {matchData?.sport?.name || 'Unknown'}
            </Text>
          </View>
        </View>

        {/* Match Style */}
        <View style={styles.detailRow}>
          <View style={styles.detailIcon}>
            <Ionicons
              name={
                matchData?.player_expectation === 'competitive'
                  ? 'trophy-outline'
                  : 'fitness-outline'
              }
              size={20}
              color={colors.textMuted}
            />
          </View>
          <View style={styles.detailContent}>
            <Text style={[styles.detailLabel, { color: colors.text }]}>Match style</Text>
            <Text style={[styles.detailValue, { color: colors.textMuted }]}>
              {matchData?.player_expectation === 'competitive'
                ? 'Competitive'
                : matchData?.player_expectation === 'casual'
                  ? 'Casual'
                  : 'Both'}
            </Text>
          </View>
        </View>

        {/* Date & Time */}
        <View style={styles.detailRow}>
          <View style={styles.detailIcon}>
            <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
          </View>
          <View style={styles.detailContent}>
            <Text style={[styles.detailLabel, { color: colors.text }]}>Date</Text>
            <Text style={[styles.detailValue, { color: colors.textMuted }]}>{formattedDate}</Text>
            <Text style={[styles.detailValue, { color: colors.textMuted }]}>{formattedTime}</Text>
          </View>
        </View>

        {/* Spacer for bottom */}
        <View style={{ height: spacingPixels[8] }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 200,
    position: 'relative',
  },
  headerImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 100, 150, 0.7)',
  },
  headerContent: {
    ...StyleSheet.absoluteFillObject,
    padding: spacingPixels[4],
    justifyContent: 'flex-end',
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : spacingPixels[4],
    left: spacingPixels[4],
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[2],
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: fontSizePixels.xs,
    fontWeight: '600',
  },
  matchTitle: {
    color: '#FFFFFF',
    fontSize: fontSizePixels['2xl'],
    fontWeight: '700',
    marginBottom: spacingPixels[1],
  },
  matchSubtitle: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: fontSizePixels.sm,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[4],
  },
  section: {
    marginBottom: spacingPixels[4],
    padding: spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  sectionTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: '600',
    marginLeft: spacingPixels[2],
  },
  playersListContainer: {
    gap: spacingPixels[3],
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
  },
  trophyContainer: {
    width: 28,
    alignItems: 'center',
  },
  teamAvatarsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacingPixels[3],
  },
  playerAvatarSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: primary[500],
  },
  avatarSmall: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholderSmall: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  playerNameRow: {
    flex: 1,
    fontSize: fontSizePixels.base,
  },
  scoreText: {
    fontSize: fontSizePixels.lg,
    minWidth: 40,
    textAlign: 'right',
    letterSpacing: 2,
  },
  // Legacy styles kept for compatibility
  playersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playerCard: {
    flex: 1,
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    position: 'relative',
  },
  winnerBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerAvatars: {
    flexDirection: 'row',
    marginBottom: spacingPixels[2],
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
  },
  avatarOverlap: {
    marginLeft: -16,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerName: {
    fontSize: fontSizePixels.sm,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  score: {
    fontSize: fontSizePixels.xl,
    fontWeight: '700',
  },
  vsContainer: {
    paddingHorizontal: spacingPixels[3],
  },
  vsText: {
    fontSize: fontSizePixels.sm,
    fontWeight: '500',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacingPixels[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  detailIcon: {
    width: 32,
    alignItems: 'center',
    marginRight: spacingPixels[3],
    paddingTop: 2,
  },
  detailContent: {
    flex: 1,
  },
  detailContentWithArrow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: fontSizePixels.base,
    fontWeight: '600',
    marginBottom: spacingPixels[1],
  },
  detailValue: {
    fontSize: fontSizePixels.sm,
  },
});
