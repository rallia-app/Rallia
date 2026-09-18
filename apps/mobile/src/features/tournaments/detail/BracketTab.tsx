/**
 * Bracket pane: the phase deadline, then for pool tournaments a Pools /
 * Knockout segment (pool tables on one side, the organizer's knockout launch
 * or the knockout tree on the other); plain knockouts show the tree directly.
 */

import React, { useMemo, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import type { PlayerSearchResult, Tournament, TournamentMatch } from '@rallia/shared-services';

import type { TranslationKey } from '../../../hooks';
import UnderlineTabBar, { type UnderlineTabItem } from '../../../components/UnderlineTabBar';
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

type BracketSegment = 'pools' | 'knockout';

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
}) => {
  const hasKnockout = knockoutMatches.length > 0;
  // Until the user picks a side, land on whichever phase is live.
  const [pickedSegment, setPickedSegment] = useState<BracketSegment | null>(null);
  const segment: BracketSegment = pickedSegment ?? (hasKnockout ? 'knockout' : 'pools');
  const segmentTabs = useMemo<UnderlineTabItem<BracketSegment>[]>(
    () => [
      { key: 'pools', label: t('tournamentDetail.pools.poolsTitle') },
      { key: 'knockout', label: t('tournamentDetail.pools.knockoutTitle') },
    ],
    [t]
  );
  const showPools = isPoolTournament && segment === 'pools';
  const showKnockoutPane = !isPoolTournament || segment === 'knockout';

  return (
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
              {t('tournamentDetail.deadlines.phaseDeadline').replace(
                '{when}',
                formatDeadline(currentPhaseDeadline)
              )}
            </Text>
          </View>
        </View>
      )}
      {isPoolTournament && (
        <UnderlineTabBar
          tabs={segmentTabs}
          activeKey={segment}
          onChange={setPickedSegment}
          style={styles.segmentBar}
        />
      )}
      {showPools && (
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
      )}
      {showKnockoutPane &&
        isPoolTournament &&
        !hasKnockout &&
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
              {t('tournamentDetail.pools.launchKnockout')}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.poolPhaseNote, { backgroundColor: colors.statusMutedBg }]}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
            <Text size="xs" color={colors.textMuted} style={styles.poolPhaseNoteText}>
              {t(
                poolPhaseComplete
                  ? 'tournamentDetail.pools.launchKnockoutReady'
                  : 'tournamentDetail.pools.launchKnockoutWaiting'
              )}
            </Text>
          </View>
        ))}
      {showKnockoutPane && (!isPoolTournament || hasKnockout) && (
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
};

export default BracketTab;
