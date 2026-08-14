/**
 * Seasons pane: the league's seasons, the open season's roster, and the
 * enrolment, payment and lifecycle controls that go with them.
 */

import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { getHumanName, lightHaptic } from '@rallia/shared-utils';
import type {
  PlayerRatingReputation,
  PlayerSearchResult,
  Season,
  SeasonMemberWithProfile,
} from '@rallia/shared-services';

import ParticipantRow from '../../../components/ParticipantRow';
import type { TranslationKey } from '../../../hooks';
import { SEASON_STATUS_KEY, Section, memberToPlayer, type ScreenColors } from './components';
import { styles } from './detailStyles';

/** Badge lookups keyed by player id, as returned by usePlayersRatingReputation. */
type MemberBadges = Record<string, PlayerRatingReputation> | undefined;

interface SeasonsTabProps {
  colors: ScreenColors;
  t: (key: TranslationKey, options?: Record<string, string | number>) => string;
  locale: string;
  userId: string | undefined;
  isOrganizer: boolean;
  seasons: Season[];
  openSeason: Season | undefined;
  openSeasonId: string | undefined;
  seasonRoster: SeasonMemberWithProfile[];
  memberBadges: MemberBadges;
  formatDate: (iso: string) => string;
  formatPrice: (
    cents: number,
    currency: string,
    opts: { locale: string; trimZeroCents?: boolean }
  ) => string;
  canParticipateInSeason: boolean;
  isEnrolledInSeason: boolean;
  isPaidSeason: boolean;
  seasonFeeQuote: { totalCents: number; currency: string } | null | undefined;
  seasonEarnings: { netToOrganizerCents: number; currency: string | null } | null | undefined;
  showSeasonEarnings: () => void;
  handleOpenCreateSeason: () => void;
  handleCloseSeasonPress: (seasonId: string, version: number, name: string) => void;
  handleCancelSeason: (season: Season) => void;
  handlePlayerPress: (player: PlayerSearchResult) => void;
  handleRemoveSeasonMember: (member: SeasonMemberWithProfile) => void;
  handlePaidEnroll: () => void;
  handleWithdrawSeason: () => void;
  enrollSeasonMut: () => void;
  openSeasonMut: (args: { seasonId: string; versionWas: number }) => void;
  isOpeningSeason: boolean;
  isClosingSeason: boolean;
  isCancellingSeason: boolean;
  isEnrollingSeason: boolean;
  isWithdrawingSeason: boolean;
  isPayingSeason: boolean;
  isRefundingSeason: boolean;
}

