/**
 * Overview pane: the at-a-glance answer to "what is this and what do I do
 * next" — stats, lifecycle stepper, the viewer's own next match, the organizer
 * dashboard and the practical details.
 */

import React from 'react';
import { View, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import type { PlayerSearchResult, Tournament, TournamentMatch } from '@rallia/shared-services';

import type { TranslationKey } from '../../../hooks';
import { ChampionCard } from '../components/ChampionCard';
import { roundLabel } from './BracketSection';
import {
  DashboardCtaCard,
  LifecycleStepper,
  OverviewActionRow,
  OverviewInfoRow,
  Section,
  StatSegment,
  type PendingRequestRow,
  type PlayersSegment,
  type ScreenColors,
  type TabKey,
} from './components';
import { styles } from './detailStyles';

/** Just the pending flag: these are TanStack mutations, and the pane only
 *  ever asks whether one is in flight. */
interface PendingOnly {
  isPending: boolean;
}

interface OverviewTabProps {
  tournament: Tournament;
  colors: ScreenColors;
  t: (key: TranslationKey) => string;
  locale: string;
  formatDate: (iso: string) => string;
  formatDeadline: (iso: string) => string;
  deadlineUrgent: (iso: string) => boolean;
  goToTab: (key: TabKey) => void;
  setPlayersSegment: (segment: PlayersSegment) => void;

  // Lifecycle
  stepIndex: number;
  isLive: boolean;
  isFinished: boolean;
  wasCancelled: boolean;
  startTileLabel: string;
  startTileValue: string;
  registeredCount: number;
  spotsLeft: number;
  matchProgress: { done: number; total: number };
  totalRounds: number;
  championName: string | null;
  isDoubles: boolean;

  // The viewer
  isOrganizer: boolean;
  isInvitePending: boolean;
  isInvitedPending: boolean;
  myActiveRegistration: { status: string } | null;
  myBracketState: 'next' | 'waiting' | 'eliminated' | 'champion' | null;
  myNextMatch: TournamentMatch | null;
  myNextMatchDeadline: string | null;
  /** Reopen the phase availability gate; null hides the link. */
  onEditAvailability?: (() => void) | null;
  myOpponentLabel: string | null;
  myMatchP1: string | null;
  myMatchP2: string | null;
  handleBracketMatchTap: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  handleOpenRoundChat: (tournamentMatchId: string) => void;
  openRoundChat: PendingOnly;
  onWithdraw: () => void;
  withdraw: PendingOnly;
  refundRegistration: PendingOnly;

  // Organizer dashboard
  organizerName: string | null;
  organizerRows: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    badge?: { label: string; tone: 'positive' | 'warning' | 'muted' };
    testID: string;
  }>;
  pendingRequestRows: PendingRequestRow[];
  registeredParticipantPlayers: PlayerSearchResult[];
  hasPlayersTab: boolean;

  // Practical details
  ratingRangeLabel: string | null;
  venueSecondaryLine: string | null;
  entryFeeLabel: string | null;
  refundSummary: string | null;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  tournament,
  colors,
  t,
  locale,
  formatDate,
  formatDeadline,
  deadlineUrgent,
  goToTab,
  setPlayersSegment,
  stepIndex,
  isLive,
  isFinished,
  wasCancelled,
  startTileLabel,
  startTileValue,
  registeredCount,
  spotsLeft,
  matchProgress,
  totalRounds,
  championName,
  isDoubles,
  isOrganizer,
  isInvitePending,
  isInvitedPending,
  myActiveRegistration,
  myBracketState,
  myNextMatch,
  myNextMatchDeadline,
  onEditAvailability = null,
  myOpponentLabel,
  myMatchP1,
  myMatchP2,
  handleBracketMatchTap,
  handleOpenRoundChat,
  openRoundChat,
  onWithdraw,
  withdraw,
  refundRegistration,
  organizerName,
  organizerRows,
  pendingRequestRows,
  registeredParticipantPlayers,
  hasPlayersTab,
  ratingRangeLabel,
  venueSecondaryLine,
  entryFeeLabel,
  refundSummary,
}) => (
  <View style={styles.tabContent}>
    {/* Cancelled-state notice (shown immediately under hero) */}
    {wasCancelled && (
      <View
        style={[
          styles.section,
          styles.cancelledNotice,
          { backgroundColor: colors.cancelledBg, borderColor: colors.cancelledBorder },
        ]}
      >
        <Ionicons name="alert-circle-outline" size={20} color={colors.cancelledText} />
        <View style={{ flex: 1 }}>
          <Text size="sm" weight="semibold" color={colors.cancelledText}>
            {t('tournamentDetail.cancelledNotice.title')}
          </Text>
          {tournament.cancelled_reason ? (
            <Text size="xs" color={colors.cancelledText}>
              {t('tournamentDetail.cancelledNotice.reason').replace(
                '{reason}',
                tournament.cancelled_reason
              )}
            </Text>
          ) : null}
        </View>
      </View>
    )}

    {/* Champion banner */}
    {championName && !wasCancelled && <ChampionCard name={championName} colors={colors} />}

    {/* Stats first: the numbers worth a glance, one segmented card */}
    <View
      style={[
        styles.section,
        styles.statsCard,
        { backgroundColor: colors.cardBackground, borderColor: colors.border },
      ]}
    >
      <StatSegment
        value={`${registeredCount}/${tournament.max_participants}`}
        label={t('tournamentDetail.dashboard.stats.registered')}
        colors={colors}
      />
      {(isLive || isFinished) && !wasCancelled ? (
        <StatSegment
          value={`${matchProgress.done}/${matchProgress.total}`}
          label={t('tournamentDetail.dashboard.stats.games')}
          colors={colors}
          showDivider
        />
      ) : tournament.status === 'registration_open' && tournament.registration_closes_at ? (
        <StatSegment
          value={new Date(tournament.registration_closes_at).toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          })}
          label={t('tournamentDetail.dashboard.stats.deadline')}
          colors={colors}
          showDivider
        />
      ) : null}
      <StatSegment value={startTileValue} label={startTileLabel} colors={colors} showDivider />
    </View>

    {/* Lifecycle pipeline — drops away once the event is over */}
    {!wasCancelled && !isFinished && (
      <View
        style={[
          styles.section,
          styles.stepperCard,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <LifecycleStepper stepIndex={stepIndex} colors={colors} t={t} />
      </View>
    )}

    {/* At most one accent card: approvals waiting, or the live summary.
            Everything state-advancing lives in the docked bar instead. */}
    {isOrganizer && pendingRequestRows.length > 0 && (
      <DashboardCtaCard
        icon="hourglass-outline"
        title={t('tournamentDetail.dashboard.pendingRequestsCta.title')}
        description={t('tournamentDetail.dashboard.pendingRequestsCta.description').replace(
          '{count}',
          String(pendingRequestRows.length)
        )}
        buttonLabel={t('tournamentDetail.dashboard.pendingRequestsCta.review')}
        buttonIcon="people-outline"
        onPress={() => {
          if (!hasPlayersTab) return;
          setPlayersSegment('requests');
          goToTab('players');
        }}
        accent="secondary"
        colors={colors}
        testID="cta-pending-requests"
      />
    )}
    {isOrganizer && isLive && (
      <DashboardCtaCard
        icon="play-outline"
        title={t('tournamentDetail.dashboard.nextStep.liveTitle')}
        description={t('tournamentDetail.dashboard.nextStep.liveDescription')
          .replace('{done}', String(matchProgress.done))
          .replace('{total}', String(matchProgress.total))}
        colors={colors}
      />
    )}

    {/* Full house: no docked action to show, so say so here instead. */}
    {!isOrganizer &&
      tournament.status === 'registration_open' &&
      !myActiveRegistration &&
      spotsLeft === 0 && (
        <DashboardCtaCard
          icon="person-add-outline"
          title={t('tournamentDetail.dashboard.registerCta.full')}
          description={t('tournamentDetail.dashboard.registerCta.fullDescription')}
          colors={colors}
        />
      )}

    {myActiveRegistration && tournament.status === 'registration_open' && (
      <DashboardCtaCard
        icon="checkmark-circle-outline"
        title={
          myActiveRegistration.status === 'pending'
            ? isInvitePending || isInvitedPending
              ? t('tournamentDetail.dashboard.withdrawCta.titleInvited')
              : t('tournamentDetail.dashboard.withdrawCta.titlePending')
            : isDoubles
              ? t('tournamentDetail.dashboard.withdrawCta.titleTeam')
              : t('tournamentDetail.dashboard.withdrawCta.title')
        }
        description={
          myActiveRegistration.status === 'pending'
            ? isInvitePending || isInvitedPending
              ? t('tournamentDetail.dashboard.withdrawCta.descriptionInvited')
              : t('tournamentDetail.dashboard.withdrawCta.descriptionPending')
            : isDoubles
              ? t('tournamentDetail.dashboard.withdrawCta.descriptionTeam')
              : t('tournamentDetail.dashboard.withdrawCta.description')
        }
        buttonLabel={
          withdraw.isPending || refundRegistration.isPending
            ? t('tournamentDetail.actions.withdrawing')
            : t('tournamentDetail.actions.withdraw')
        }
        buttonIcon="exit-outline"
        onPress={onWithdraw}
        disabled={withdraw.isPending || refundRegistration.isPending}
        testID="cta-withdraw"
        destructive
        colors={colors}
      />
    )}

    {/* Participant: my next game (also shown to organizers who play) */}
    {myBracketState && (
      <View style={styles.section}>
        <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
          {t('tournamentDetail.dashboard.myMatch.title').toUpperCase()}
        </Text>
        {myBracketState === 'next' && myNextMatch && myMatchP1 && myMatchP2 ? (
          <>
            <TouchableOpacity
              onPress={() => handleBracketMatchTap(myNextMatch.id, myMatchP1, myMatchP2)}
              activeOpacity={0.7}
              style={[
                styles.card,
                styles.myMatchCard,
                { backgroundColor: colors.highlightBg, borderColor: colors.primary },
              ]}
              accessibilityRole="button"
            >
              <View style={styles.myMatchMain}>
                <Text size="lg" weight="bold" color={colors.text}>
                  {t('tournamentDetail.dashboard.myMatch.vs').replace(
                    '{name}',
                    myOpponentLabel ?? '?'
                  )}
                </Text>
                <Text size="xs" color={colors.textMuted}>
                  {myNextMatch.bracket_side === 'pool'
                    ? t('tournamentDetail.pools.poolGame' as TranslationKey)
                    : roundLabel(myNextMatch.round_number, totalRounds, t)}{' '}
                  · {t('tournamentDetail.dashboard.myMatch.hint')}
                </Text>
                {myNextMatchDeadline && (
                  <View style={styles.myMatchDeadlineRow}>
                    <Ionicons
                      name="time-outline"
                      size={13}
                      color={deadlineUrgent(myNextMatchDeadline) ? colors.danger : colors.textMuted}
                    />
                    <Text
                      size="xs"
                      weight="semibold"
                      color={deadlineUrgent(myNextMatchDeadline) ? colors.danger : colors.textMuted}
                    >
                      {formatDeadline(myNextMatchDeadline)}
                    </Text>
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </TouchableOpacity>

            {onEditAvailability && (
              <TouchableOpacity
                onPress={onEditAvailability}
                activeOpacity={0.7}
                style={styles.editAvailabilityLink}
                accessibilityRole="button"
                testID="link-edit-availability"
              >
                <Text size="sm" weight="semibold" color={colors.primary}>
                  {t('tournamentDetail.availabilityGate.edit' as TranslationKey)}
                </Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View
            style={[
              styles.card,
              styles.myMatchCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name={
                myBracketState === 'eliminated'
                  ? 'flag-outline'
                  : myBracketState === 'champion'
                    ? 'trophy-outline'
                    : 'hourglass-outline'
              }
              size={18}
              color={colors.textMuted}
            />
            <Text size="sm" color={colors.textMuted} style={styles.myMatchStateText}>
              {t(
                myBracketState === 'eliminated'
                  ? 'tournamentDetail.dashboard.myMatch.eliminated'
                  : myBracketState === 'champion'
                    ? 'tournamentDetail.dashboard.myMatch.champion'
                    : 'tournamentDetail.dashboard.myMatch.waiting'
              )}
            </Text>
          </View>
        )}
      </View>
    )}

    {/* About: the organizer's pitch, clamped; the full text lives in
            Details. The length check approximates "6 lines would clip". */}
    {tournament.description?.trim() ? (
      <Section title={t('tournamentDetail.labels.description')} colors={colors}>
        <View style={styles.aboutBlock}>
          <Text size="sm" color={colors.text} style={styles.aboutText} numberOfLines={6}>
            {tournament.description}
          </Text>
          {tournament.description.length > 280 && (
            <TouchableOpacity
              onPress={() => goToTab('details')}
              activeOpacity={0.7}
              accessibilityRole="button"
              style={styles.aboutMore}
            >
              <Text size="sm" weight="semibold" color={colors.primary}>
                {t('tournamentDetail.overview.readMore')}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      </Section>
    ) : null}

    {/* Event info: the friendly at-a-glance card (Details keeps the
            full spec sheet). Rows only render when they have something. */}
    <Section title={t('tournamentDetail.overview.infoTitle')} colors={colors}>
      <OverviewInfoRow
        icon="calendar-outline"
        text={`${formatDate(tournament.start_date)} – ${formatDate(tournament.end_date)}`}
        colors={colors}
      />
      {tournament.venue_name || tournament.city ? (
        <OverviewInfoRow
          icon="location-outline"
          text={tournament.venue_name || tournament.city || ''}
          subText={venueSecondaryLine || undefined}
          colors={colors}
          showDivider
        />
      ) : null}
      {ratingRangeLabel ? (
        <OverviewInfoRow
          icon="analytics-outline"
          text={`${t('tournamentDetail.labels.ratingRange')} · ${ratingRangeLabel}`}
          colors={colors}
          showDivider
        />
      ) : null}
      {entryFeeLabel ? (
        <OverviewInfoRow
          icon="card-outline"
          text={`${t('tournamentDetail.labels.entryFee')} · ${entryFeeLabel}`}
          subText={refundSummary ?? undefined}
          colors={colors}
          showDivider
        />
      ) : null}
      {organizerName ? (
        <OverviewInfoRow
          icon="person-outline"
          text={t('tournamentDetail.dashboard.organizedBy').replace('{name}', organizerName)}
          colors={colors}
          showDivider
        />
      ) : null}
    </Section>

    {/* Who's in: social proof, tappable through to the Players tab */}
    {hasPlayersTab && registeredParticipantPlayers.length > 0 && (
      <Section title={t('tournamentDetail.dashboard.participants.title')} colors={colors}>
        <TouchableOpacity
          onPress={() => {
            setPlayersSegment('confirmed');
            goToTab('players');
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('tournamentDetail.tabs.players')}
          style={styles.playersPreviewRow}
          testID="overview-players-preview"
        >
          <View style={styles.playersPreviewAvatars}>
            {registeredParticipantPlayers.slice(0, 6).map((p, i) => {
              const uri = getProfilePictureUrl(p.profile_picture_url);
              return (
                <View
                  key={p.id}
                  style={[
                    styles.playersPreviewAvatar,
                    i > 0 && styles.playersPreviewAvatarOverlap,
                    {
                      backgroundColor: colors.statusMutedBg,
                      borderColor: colors.cardBackground,
                    },
                  ]}
                >
                  {uri ? (
                    <Image source={{ uri }} style={styles.playersPreviewAvatarImg} />
                  ) : (
                    <Ionicons name="person" size={14} color={colors.textMuted} />
                  )}
                </View>
              );
            })}
            {registeredParticipantPlayers.length > 6 && (
              <View
                style={[
                  styles.playersPreviewAvatar,
                  styles.playersPreviewAvatarOverlap,
                  {
                    backgroundColor: colors.statusActiveBg,
                    borderColor: colors.cardBackground,
                  },
                ]}
              >
                <Text size="xs" weight="semibold" color={colors.primary}>
                  +{registeredParticipantPlayers.length - 6}
                </Text>
              </View>
            )}
          </View>
          <Text size="sm" weight="semibold" color={colors.textMuted}>
            {registeredCount}/{tournament.max_participants}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </Section>
    )}

    {/* Organizer utilities: quiet grouped rows, not competing cards.
            Edit and Invite also live in the header ⋯ menu. */}
    {isOrganizer && organizerRows.length > 0 && (
      <View style={styles.section}>
        <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
          {t('tournamentDetail.dashboard.manageTitle').toUpperCase()}
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
              badge={row.badge}
              onPress={row.onPress}
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
