/**
 * Overview pane: what the league is and what it wants from you — stats, the
 * lifecycle stepper, the current standings, the organizer dashboard and the
 * practical details.
 */

import React from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { getHumanName, getProfilePictureUrl, lightHaptic } from '@rallia/shared-utils';
import type {
  League,
  LeagueMemberWithProfile,
  Season,
  SeasonRankingWithProfile,
} from '@rallia/shared-services';

import type { TranslationKey } from '../../../hooks';
import {
  DashboardCtaCard,
  JOIN_MODE_KEY,
  LifecycleStepper,
  OverviewActionRow,
  OverviewInfoRow,
  Section,
  StatSegment,
  VISIBILITY_KEY,
  type MembersSegment,
  type PendingMemberRow,
  type ScreenColors,
} from './components';
import { styles } from './detailStyles';

interface OverviewTabProps {
  league: League;
  colors: ScreenColors;
  t: (key: TranslationKey, options?: Record<string, string | number>) => string;
  isOrganizer: boolean;
  stepIndex: number;
  activeMembers: LeagueMemberWithProfile[];
  seasons: Season[];
  currentSeasonLabel: string;
  ratingRangeLabel: string | null;
  scoringLabel: string | undefined;
  pointsLabel: string | undefined;
  organizerName: string | null;
  organizerRows: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    destructive?: boolean;
    disabled?: boolean;
    badge?: { label: string; tone: 'positive' | 'warning' | 'muted' };
    testID: string;
  }>;
  pendingMemberRows: PendingMemberRow[];
  /** Highlights the viewer's own row in the standings. */
  currentUserId: string | null;
  rankingSeason: Season | undefined;
  rankings: SeasonRankingWithProfile[];
  standingsSeasons: Season[];
  setPickedStandingsSeasonId: (id: string) => void;
  goToTab: (idx: number) => void;
  membersTabIdx: number;
  setMembersSegment: (segment: MembersSegment) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  league,
  colors,
  t,
  isOrganizer,
  stepIndex,
  activeMembers,
  seasons,
  currentSeasonLabel,
  ratingRangeLabel,
  scoringLabel,
  pointsLabel,
  organizerName,
  organizerRows,
  pendingMemberRows,
  currentUserId,
  rankingSeason,
  rankings,
  standingsSeasons,
  setPickedStandingsSeasonId,
  goToTab,
  membersTabIdx,
  setMembersSegment,
}) => (
  <View style={styles.tabContent}>
    {/* Paused/closed are otherwise invisible to members — the controls
            that change are all organizer-only. */}
    {league.status !== 'active' && (
      <View
        style={[
          styles.section,
          styles.lifecycleBanner,
          { backgroundColor: colors.statusMutedBg, borderColor: colors.border },
        ]}
        testID="league-lifecycle-banner"
      >
        <Ionicons
          name={league.status === 'paused' ? 'pause-circle-outline' : 'lock-closed-outline'}
          size={18}
          color={colors.statusMutedText}
        />
        <Text size="sm" weight="semibold" color={colors.statusMutedText} style={styles.flex1}>
          {league.status === 'paused'
            ? t('leagueDetail.lifecycle.pausedBanner')
            : t('leagueDetail.lifecycle.closedBanner')}
        </Text>
      </View>
    )}
    {/* Stats first: the numbers worth a glance, one segmented card */}
    <View
      style={[
        styles.section,
        styles.statsCard,
        { backgroundColor: colors.cardBackground, borderColor: colors.border },
      ]}
    >
      <StatSegment
        value={String(activeMembers.length)}
        label={t('leagueDetail.dashboard.stats.members')}
        colors={colors}
      />
      <StatSegment
        value={String(seasons.length)}
        label={t('leagueDetail.dashboard.stats.seasons')}
        colors={colors}
        showDivider
      />
      <StatSegment
        value={currentSeasonLabel}
        label={t('leagueDetail.dashboard.stats.currentSeason')}
        colors={colors}
        showDivider
      />
    </View>

    {/* Lifecycle pipeline */}
    <View
      style={[
        styles.section,
        styles.stepperCard,
        { backgroundColor: colors.cardBackground, borderColor: colors.border },
      ]}
    >
      <LifecycleStepper stepIndex={stepIndex} colors={colors} t={t} />
    </View>

    {/* At most one accent card: approvals waiting. Everything
            state-advancing lives in the docked bar instead. */}
    {isOrganizer && pendingMemberRows.length > 0 && (
      <DashboardCtaCard
        icon="hourglass-outline"
        title={t('leagueDetail.dashboard.pendingRequestsCta.title')}
        description={t('leagueDetail.dashboard.pendingRequestsCta.description').replace(
          '{count}',
          String(pendingMemberRows.length)
        )}
        buttonLabel={t('leagueDetail.dashboard.pendingRequestsCta.review')}
        buttonIcon="people-outline"
        onPress={() => {
          if (membersTabIdx < 0) return;
          setMembersSegment('requests');
          goToTab(membersTabIdx);
        }}
        accent="secondary"
        colors={colors}
        testID="cta-pending-members"
      />
    )}

    {rankingSeason && rankings.length > 0 && (
      <Section
        title={t('leagueDetail.standings.title').replace('{name}', rankingSeason.name)}
        colors={colors}
      >
        {/* Past seasons stay reachable once there is more than one. */}
        {standingsSeasons.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.standingsSeasonBar}
          >
            {standingsSeasons.map(s => {
              const selected = s.id === rankingSeason.id;
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => {
                    lightHaptic();
                    setPickedStandingsSeasonId(s.id);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  testID={`standings-season-${s.id}`}
                  style={[
                    styles.standingsSeasonChip,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.statusActiveBg : 'transparent',
                    },
                  ]}
                >
                  <Text
                    size="xs"
                    weight="semibold"
                    color={selected ? colors.primary : colors.textMuted}
                  >
                    {s.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        <View
          style={[styles.standingRow, styles.standingHeader, { borderBottomColor: colors.border }]}
        >
          <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.standingRank}>
            #
          </Text>
          <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.standingName}>
            {t('leagueDetail.standings.player')}
          </Text>
          <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.standingWl}>
            {t('leagueDetail.standings.wl')}
          </Text>
          <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.standingPts}>
            {t('leagueDetail.standings.pts')}
          </Text>
        </View>
        {rankings.slice(0, 12).map((r, i) => (
          // My own line reads in the accent colour: "am I bold enough?" was
          // real tester feedback, so the row does not rely on weight alone.
          <View
            key={r.id}
            style={[
              styles.standingRow,
              i < Math.min(rankings.length, 12) - 1 && {
                borderBottomColor: colors.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
              r.user_id === currentUserId && { backgroundColor: `${colors.primary}14` },
            ]}
          >
            <Text
              size="sm"
              weight="semibold"
              color={r.user_id === currentUserId ? colors.primary : colors.text}
              style={styles.standingRank}
            >
              {r.rank ?? i + 1}
            </Text>
            <Text
              size="sm"
              weight={r.user_id === currentUserId ? 'semibold' : 'regular'}
              color={r.user_id === currentUserId ? colors.primary : colors.text}
              numberOfLines={1}
              style={styles.standingName}
            >
              {r.profile
                ? getHumanName(r.profile, t('leagueDetail.unknownMember'))
                : t('leagueDetail.unknownMember')}
            </Text>
            <Text size="sm" color={colors.textMuted} style={styles.standingWl}>
              {r.wins}-{r.losses}
            </Text>
            <Text size="sm" weight="bold" color={colors.text} style={styles.standingPts}>
              {r.points}
            </Text>
          </View>
        ))}
      </Section>
    )}

    {/* League info: the friendly at-a-glance card (Details keeps the
            full spec sheet). Rows only render when they have something. */}
    <Section title={t('leagueDetail.overview.infoTitle')} colors={colors}>
      <OverviewInfoRow
        icon="eye-outline"
        text={`${t(VISIBILITY_KEY[league.visibility] as TranslationKey)} · ${t(JOIN_MODE_KEY[league.join_mode] as TranslationKey)}`}
        colors={colors}
      />
      {league.venue_name ? (
        <OverviewInfoRow
          icon="location-outline"
          text={league.venue_name}
          colors={colors}
          showDivider
        />
      ) : null}
      {ratingRangeLabel ? (
        <OverviewInfoRow
          icon="analytics-outline"
          text={`${t('leagueDetail.labels.ratingRange')} · ${ratingRangeLabel}`}
          colors={colors}
          showDivider
        />
      ) : null}
      {organizerName ? (
        <OverviewInfoRow
          icon="person-outline"
          text={t('leagueDetail.dashboard.organizedBy').replace('{name}', organizerName)}
          colors={colors}
          showDivider
        />
      ) : null}
    </Section>

    {/* How it works: the blurb plus the rules the standings run on, so a
            player does not have to ask the organizer how points are counted. */}
    {league.description?.trim() || scoringLabel || pointsLabel ? (
      <Section title={t('leagueDetail.overview.rulesTitle')} colors={colors}>
        {league.description?.trim() ? (
          <View style={styles.overviewDescription}>
            <Text size="sm" color={colors.textMuted}>
              {league.description}
            </Text>
          </View>
        ) : null}
        {scoringLabel ? (
          <OverviewInfoRow
            icon="options-outline"
            text={t(scoringLabel as TranslationKey)}
            subText={t('leagueDetail.overview.rulesScoring')}
            colors={colors}
            showDivider={!!league.description?.trim()}
          />
        ) : null}
        {pointsLabel ? (
          <OverviewInfoRow
            icon="trophy-outline"
            text={pointsLabel}
            subText={t('leagueDetail.overview.rulesPointsHint')}
            colors={colors}
            showDivider={!!league.description?.trim() || !!scoringLabel}
          />
        ) : null}
      </Section>
    ) : null}

    {/* Who's in: social proof, tappable through to the Members tab */}
    {activeMembers.length > 0 && (
      <Section title={t('leagueDetail.tabs.members')} colors={colors}>
        <TouchableOpacity
          onPress={() => {
            if (membersTabIdx < 0) return;
            setMembersSegment('confirmed');
            goToTab(membersTabIdx);
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('leagueDetail.tabs.members')}
          style={styles.membersPreviewRow}
          testID="overview-members-preview"
        >
          <View style={styles.membersPreviewAvatars}>
            {activeMembers.slice(0, 6).map((m, i) => {
              const uri = getProfilePictureUrl(m.profile?.profile_picture_url ?? null);
              return (
                <View
                  key={m.id}
                  style={[
                    styles.membersPreviewAvatar,
                    i > 0 && styles.membersPreviewAvatarOverlap,
                    {
                      backgroundColor: colors.statusMutedBg,
                      borderColor: colors.cardBackground,
                    },
                  ]}
                >
                  {uri ? (
                    <Image source={{ uri }} style={styles.membersPreviewAvatarImg} />
                  ) : (
                    <Ionicons name="person" size={14} color={colors.textMuted} />
                  )}
                </View>
              );
            })}
            {activeMembers.length > 6 && (
              <View
                style={[
                  styles.membersPreviewAvatar,
                  styles.membersPreviewAvatarOverlap,
                  {
                    backgroundColor: colors.statusActiveBg,
                    borderColor: colors.cardBackground,
                  },
                ]}
              >
                <Text size="xs" weight="semibold" color={colors.primary}>
                  +{activeMembers.length - 6}
                </Text>
              </View>
            )}
          </View>
          <Text size="sm" weight="semibold" color={colors.textMuted}>
            {activeMembers.length}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </Section>
    )}

    {/* Organizer utilities — or, for a plain member, their own quiet
        membership rows (leaving the league lives here, at the end of the
        page, not beside the hero where a mis-tap can reach it). */}
    {organizerRows.length > 0 && (
      <View style={styles.section}>
        <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
          {t(
            isOrganizer
              ? 'leagueDetail.dashboard.manageTitle'
              : 'leagueDetail.dashboard.membershipTitle'
          ).toUpperCase()}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          {organizerRows.map((row, i) => (
            <OverviewActionRow
              key={row.testID}
              icon={row.icon}
              label={row.label}
              onPress={row.onPress}
              destructive={row.destructive}
              disabled={row.disabled}
              badge={row.badge}
              showDivider={i > 0}
              colors={colors}
              testID={row.testID}
            />
          ))}
        </View>
      </View>
    )}
  </View>
);

export default OverviewTab;