export const SeasonsTab: React.FC<SeasonsTabProps> = ({
  colors,
  t,
  locale,
  userId,
  isOrganizer,
  seasons,
  openSeason,
  openSeasonId,
  seasonRoster,
  memberBadges,
  formatDate,
  formatPrice,
  canParticipateInSeason,
  isEnrolledInSeason,
  isPaidSeason,
  seasonFeeQuote,
  seasonEarnings,
  showSeasonEarnings,
  handleOpenCreateSeason,
  handleCloseSeasonPress,
  handleCancelSeason,
  handlePlayerPress,
  handleRemoveSeasonMember,
  handlePaidEnroll,
  handleWithdrawSeason,
  enrollSeasonMut,
  openSeasonMut,
  isOpeningSeason,
  isClosingSeason,
  isCancellingSeason,
  isEnrollingSeason,
  isWithdrawingSeason,
  isPayingSeason,
  isRefundingSeason,
}) => (
  <View style={styles.tabContent}>
    <Section title={t('leagueDetail.sections.seasons')} colors={colors}>
      {seasons.length === 0 ? (
        <View style={styles.participantEmpty}>
          <Text size="sm" color={colors.textMuted}>
            {t('leagueDetail.noSeasons')}
          </Text>
        </View>
      ) : (
        seasons.map(s => {
          const statusBg =
            s.status === 'open'
              ? colors.statusPositiveBg
              : s.status === 'draft'
                ? colors.statusNeutralBg
                : colors.statusMutedBg;
          const statusFg =
            s.status === 'open'
              ? colors.statusPositiveText
              : s.status === 'draft'
                ? colors.statusNeutralText
                : colors.statusMutedText;
          return (
            <View key={s.id} style={[styles.seasonCard, { borderBottomColor: colors.border }]}>
              <View style={styles.seasonCardHeader}>
                <View style={styles.seasonCardInfo}>
                  <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text size="xs" color={colors.textMuted}>
                    {formatDate(s.start_date)} – {formatDate(s.end_date)}
                  </Text>
                  {(s.entry_fee_cents ?? 0) > 0 && (
                    // The price was invisible outside the enroll CTA (open
                    // seasons only) — a draft's fee showed nowhere, so an
                    // organizer opened a paid season blind to its price.
                    <Text size="xs" weight="semibold" color={colors.text}>
                      {t('leagueDetail.seasonEntryFee').replace(
                        '{amount}',
                        formatPrice(s.entry_fee_cents ?? 0, s.currency ?? 'CAD', { locale })
                      )}
                    </Text>
                  )}
                </View>
                <View style={[styles.seasonStatusPill, { backgroundColor: statusBg }]}>
                  <Text size="xs" weight="semibold" color={statusFg}>
                    {t(SEASON_STATUS_KEY[s.status] as TranslationKey)}
                  </Text>
                </View>
              </View>
              {isOrganizer && s.status === 'draft' && (
                <TouchableOpacity
                  onPress={() => {
                    lightHaptic();
                    openSeasonMut({ seasonId: s.id, versionWas: s.version });
                  }}
                  disabled={isOpeningSeason}
                  testID="cta-open-season"
                  style={[styles.seasonCtaButton, { borderColor: colors.primary }]}
                >
                  <Text size="sm" weight="semibold" color={colors.primary}>
                    {t('leagueDetail.actions.openSeason')}
                  </Text>
                </TouchableOpacity>
              )}
              {isOrganizer && s.status === 'open' && s.id === openSeasonId && isPaidSeason && (
                <TouchableOpacity
                  onPress={showSeasonEarnings}
                  testID="cta-season-earnings"
                  style={[styles.seasonCtaButton, { borderColor: colors.primary }]}
                >
                  <Text size="sm" weight="semibold" color={colors.primary}>
                    {t('leagueDetail.earnings.row')}
                    {seasonEarnings
                      ? ' · ' +
                        formatPrice(
                          seasonEarnings.netToOrganizerCents,
                          seasonEarnings.currency ?? 'CAD',
                          { locale }
                        )
                      : ''}
                  </Text>
                </TouchableOpacity>
              )}
              {isOrganizer && s.status === 'open' && (
                <TouchableOpacity
                  onPress={() => handleCloseSeasonPress(s.id, s.version, s.name)}
                  disabled={isClosingSeason}
                  testID="cta-close-season"
                  style={[styles.seasonCtaButton, { borderColor: colors.danger }]}
                >
                  <Text size="sm" weight="semibold" color={colors.danger}>
                    {isClosingSeason
                      ? t('leagueDetail.actions.closingSeason')
                      : t('leagueDetail.actions.closeSeason')}
                  </Text>
                </TouchableOpacity>
              )}
              {/* Cancel (abort + refund) is offered on draft and open
                      seasons, quieter than close since close is the normal
                      end and cancel triggers refunds. */}
              {isOrganizer && (s.status === 'draft' || s.status === 'open') && (
                <TouchableOpacity
                  onPress={() => handleCancelSeason(s)}
                  disabled={isCancellingSeason}
                  testID="cta-cancel-season"
                  style={styles.seasonCancelAction}
                >
                  <Text size="sm" weight="semibold" color={colors.danger}>
                    {isCancellingSeason
                      ? t('leagueDetail.seasonLifecycle.cancelling')
                      : t('leagueDetail.seasonLifecycle.cancel')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}
    </Section>

    {openSeason && (
      <Section title={t('leagueDetail.roster.title')} colors={colors}>
        {seasonRoster.length === 0 ? (
          <View style={styles.participantEmpty}>
            <Text size="sm" color={colors.textMuted}>
              {t('leagueDetail.roster.empty')}
            </Text>
          </View>
        ) : (
          <>
            <Text
              size="xs"
              weight="semibold"
              color={colors.textMuted}
              style={styles.rosterCountLabel}
            >
              {t('leagueDetail.roster.count', { count: String(seasonRoster.length) })}
            </Text>
            {seasonRoster.map(m => (
              <ParticipantRow
                key={m.id}
                player={memberToPlayer(m, memberBadges?.[m.user_id])}
                onPress={handlePlayerPress}
                colors={colors}
                showDivider
                trailingActions={
                  isOrganizer && m.user_id !== userId && m.status === 'enrolled'
                    ? [
                        {
                          icon: 'person-remove-outline',
                          color: colors.danger,
                          accessibilityLabel: t('leagueDetail.roster.removeAccessibility', {
                            name: getHumanName(m.profile, t('leagueDetail.unknownMember')),
                          }),
                          onPress: () => handleRemoveSeasonMember(m),
                        },
                      ]
                    : undefined
                }
              />
            ))}
          </>
        )}
        {canParticipateInSeason &&
          (isEnrolledInSeason ? (
            <TouchableOpacity
              onPress={handleWithdrawSeason}
              disabled={isWithdrawingSeason || isRefundingSeason}
              testID="cta-leave-season"
              style={[styles.seasonCtaButton, { borderColor: colors.danger }]}
            >
              <Text size="sm" weight="semibold" color={colors.danger}>
                {isWithdrawingSeason || isRefundingSeason
                  ? t('leagueDetail.roster.leaving')
                  : t('leagueDetail.roster.leave')}
              </Text>
            </TouchableOpacity>
          ) : !isPaidSeason ? (
            // Free season: membership is the enrolment. Say so instead of
            // offering a step that changes nothing.
            <Text size="xs" color={colors.textMuted} testID="season-auto-enrolled-note">
              {t('leagueDetail.roster.autoEnrolled')}
            </Text>
          ) : (
            <TouchableOpacity
              onPress={() => {
                lightHaptic();
                // Paid seasons must go through Stripe: season_enroll is
                // blocked by the payment-required trigger.
                if (isPaidSeason) void handlePaidEnroll();
                else enrollSeasonMut();
              }}
              disabled={isEnrollingSeason || isPayingSeason}
              testID="cta-enroll-season"
              style={[styles.seasonCtaButton, { borderColor: colors.primary }]}
            >
              <Text size="sm" weight="semibold" color={colors.primary}>
                {isEnrollingSeason || isPayingSeason
                  ? t('leagueDetail.roster.enrolling')
                  : isPaidSeason && seasonFeeQuote
                    ? t('leagueDetail.paid.enrollFor').replace(
                        '{amount}',
                        formatPrice(seasonFeeQuote.totalCents, seasonFeeQuote.currency, {
                          locale,
                          trimZeroCents: true,
                        })
                      )
                    : t('leagueDetail.roster.enroll')}
              </Text>
            </TouchableOpacity>
          ))}
      </Section>
    )}

    {isOrganizer && (
      <TouchableOpacity
        onPress={handleOpenCreateSeason}
        style={[styles.primaryButton, { backgroundColor: colors.primary }]}
        testID="cta-create-season"
      >
        <Ionicons name="add-outline" size={20} color="#ffffff" />
        <Text size="base" weight="semibold" color="#ffffff">
          {t('leagueDetail.createSeason.submit')}
        </Text>
      </TouchableOpacity>
    )}
  </View>
);

export default SeasonsTab;
