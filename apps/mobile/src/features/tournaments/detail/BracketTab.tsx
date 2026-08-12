/**
 * Bracket pane: the phase deadline, the pool tables while pools are running,
 * the organizer's knockout launch, and the knockout tree once it exists.
 */

import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import type { PlayerSearchResult, Tournament, TournamentMatch } from '@rallia/shared-services';

import type { TranslationKey } from '../../../hooks';
import { PoolsSection } from '../components/PoolsSection';
import { BracketSection } from './BracketSection';
import type { ScreenColors } from './components';
import { styles } from './detailStyles';

interface BracketTabProps {
  tournament: Tournament;
  colors: ScreenColors;
  t: (key: TranslationKey) => string;
  userId: string | undefined;
  isOrganizer: boolean;
  isPoolTournament: boolean;
  currentPhaseDeadline: string | null;
  deadlineUrgent: (iso: string) => boolean;
  formatDeadline: (iso: string) => string;
  knockoutMatches: TournamentMatch[];
  poolMatches: TournamentMatch[];
  poolStandings: React.ComponentProps<typeof PoolsSection>['standings'];
  poolPhaseComplete: boolean;
  nameByRegId: Map<string, string>;
  membersByRegId: Map<string, string[]>;
  seedByRegId: Map<string, number>;
  slotPlayersByRegId: Map<string, { id: string; avatarUrl: string | null }[]>;
  generateKnockout: { isPending: boolean };
  handleGenerateKnockout: () => void;
  handleBracketMatchTap: React.ComponentProps<typeof BracketSection>['onMatchPress'];
  handleOrganizerOverride: React.ComponentProps<typeof BracketSection>['onOrganizerOverride'];
  handleBracketPlayerPress: React.ComponentProps<typeof BracketSection>['onPlayerPress'];
}

export const BracketTab: React.FC<BracketTabProps> = ({
  tournament,
  colors,
  t,
  userId,
  isOrganizer,
  isPoolTournament,
  currentPhaseDeadline,
  deadlineUrgent,
  formatDeadline,
  knockoutMatches,
  poolMatches,
  poolStandings,
  poolPhaseComplete,
  nameByRegId,
  membersByRegId,
  seedByRegId,
  slotPlayersByRegId,
  generateKnockout,
  handleGenerateKnockout,
  handleBracketMatchTap,
  handleOrganizerOverride,
  handleBracketPlayerPress,
}) => (
  <View style={styles.tabContent}>
    {currentPhaseDeadline && (
      <View style={styles.phaseDeadlineRow}>
        <View
          style={[
            styles.phaseDeadlinePill,
            {
              backgroundColor: deadlineUrgent(currentPhaseDeadline)
                ? colors.dangerBg
                : colors.statusMutedBg,
            },
          ]}
        >
          <Ionicons
            name="time-outline"
            size={13}
            color={deadlineUrgent(currentPhaseDeadline) ? colors.danger : colors.textMuted}
          />
          <Text
            size="xs"
            weight="semibold"
            color={deadlineUrgent(currentPhaseDeadline) ? colors.danger : colors.textMuted}
          >
            {t('tournamentDetail.deadlines.phaseDeadline' as TranslationKey).replace(
              '{when}',
              formatDeadline(currentPhaseDeadline)
            )}
          </Text>
        </View>
      </View>
    )}
    {isPoolTournament && (
      <>
        {knockoutMatches.length === 0 &&
          (poolPhaseComplete && isOrganizer ? (
            <TouchableOpacity
              disabled={generateKnockout.isPending}
              onPress={handleGenerateKnockout}
              activeOpacity={0.8}
              style={[styles.poolLaunchBtn, { backgroundColor: colors.primary }]}
              testID="cta-generate-knockout"
            >
              <Ionicons name="git-branch-outline" size={16} color="#ffffff" />
              <Text size="sm" weight="semibold" color="#ffffff">
                {t('tournamentDetail.pools.launchKnockout' as TranslationKey)}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.poolPhaseNote, { backgroundColor: colors.statusMutedBg }]}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Text size="xs" color={colors.textMuted} style={styles.poolPhaseNoteText}>
                {t(
                  (poolPhaseComplete
                    ? 'tournamentDetail.pools.launchKnockoutReady'
                    : 'tournamentDetail.pools.launchKnockoutWaiting') as TranslationKey
                )}
              </Text>
            </View>
          ))}
        <PoolsSection
          standings={poolStandings}
          poolMatches={poolMatches}
          nameByRegId={nameByRegId}
          membersByRegId={membersByRegId}
          qualifiersPerPool={tournament.qualifiers_per_pool ?? 2}
          currentUserId={userId}
          isOrganizer={isOrganizer}
          onMatchPress={handleBracketMatchTap}
          onOrganizerOverride={handleOrganizerOverride}
          colors={colors}
          t={t as (k: string) => string}
        />
      </>
    )}
    {isPoolTournament && knockoutMatches.length > 0 && (
      <Text
        size="xs"
        weight="semibold"
        color={colors.textMuted}
        style={[styles.sectionTitle, styles.knockoutTitle]}
      >
        {t('tournamentDetail.pools.knockoutTitle' as TranslationKey).toUpperCase()}
      </Text>
    )}
    {(!isPoolTournament || knockoutMatches.length > 0) && (
      <BracketSection
        matches={knockoutMatches}
        seedByRegId={seedByRegId}
        nameByRegId={nameByRegId}
        membersByRegId={membersByRegId}
        slotPlayersByRegId={slotPlayersByRegId}
        currentUserId={userId}
        isOrganizer={isOrganizer}
        onMatchPress={handleBracketMatchTap}
        onOrganizerOverride={handleOrganizerOverride}
        onPlayerPress={handleBracketPlayerPress}
        colors={colors}
        t={t}
        showTitle={false}
      />
    )}
  </View>
);

export default BracketTab;
