/**
 * LeagueDetail Screen
 *
 * Read-only summary plus organizer/member action affordances (V6 slice).
 * UI aligned with TournamentDetail: hero, sticky tabs, dashboard CTAs.
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V6
 */

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Image,
  TextInput,
  useWindowDimensions,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Text, Skeleton, SkeletonTextLine, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  secondary,
} from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getHumanName,
  formatPrice,
  getProfilePictureUrl,
} from '@rallia/shared-utils';
import {
  useTheme,
  useAuth,
  useLeague,
  useLeagueMembers,
  useMyLeagueMembership,
  useMyLeagueWaitlistStatus,
  useLeagueWaitlist,
  useLeagueSeasons,
  useJoinLeague,
  useApproveLeagueMember,
  useAcceptLeagueInvite,
  useRevokeLeagueInvite,
  useLeaveLeague,
  useRemoveLeagueMember,
  useSuspendLeagueMember,
  useReinstateLeagueMember,
  usePauseLeague,
  useResumeLeague,
  useCloseLeague,
  useSeasonFeeQuote,
  useEventEarnings,
  useCreateSeasonEnrollmentPayment,
  useRefundSeasonEnrollment,
  leagueKeys,
  useOpenSeason,
  useCloseSeason,
  useCancelSeason,
  useSeasonSessions,
  useSeasonRankings,
  useSeasonMembers,
  useMySeasonMembership,
  useSeasonReceiptUrl,
  useEnrollInSeason,
  useWithdrawFromSeason,
  useRemoveSeasonMember,
  usePublishSession,
  useProfilesByIds,
  usePlayersRatingReputation,
  useMyPayoutAccount,
  tournamentKeys,
} from '@rallia/shared-hooks';
import { SheetManager } from 'react-native-actions-sheet';
import { useStripe } from '@stripe/stripe-react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  isLeagueOrganizer,
  getMyPayoutAccount,
  TournamentPaymentError,
  supabase,
} from '@rallia/shared-services';
import type {
  LeagueMemberWithProfile,
  PlayerProfile,
  PlayerRatingReputation,
  PlayerSearchResult,
  Season,
  SeasonMemberWithProfile,
} from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import { ConfirmationModal } from '#/components/ConfirmationModal';

import ParticipantRow from '../components/ParticipantRow';
import UnderlineTabBar, { type UnderlineTabItem } from '../components/UnderlineTabBar';
import type { LeagueEditData } from '../features/leagues';
import { LeagueBanner, LEAGUE_BANNER_ASPECT } from '../features/leagues/components/LeagueBanner';
import { useTranslation, useThemeStyles, type TranslationKey } from '../hooks';
import { rpcErrorMessage, type RpcErrorOverrides } from '../utils/rpcErrorMessage';
import * as Analytics from '../services/analytics';
import type { RootStackParamList } from '../navigation';

type Route = RouteProp<RootStackParamList, 'LeagueDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type LeagueStatus = Enums<'league_status'>;
/** Members-tab status segments (pill tabs). */
type MembersSegment = 'confirmed' | 'requests' | 'invited' | 'suspended';
type JoinMode = Enums<'tournament_registration_mode'>;
type Visibility = Enums<'tournament_visibility'>;
type SeasonStatus = Enums<'season_status'>;
type SessionStatus = Enums<'session_status'>;

const JOIN_MODE_KEY: Record<JoinMode, string> = {
  open: 'leagueDetail.values.open',
  approval: 'leagueDetail.values.approval',
  invite_only: 'leagueDetail.values.inviteOnly',
};
const VISIBILITY_KEY: Record<Visibility, string> = {
  private: 'leagueDetail.values.private',
  public: 'leagueDetail.values.public',
  community: 'leagueDetail.values.community',
};
/** Scoring labels for the rules card. The fused pickleball values are legacy:
 *  nothing writes them since the games/points split, but old rows carry them. */
const MATCH_FORMAT_KEY: Record<string, string> = {
  one_set: 'leagueDetail.values.oneSet',
  two_of_three: 'leagueDetail.values.twoOfThree',
  three_of_five: 'leagueDetail.values.threeOfFive',
  pickleball_to_11: 'leagueDetail.values.twoOfThree',
  pickleball_to_15: 'leagueDetail.values.twoOfThree',
  pickleball_to_21: 'leagueDetail.values.twoOfThree',
};

/** The subset of the rules jsonb the client reads. */
type LeagueRulesSummary = {
  matchFormat?: string;
  pointWin?: number;
  pointLoss?: number;
  pointBye?: number;
  gamesPerPlayer?: number;
};

function readRules(value: unknown): LeagueRulesSummary {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as LeagueRulesSummary)
    : {};
}

const LEAGUE_STATUS_KEY: Record<LeagueStatus, string> = {
  active: 'leagueDetail.status.active',
  paused: 'leagueDetail.status.paused',
  closed: 'leagueDetail.status.closed',
};
const LEAGUE_STATUS_TONE: Record<LeagueStatus, 'positive' | 'neutral' | 'muted'> = {
  active: 'positive',
  paused: 'neutral',
  closed: 'muted',
};
const SEASON_STATUS_KEY: Record<SeasonStatus, string> = {
  draft: 'leagueDetail.seasonStatus.draft',
  open: 'leagueDetail.seasonStatus.open',
  closed: 'leagueDetail.seasonStatus.closed',
  cancelled: 'leagueDetail.seasonStatus.cancelled',
};
const SESSION_STATUS_KEY: Record<SessionStatus, string> = {
  draft: 'leagueDetail.sessionStatus.draft',
  published: 'leagueDetail.sessionStatus.published',
  in_progress: 'leagueDetail.sessionStatus.inProgress',
  completed: 'leagueDetail.sessionStatus.completed',
  cancelled: 'leagueDetail.sessionStatus.cancelled',
};

/** One-line, player-facing summary of a season's refund policy. Shared by the
 *  enroll CTA and the pre-payment confirmation so the wording can't drift. */
function seasonRefundPolicyLine(
  quote:
    | { refundPolicyKind: string; refundPartialBps: number | null; refundCutoffAt: string | null }
    | null
    | undefined,
  t: (k: TranslationKey) => string,
  locale: string
): string | null {
  if (!quote) return null;
  const cutoff = quote.refundCutoffAt
    ? new Date(quote.refundCutoffAt).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;
  if (quote.refundPolicyKind === 'none') return t('leagueDetail.paid.refundNone');
  if (quote.refundPolicyKind === 'full')
    return cutoff
      ? t('leagueDetail.paid.refundFullUntil').replace('{date}', cutoff)
      : t('leagueDetail.paid.refundFull');
  const pct = String(Math.round((quote.refundPartialBps ?? 0) / 100));
  return cutoff
    ? t('leagueDetail.paid.refundPartialUntil').replace('{pct}', pct).replace('{date}', cutoff)
    : t('leagueDetail.paid.refundPartial').replace('{pct}', pct);
}

/** Mirrors season_request_refund's policy math for the confirm copy. The server
 *  recomputes the authoritative amount; this only sets expectations. */
function estimateSeasonRefundCents(
  quote:
    | {
        entryCents: number;
        refundPolicyKind: string;
        refundPartialBps: number | null;
        refundCutoffAt: string | null;
      }
    | null
    | undefined
): number {
  if (!quote) return 0;
  if (quote.refundPolicyKind === 'none') return 0;
  if (quote.refundCutoffAt && new Date(quote.refundCutoffAt) < new Date()) return 0;
  if (quote.refundPolicyKind === 'full') return quote.entryCents;
  return Math.round((quote.entryCents * (quote.refundPartialBps ?? 0)) / 10000);
}

/** Why a zero estimate is zero: a no-refund policy reads differently from a
 *  refund window the player missed, so the confirm copy distinguishes them. */
function seasonRefundZeroReason(
  quote: { refundPolicyKind: string; refundCutoffAt: string | null } | null | undefined
): 'policy' | 'cutoff' | null {
  if (!quote) return null;
  if (quote.refundPolicyKind === 'none') return 'policy';
  if (quote.refundCutoffAt && new Date(quote.refundCutoffAt) < new Date()) return 'cutoff';
  return null;
}

/**
 * Season + session lifecycle RPC codes (season_open/close/enroll/withdraw,
 * session_publish), ordered most-specific first. PAYOUTS_SETUP_REQUIRED is
 * deliberately absent: the open handler intercepts it to launch onboarding
 * before falling through here.
 */
const SEASON_ERROR_KEYS: RpcErrorOverrides = {
  PAYMENT_REQUIRED: 'leagueDetail.seasonErrors.paymentRequired',
  ENROLLMENT_REMOVED: 'leagueDetail.paid.errors.enrollmentRemoved',
  REFUND_REQUIRED: 'leagueDetail.seasonErrors.refundRequired',
  SEASON_HAS_OPEN_SESSIONS: 'leagueDetail.seasonErrors.hasOpenSessions',
  SEASON_NOT_DRAFT: 'leagueDetail.seasonErrors.seasonNotDraft',
  SEASON_NOT_OPEN: 'leagueDetail.seasonErrors.seasonNotOpen',
  SEASON_ENDED: 'leagueDetail.seasonErrors.seasonEnded',
  SEASON_NOT_FOUND: 'leagueDetail.seasonErrors.seasonNotFound',
  NOT_LEAGUE_MEMBER: 'leagueDetail.seasonErrors.notMember',
  NOT_ENROLLED: 'leagueDetail.seasonErrors.notEnrolled',
  LEAGUE_NOT_ACTIVE: 'leagueDetail.seasonErrors.leagueNotActive',
  INVALID_DEADLINE: 'leagueDetail.seasonErrors.invalidDeadline',
  SESSION_NOT_DRAFT: 'leagueDetail.seasonErrors.sessionNotDraft',
  SESSION_START_PASSED: 'leagueDetail.seasonErrors.sessionStartPassed',
  SESSION_NOT_FOUND: 'leagueDetail.seasonErrors.sessionNotFound',
  NOT_ORGANIZER: 'leagueDetail.seasonErrors.notOrganizer',
  OPTIMISTIC_LOCK_CONFLICT: 'leagueDetail.seasonErrors.stale',
};

/**
 * league_join's gate codes. Without this the screen toasted the exception
 * text, so a gated player saw "RATING_TOO_LOW". Ordered most-specific first.
 */
const JOIN_ERROR_KEYS: RpcErrorOverrides = {
  RATING_REQUIRED: 'leagueDetail.joinErrors.ratingRequired',
  RATING_TOO_LOW: 'leagueDetail.joinErrors.ratingTooLow',
  RATING_TOO_HIGH: 'leagueDetail.joinErrors.ratingTooHigh',
  REPUTATION_GATE_NOT_MET: 'leagueDetail.joinErrors.reputation',
  ALREADY_MEMBER: 'leagueDetail.joinErrors.alreadyMember',
  LEAGUE_NOT_ACTIVE: 'leagueDetail.joinErrors.leagueNotActive',
  LEAGUE_NOT_FOUND: 'leagueDetail.joinErrors.leagueNotFound',
  LEAGUE_FULL: 'leagueDetail.joinErrors.leagueFull',
  NOT_INVITED: 'leagueDetail.joinErrors.notInvited',
  SPORT_MISMATCH: 'leagueDetail.joinErrors.sportMismatch',
};

interface ScreenColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
  statusNeutralBg: string;
  statusNeutralText: string;
  statusPositiveBg: string;
  statusPositiveText: string;
  statusActiveBg: string;
  statusActiveText: string;
  statusMutedBg: string;
  statusMutedText: string;
  highlightBg: string;
  highlightBorder: string;
  secondaryHighlightBg: string;
  secondaryHighlightBorder: string;
  secondaryAccent: string;
  secondaryAccentBg: string;
  danger: string;
  dangerBg: string;
}

const InfoRow: React.FC<{ label: string; value: string; colors: ScreenColors }> = ({
  label,
  value,
  colors,
}) => (
  <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
    <Text size="sm" color={colors.textMuted} style={styles.infoRowLabel}>
      {label}
    </Text>
    <Text size="base" weight="semibold" color={colors.text} style={styles.infoRowValue}>
      {value}
    </Text>
  </View>
);

/** Standalone card holding a single soft "label over full-width value" block —
 *  for free-text fields (description) that shouldn't sit in a cramped right
 *  column. Mirrors TournamentDetail's LabeledBlock. */
const LabeledBlock: React.FC<{
  label: string;
  value?: string;
  colors: ScreenColors;
  children?: React.ReactNode;
}> = ({ label, value, colors, children }) => (
  <View style={styles.section}>
    <View
      style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      <View style={styles.stackedBlock}>
        <Text size="sm" color={colors.textMuted}>
          {label}
        </Text>
        {value ? (
          <Text size="sm" color={colors.text} style={styles.stackedValue}>
            {value}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  </View>
);

const Section: React.FC<{ title: string; children: React.ReactNode; colors: ScreenColors }> = ({
  title,
  children,
  colors,
}) => (
  <View style={styles.section}>
    <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
      {title.toUpperCase()}
    </Text>
    <View
      style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      {children}
    </View>
  </View>
);

// Fixed light-tone text colors for the badge sitting on the banner image: the
// badge background is near-white there regardless of theme.
const ON_IMAGE_TONE_TEXT: Record<'positive' | 'neutral' | 'muted', string> = {
  positive: '#15803d',
  neutral: neutral[700],
  muted: neutral[500],
};

const LeagueStatusBadge: React.FC<{
  status: LeagueStatus;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
  onImage?: boolean;
}> = ({ status, colors, t, onImage }) => {
  const tone = LEAGUE_STATUS_TONE[status];
  const bg = onImage
    ? 'rgba(255,255,255,0.94)'
    : tone === 'positive'
      ? colors.statusPositiveBg
      : tone === 'muted'
        ? colors.statusMutedBg
        : colors.statusNeutralBg;
  const fg = onImage
    ? ON_IMAGE_TONE_TEXT[tone]
    : tone === 'positive'
      ? colors.statusPositiveText
      : tone === 'muted'
        ? colors.statusMutedText
        : colors.statusNeutralText;
  return (
    <View style={[styles.statusBadge, { backgroundColor: bg }]}>
      <Text size="xs" weight="semibold" color={fg}>
        {t(LEAGUE_STATUS_KEY[status] as TranslationKey)}
      </Text>
    </View>
  );
};

function formatRatingRange(min: number | null, max: number | null): string | null {
  const fmt = (v: number) => Number(v).toFixed(1);
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `≤ ${fmt(max)}`;
  return null;
}

const STEP_ICONS: ReadonlyArray<keyof typeof Ionicons.glyphMap> = [
  'create-outline',
  'calendar-outline',
  'tennisball-outline',
  'trophy-outline',
];

const LifecycleStepper: React.FC<{
  stepIndex: number;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
}> = ({ stepIndex, colors, t }) => {
  const labels = [
    t('leagueDetail.dashboard.steps.setup'),
    t('leagueDetail.dashboard.steps.season'),
    t('leagueDetail.dashboard.steps.play'),
    t('leagueDetail.dashboard.steps.done'),
  ];
  return (
    <View style={styles.stepperRow}>
      {labels.map((label, i) => {
        const done = i < stepIndex;
        const active = i === stepIndex;
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <View
                style={[
                  styles.stepperConnector,
                  { backgroundColor: i <= stepIndex ? colors.primary : colors.border },
                ]}
              />
            )}
            <View style={styles.stepperStep}>
              <View
                style={[
                  styles.stepperDot,
                  {
                    backgroundColor: active ? colors.statusActiveBg : 'transparent',
                    borderColor: active || done ? colors.primary : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={done ? 'checkmark' : STEP_ICONS[i]}
                  size={14}
                  color={active || done ? colors.primary : colors.textMuted}
                />
              </View>
              <Text
                size="xs"
                weight={active ? 'semibold' : 'regular'}
                color={active ? colors.primary : colors.textMuted}
              >
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
};

/** Initial-load placeholder mirroring the loaded Overview 1:1 — banner with the
 *  scrim identity lines, sticky-tab geometry, then the stats, stepper and league
 *  info cards — sharing the real StyleSheet so nothing jumps when data lands. */
const LeagueDetailSkeleton: React.FC = () => {
  const { width } = useWindowDimensions();
  const { colors: themed } = useThemeStyles();
  const shimmer = {
    backgroundColor: themed.skeletonBackground,
    highlightColor: themed.skeletonHighlight,
  };
  // The scrim lines sit on the banner artwork, so they shimmer in the same
  // translucent white the real scrim text uses.
  const onBanner = {
    backgroundColor: 'rgba(255,255,255,0.40)',
    highlightColor: 'rgba(255,255,255,0.60)',
  };
  return (
    <View>
      <View style={styles.heroFixed}>
        <View style={styles.heroBanner}>
          <Skeleton
            {...shimmer}
            height={Math.round(width / LEAGUE_BANNER_ASPECT)}
            borderRadius={0}
          />
          {/* Status pill floats near-white on the image in both themes */}
          <View style={styles.heroBannerTopRow}>
            <View style={[styles.statusBadge, { backgroundColor: 'rgba(255,255,255,0.94)' }]}>
              <SkeletonTextLine
                size="xs"
                width={72}
                backgroundColor="rgba(0,0,0,0.10)"
                highlightColor="rgba(0,0,0,0.18)"
              />
            </View>
          </View>
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.68)']}
            locations={[0, 0.42, 1]}
            style={styles.heroScrim}
          >
            <SkeletonTextLine {...onBanner} size="2xl" lineHeight="tight" width="62%" />
            <SkeletonTextLine {...onBanner} size="sm" width="46%" />
          </LinearGradient>
        </View>
      </View>

      <View
        style={[
          styles.tabBarSticky,
          { backgroundColor: themed.background, borderBottomColor: themed.border },
        ]}
      >
        <View style={styles.tabBarContent}>
          {[64, 52, 58, 46].map((w, i) => (
            <View key={i} style={styles.tabItem}>
              <SkeletonTextLine {...shimmer} size="sm" width={w} />
              <View style={styles.tabUnderline} />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.tabContent}>
        {/* Stats: three value/label segments split by hairlines */}
        <View
          style={[
            styles.section,
            styles.statsCard,
            { backgroundColor: themed.cardBackground, borderColor: themed.border },
          ]}
        >
          {[0, 1, 2].map(i => (
            <React.Fragment key={i}>
              {i > 0 && <View style={[styles.statDivider, { backgroundColor: themed.border }]} />}
              <View style={styles.statSegment}>
                <SkeletonTextLine {...shimmer} size="lg" width={44} />
                <SkeletonTextLine {...shimmer} size="xs" width={56} />
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Lifecycle stepper: four dots joined by connectors */}
        <View
          style={[
            styles.section,
            styles.stepperCard,
            { backgroundColor: themed.cardBackground, borderColor: themed.border },
          ]}
        >
          <View style={styles.stepperRow}>
            {[0, 1, 2, 3].map(i => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <View style={[styles.stepperConnector, { backgroundColor: themed.border }]} />
                )}
                <View style={styles.stepperStep}>
                  <Skeleton {...shimmer} width={32} height={32} circle />
                  <SkeletonTextLine {...shimmer} size="xs" width={44} />
                </View>
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* League info: icon-disc rows behind a section title */}
        <View style={styles.section}>
          <SkeletonTextLine {...shimmer} size="xs" width={88} style={styles.sectionTitle} />
          <View
            style={[
              styles.card,
              { backgroundColor: themed.cardBackground, borderColor: themed.border },
            ]}
          >
            {['58%', '72%', '44%', '64%'].map((w, i) => (
              <View
                key={w}
                style={[
                  styles.overviewInfoRow,
                  i > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: themed.border,
                  },
                ]}
              >
                <Skeleton {...shimmer} width={30} height={30} circle />
                <View style={styles.overviewInfoTexts}>
                  <SkeletonTextLine {...shimmer} size="sm" width={w} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
};

const StatSegment: React.FC<{
  value: string;
  label: string;
  colors: ScreenColors;
  showDivider?: boolean;
}> = ({ value, label, colors, showDivider }) => (
  <>
    {showDivider && <View style={[styles.statDivider, { backgroundColor: colors.border }]} />}
    <View style={styles.statSegment}>
      <Text size="lg" weight="bold" color={colors.text} numberOfLines={1}>
        {value}
      </Text>
      <Text size="xs" color={colors.textMuted} numberOfLines={1}>
        {label}
      </Text>
    </View>
  </>
);

/**
 * Compact status chip sitting in the row under the hero banner — same shape as
 * TournamentDetail's HeroChip so the two heroes read identically.
 */
const HeroChip: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: 'positive' | 'outline';
  colors: ScreenColors;
  onPress?: () => void;
  testID?: string;
}> = ({ icon, label, tone, colors, onPress, testID }) => {
  const bg = tone === 'positive' ? colors.statusPositiveBg : 'transparent';
  const fg = tone === 'positive' ? colors.statusPositiveText : colors.primary;
  const inner = (
    <>
      <Ionicons name={icon} size={14} color={fg} />
      <Text size="xs" weight="semibold" color={fg} numberOfLines={1}>
        {label}
      </Text>
      {onPress && <Ionicons name="chevron-forward" size={13} color={fg} />}
    </>
  );
  const style = [
    styles.heroChip,
    { backgroundColor: bg, borderColor: tone === 'outline' ? colors.border : 'transparent' },
  ];
  if (!onPress) return <View style={style}>{inner}</View>;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      {inner}
    </TouchableOpacity>
  );
};

/**
 * Quiet grouped row for the organizer's utility actions (invite, edit,
 * lifecycle). Deliberately lower-contrast than DashboardCtaCard so the one
 * accent card and the docked bar stay the loudest things on the screen.
 */
const OverviewActionRow: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  colors: ScreenColors;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  badge?: { label: string; tone: 'positive' | 'warning' | 'muted' };
  showDivider?: boolean;
  testID?: string;
}> = ({ icon, label, colors, onPress, destructive, disabled, badge, showDivider, testID }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    disabled={disabled}
    testID={testID}
    accessibilityRole="button"
    style={[
      styles.overviewActionRow,
      showDivider && {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      },
      disabled && styles.buttonDisabled,
    ]}
  >
    <Ionicons name={icon} size={18} color={destructive ? colors.danger : colors.primary} />
    <Text
      size="sm"
      weight="medium"
      color={destructive ? colors.danger : colors.text}
      style={styles.overviewActionLabel}
    >
      {label}
    </Text>
    {badge && (
      <View
        style={[
          styles.overviewActionBadge,
          {
            backgroundColor:
              badge.tone === 'positive'
                ? colors.statusPositiveBg
                : badge.tone === 'warning'
                  ? colors.secondaryAccentBg
                  : colors.statusMutedBg,
          },
        ]}
      >
        <Text
          size="xs"
          weight="semibold"
          color={
            badge.tone === 'positive'
              ? colors.statusPositiveText
              : badge.tone === 'warning'
                ? colors.secondaryAccent
                : colors.textMuted
          }
        >
          {badge.label}
        </Text>
      </View>
    )}
    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
  </TouchableOpacity>
);

/** Friendly icon row for the Overview's at-a-glance card: icon disc, primary
 *  line, optional secondary line. Softer than the Details tab's spec-sheet
 *  InfoRow on purpose. */
const OverviewInfoRow: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  subText?: string;
  colors: ScreenColors;
  showDivider?: boolean;
}> = ({ icon, text, subText, colors, showDivider }) => (
  <View
    style={[
      styles.overviewInfoRow,
      showDivider && {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      },
    ]}
  >
    <View style={[styles.overviewInfoIcon, { backgroundColor: colors.statusActiveBg }]}>
      <Ionicons name={icon} size={15} color={colors.primary} />
    </View>
    <View style={styles.overviewInfoTexts}>
      <Text size="sm" weight="medium" color={colors.text}>
        {text}
      </Text>
      {subText ? (
        <Text size="xs" color={colors.textMuted}>
          {subText}
        </Text>
      ) : null}
    </View>
  </View>
);

const DashboardCtaCard: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  buttonLabel?: string;
  buttonIcon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  disabled?: boolean;
  accent?: 'primary' | 'secondary';
  colors: ScreenColors;
  testID?: string;
}> = ({
  icon,
  title,
  description,
  buttonLabel,
  buttonIcon,
  onPress,
  disabled,
  accent = 'primary',
  colors,
  testID,
}) => {
  const cardBg = accent === 'secondary' ? colors.secondaryHighlightBg : colors.highlightBg;
  const cardBorder =
    accent === 'secondary' ? colors.secondaryHighlightBorder : colors.highlightBorder;
  const iconBg = accent === 'secondary' ? colors.secondaryAccentBg : colors.statusActiveBg;
  const iconColor = accent === 'secondary' ? colors.secondaryAccent : colors.primary;
  const buttonBg = accent === 'secondary' ? colors.secondaryAccent : colors.primary;

  return (
    <View
      style={[styles.section, styles.ctaCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
    >
      <View style={styles.ctaCardHeader}>
        <View style={[styles.ctaCardIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={22} color={iconColor} />
        </View>
        <View style={styles.ctaCardTextBlock}>
          <Text size="base" weight="bold" color={colors.text}>
            {title}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.ctaCardDescription}>
            {description}
          </Text>
        </View>
      </View>
      {buttonLabel && onPress && (
        <TouchableOpacity
          onPress={onPress}
          disabled={disabled}
          activeOpacity={0.7}
          style={[
            styles.primaryButton,
            { backgroundColor: buttonBg },
            disabled && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          testID={testID}
        >
          {buttonIcon && <Ionicons name={buttonIcon} size={20} color="#ffffff" />}
          <Text size="base" weight="semibold" color="#ffffff">
            {buttonLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

function memberToPlayer(
  member: {
    user_id: string;
    profile?: PlayerProfile | null;
  },
  badges?: PlayerRatingReputation
): PlayerSearchResult {
  const profile = member.profile;
  return {
    id: member.user_id,
    first_name: profile?.first_name ?? '',
    last_name: profile?.last_name ?? '',
    display_name: null,
    profile_picture_url: profile?.profile_picture_url ?? null,
    city: null,
    gender: null,
    rating: badges?.rating ?? null,
    latitude: null,
    longitude: null,
    distance_meters: null,
    reputation_tier: badges?.reputation_tier ?? null,
    reputation_score: badges?.reputation_score ?? null,
    reputation_is_public: badges?.reputation_is_public ?? false,
    last_seen_at: null,
  };
}

type PendingMemberRow = {
  player: PlayerSearchResult;
  memberId: string;
  version: number;
  /** 1-based place in the league waitlist; absent for plain approval requests. */
  queueRank?: number;
};

const PendingMembersSection: React.FC<{
  rows: PendingMemberRow[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onApprove: (memberId: string, version: number) => void;
  onReject: (memberId: string, version: number, name: string) => void;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, onPlayerPress, onApprove, onReject, colors, t }) => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.pendingSection}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {rows.map(({ player, memberId, version, queueRank }, i) => (
          <View key={memberId}>
            <ParticipantRow
              player={player}
              onPress={onPlayerPress}
              colors={colors}
              showDivider={i > 0}
              trailingActions={[
                {
                  icon: 'checkmark-circle',
                  color: colors.statusPositiveText,
                  accessibilityLabel: t('leagueDetail.dashboard.pendingRequests.approveLabel', {
                    name: getHumanName(player, ''),
                  }),
                  onPress: () => onApprove(memberId, version),
                },
                {
                  icon: 'close-circle',
                  color: colors.danger,
                  accessibilityLabel: t('leagueDetail.dashboard.pendingRequests.rejectLabel', {
                    name: getHumanName(player, ''),
                  }),
                  onPress: () =>
                    onReject(
                      memberId,
                      version,
                      getHumanName(player, t('leagueDetail.unknownMember'))
                    ),
                },
              ]}
            />
            {queueRank != null && (
              <View style={styles.queueBadgeRow}>
                <Ionicons name="list-outline" size={12} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted}>
                  {t('leagueDetail.dashboard.pendingRequests.queuedAt', {
                    rank: String(queueRank),
                  })}
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
};

const InvitedMembersSection: React.FC<{
  rows: PendingMemberRow[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onRevoke: (memberId: string, version: number) => void;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, onPlayerPress, onRevoke, colors, t }) => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.pendingSection}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {rows.map(({ player, memberId, version }, i) => (
          <ParticipantRow
            key={memberId}
            player={player}
            onPress={onPlayerPress}
            colors={colors}
            showDivider={i > 0}
            trailingActions={[
              {
                icon: 'close-circle',
                color: colors.danger,
                accessibilityLabel: t('leagueDetail.dashboard.invited.revokeLabel', {
                  name: getHumanName(player, ''),
                }),
                onPress: () => onRevoke(memberId, version),
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

type ManageMemberRow = {
  player: PlayerSearchResult;
  memberId: string;
  version: number;
  userId: string;
};

const MembersSection: React.FC<{
  rows: ManageMemberRow[];
  ownerId: string;
  onPlayerPress: (player: PlayerSearchResult) => void;
  organizerActions?: {
    onSuspend: (memberId: string, version: number, name: string) => void;
    onRemove: (memberId: string, version: number, name: string) => void;
  };
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, ownerId, onPlayerPress, organizerActions, colors, t }) => (
  <View>
    <View
      style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      {rows.length === 0 ? (
        <View style={styles.participantEmpty}>
          <Text size="sm" color={colors.textMuted}>
            {t('leagueDetail.noMembers')}
          </Text>
        </View>
      ) : (
        rows.map(({ player, memberId, version, userId }, i) => {
          const name = getHumanName(player, '');
          return (
            <ParticipantRow
              key={memberId}
              player={player}
              onPress={onPlayerPress}
              colors={colors}
              showDivider={i > 0}
              trailingActions={
                organizerActions && userId !== ownerId
                  ? [
                      {
                        icon: 'pause-circle-outline',
                        color: colors.textMuted,
                        accessibilityLabel: t('leagueDetail.dashboard.members.suspendLabel', {
                          name,
                        }),
                        onPress: () => organizerActions.onSuspend(memberId, version, name),
                      },
                      {
                        icon: 'remove-circle-outline',
                        color: colors.danger,
                        accessibilityLabel: t('leagueDetail.dashboard.members.removeLabel', {
                          name,
                        }),
                        onPress: () => organizerActions.onRemove(memberId, version, name),
                      },
                    ]
                  : undefined
              }
            />
          );
        })
      )}
    </View>
  </View>
);

const SuspendedMembersSection: React.FC<{
  rows: ManageMemberRow[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onReinstate: (memberId: string, version: number, name: string) => void;
  onRemove: (memberId: string, version: number, name: string) => void;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, onPlayerPress, onReinstate, onRemove, colors, t }) => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.pendingSection}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {rows.map(({ player, memberId, version }, i) => {
          const name = getHumanName(player, '');
          return (
            <ParticipantRow
              key={memberId}
              player={player}
              onPress={onPlayerPress}
              colors={colors}
              showDivider={i > 0}
              trailingActions={[
                {
                  icon: 'play-circle-outline',
                  color: colors.statusPositiveText,
                  accessibilityLabel: t('leagueDetail.dashboard.members.reinstateLabel', { name }),
                  onPress: () => onReinstate(memberId, version, name),
                },
                {
                  icon: 'remove-circle-outline',
                  color: colors.danger,
                  accessibilityLabel: t('leagueDetail.dashboard.members.removeLabel', { name }),
                  onPress: () => onRemove(memberId, version, name),
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
};

export const LeagueDetail: React.FC = () => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const navigation = useNavigation<NavigationProp>();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const route = useRoute<Route>();
  const { leagueId } = route.params;
  const isDark = theme === 'dark';
  const [isRefreshing, setIsRefreshing] = useState(false);

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ScreenColors>(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      primary: isDark ? primary[500] : primary[600],
      statusNeutralBg: isDark ? neutral[700] : neutral[200],
      statusNeutralText: isDark ? neutral[100] : neutral[700],
      statusPositiveBg: isDark ? '#16a34a30' : '#dcfce7',
      statusPositiveText: isDark ? '#86efac' : '#15803d',
      statusActiveBg: isDark ? `${primary[500]}30` : `${primary[600]}20`,
      statusActiveText: isDark ? primary[300] : primary[700],
      statusMutedBg: isDark ? neutral[800] : neutral[100],
      statusMutedText: isDark ? neutral[400] : neutral[500],
      highlightBg: isDark ? primary[950] : primary[50],
      highlightBorder: isDark ? `${primary[400]}40` : `${primary[500]}20`,
      secondaryHighlightBg: isDark ? secondary[950] : secondary[50],
      secondaryHighlightBorder: isDark ? `${secondary[400]}40` : `${secondary[500]}20`,
      secondaryAccent: isDark ? secondary[400] : secondary[500],
      secondaryAccentBg: isDark ? `${secondary[500]}30` : `${secondary[500]}20`,
      danger: isDark ? secondary[400] : secondary[500],
      dangerBg: isDark ? `${secondary[500]}30` : `${secondary[500]}1f`,
    }),
    [themeColors, isDark]
  );

  const { data: league, isLoading, isError, refetch: refetchLeague } = useLeague(leagueId);
  const { data: members = [], refetch: refetchMembers } = useLeagueMembers(leagueId);
  const {
    data: myMembership,
    isFetched: membershipFetched,
    refetch: refetchMembership,
  } = useMyLeagueMembership(leagueId, userId);
  const { data: seasons = [], refetch: refetchSeasons } = useLeagueSeasons(leagueId);
  const { data: profiles } = useProfilesByIds(league ? [league.organizer_id] : []);

  const isOrganizer = league ? isLeagueOrganizer(league, userId) : false;

  // Queue state: a queued joiner holds a 'pending' membership PLUS a waitlist
  // row — the row is what distinguishes "waiting for a seat" from "waiting for
  // approval", and it carries the place in line.
  const isPendingSelfRequest = myMembership?.status === 'pending' && !myMembership.invited_by;
  const { data: myQueueStatus } = useMyLeagueWaitlistStatus(leagueId, userId, isPendingSelfRequest);
  const { data: waitlistEntries = [] } = useLeagueWaitlist(leagueId, isOrganizer);
  const viewedRef = useRef(false);
  useEffect(() => {
    if (!league || !membershipFetched || viewedRef.current) return;
    viewedRef.current = true;
    const userRole = isOrganizer
      ? 'organizer'
      : myMembership?.status === 'active'
        ? 'member'
        : myMembership?.status === 'pending'
          ? 'pending'
          : 'visitor';
    Analytics.leagueViewed({ leagueId: league.id, userRole });
  }, [league, membershipFetched, isOrganizer, myMembership?.status, leagueId]);

  const canJoin =
    !!userId &&
    !!league &&
    league.status === 'active' &&
    !isOrganizer &&
    (!myMembership || myMembership.status === 'inactive');

  const [activeTabIdx, setActiveTabIdx] = useState(0);

  const invalidateAll = useCallback(() => {
    void refetchLeague();
    void refetchMembers();
    void refetchMembership();
    void refetchSeasons();
  }, [refetchLeague, refetchMembers, refetchMembership, refetchSeasons]);

  const { mutate: joinLeague, isPending: isJoining } = useJoinLeague(leagueId, {
    onSuccess: m => {
      successHaptic();
      toast.success(
        m.status === 'pending' ? t('leagueDetail.joinPending') : t('leagueDetail.joinSuccess')
      );
      if (m.status === 'pending') {
        Analytics.leagueMemberPendingAnalytics({ leagueId });
      } else {
        Analytics.leagueMemberJoinedAnalytics({ leagueId, viaInvite: false });
      }
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(rpcErrorMessage(e, t, 'leagueDetail.errors.generic', JOIN_ERROR_KEYS));
    },
  });

  const { mutate: approveMember, isPending: isApproving } = useApproveLeagueMember(leagueId, {
    onSuccess: () => {
      successHaptic();
      toast.success(t('leagueDetail.memberApproved'));
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          LEAGUE_FULL: 'leagueDetail.joinErrors.leagueFull',
          MEMBER_NOT_FOUND: 'leagueDetail.memberErrors.memberNotFound',
        })
      );
    },
  });

  const { mutate: acceptInvite, isPending: isAccepting } = useAcceptLeagueInvite(leagueId, {
    onSuccess: () => {
      successHaptic();
      toast.success(t('leagueDetail.inviteAccepted'));
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          NOT_INVITED: 'leagueDetail.joinErrors.notInvited',
          MEMBER_NOT_FOUND: 'leagueDetail.memberErrors.memberNotFound',
        })
      );
    },
  });

  const { mutate: revokeInvite, isPending: isRevoking } = useRevokeLeagueInvite(leagueId, {
    onSuccess: () => {
      successHaptic();
      toast.success(t('leagueDetail.inviteRevoked'));
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          NOT_REVOCABLE: 'leagueDetail.memberErrors.notRevocable',
          MEMBER_NOT_FOUND: 'leagueDetail.memberErrors.memberNotFound',
        })
      );
    },
  });

  const onMemberLifecycleError = useCallback(
    (e: Error) => {
      warningHaptic();
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          ORGANIZER_CANNOT_LEAVE: 'leagueDetail.memberErrors.organizerImmune',
          CANNOT_REMOVE_ORGANIZER: 'leagueDetail.memberErrors.organizerImmune',
          CANNOT_SUSPEND_ORGANIZER: 'leagueDetail.memberErrors.organizerImmune',
          MEMBER_NOT_FOUND: 'leagueDetail.memberErrors.memberNotFound',
        })
      );
    },
    [toast, t]
  );

  const { mutate: leaveLeagueMut, isPending: isLeaving } = useLeaveLeague(leagueId, {
    onError: onMemberLifecycleError,
  });

  // Rejecting a join request is the same RPC as removing a member (it accepts a
  // 'pending' row); only the confirmation the organizer gets differs.
  const isRejectingRequest = useRef(false);

  const { mutate: removeMemberMut, isPending: isRemovingMember } = useRemoveLeagueMember(leagueId, {
    onSuccess: () => {
      successHaptic();
      toast.success(
        t(
          isRejectingRequest.current ? 'leagueDetail.requestRejected' : 'leagueDetail.memberRemoved'
        )
      );
      isRejectingRequest.current = false;
      invalidateAll();
    },
    onError: e => {
      isRejectingRequest.current = false;
      onMemberLifecycleError(e);
    },
  });

  const { mutate: suspendMemberMut, isPending: isSuspendingMember } = useSuspendLeagueMember(
    leagueId,
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.memberSuspended'));
        invalidateAll();
      },
      onError: onMemberLifecycleError,
    }
  );

  const { mutate: reinstateMemberMut, isPending: isReinstatingMember } = useReinstateLeagueMember(
    leagueId,
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.memberReinstated'));
        invalidateAll();
      },
      onError: onMemberLifecycleError,
    }
  );

  // Organizer payout onboarding. The paid unit is the season, so an organizer
  // needs a card-capable Stripe Express account before a paid season can open.
  // Surface the row whenever any season carries a fee — including a draft the
  // organizer set a price on but hasn't opened yet, which is exactly when they
  // need to onboard (season_open raises PAYOUTS_SETUP_REQUIRED otherwise). The
  // account, and both edge functions, are per-organizer not per-event, so this
  // is the same flow tournaments use.
  const hasPaidSeason = useMemo(() => seasons.some(s => (s.entry_fee_cents ?? 0) > 0), [seasons]);
  const { data: payoutAccount } = useMyPayoutAccount(userId, isOrganizer && hasPaidSeason);

  const handleStripeOnboard = useCallback(
    async (businessType: 'individual' | 'company') => {
      try {
        const { data, error } = await supabase.functions.invoke('player-stripe-onboard', {
          body: { businessType },
        });
        if (error || !data?.url) throw new Error(error?.message);
        // Custom scheme (not the https return_url) so ASWebAuthenticationSession
        // auto-dismisses on the callback — the web /stripe-connect-return page
        // bounces Stripe's https return to this scheme.
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          'rallia://stripe-connect-return'
        );
        if (result.type === 'success' && userId) {
          // stripe-connect-webhook flips the mirror asynchronously (usually
          // well under 30 s); poll it so the payout badge updates without the
          // user leaving and reopening the screen.
          successHaptic();
          toast.info(t('leagueDetail.payments.payoutSyncWait'));
          void (async () => {
            for (let attempt = 0; attempt < 10; attempt++) {
              const status = await qc
                .fetchQuery({
                  queryKey: tournamentKeys.myPayoutAccount(userId),
                  queryFn: getMyPayoutAccount,
                  staleTime: 0,
                })
                .catch(() => null);
              if (status?.chargesEnabled) {
                successHaptic();
                toast.success(t('leagueDetail.payments.payoutsConnectedToast'));
                return;
              }
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          })();
        }
      } catch {
        warningHaptic();
        toast.error(t('leagueDetail.payments.onboardingError'));
      }
    },
    [qc, t, toast, userId]
  );

  // Ask individual vs company, then kick off onboarding. Shared by the payout
  // row and the season-open guard error path.
  const promptOnboardBusinessType = useCallback(() => {
    Alert.alert(
      t('leagueDetail.payments.payoutsSetupTitle'),
      t('leagueDetail.payments.payoutsSetupBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.payments.onboardTypeIndividual'),
          onPress: () => void handleStripeOnboard('individual'),
        },
        {
          text: t('leagueDetail.payments.onboardTypeBusiness'),
          onPress: () => void handleStripeOnboard('company'),
        },
      ]
    );
  }, [t, handleStripeOnboard]);

  // Post-onboarding: open the Stripe Express dashboard when ready, or resume
  // onboarding when unfinished. The webhook refreshes status, so invalidate on
  // return. player-stripe-manage makes several sequential Stripe calls before
  // returning the link, so the row shows a transient state and blocks re-taps.
  const [isOpeningPayoutDashboard, setIsOpeningPayoutDashboard] = useState(false);
  const handleManagePayouts = useCallback(async () => {
    if (isOpeningPayoutDashboard) return;
    setIsOpeningPayoutDashboard(true);
    try {
      const { data, error } = await supabase.functions.invoke('player-stripe-manage');
      if (error || !data?.url) throw new Error(error?.message);
      await WebBrowser.openAuthSessionAsync(data.url, 'rallia://stripe-connect-return');
      if (userId) {
        void qc.invalidateQueries({ queryKey: tournamentKeys.myPayoutAccount(userId) });
      }
    } catch {
      warningHaptic();
      toast.error(t('leagueDetail.payments.manageError'));
    }
    setIsOpeningPayoutDashboard(false);
  }, [qc, t, toast, userId, isOpeningPayoutDashboard]);

  const { mutate: openSeasonMut, isPending: isOpeningSeason } = useOpenSeason(leagueId, {
    onSuccess: season => {
      successHaptic();
      toast.success(t('leagueDetail.seasonOpened'));
      Analytics.seasonOpenedAnalytics({ leagueId, seasonId: season.id });
      invalidateAll();
    },
    onError: e => {
      // Paid season without completed payout setup: prompt the organizer to
      // finish Stripe onboarding instead of surfacing the raw gate code.
      if (e.message.includes('PAYOUTS_SETUP_REQUIRED')) {
        warningHaptic();
        promptOnboardBusinessType();
        return;
      }
      warningHaptic();
      toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
    },
  });

  // Pending self-requests (await organizer approval) vs organizer invites
  // (await the player accepting).
  const pendingRequests = useMemo(
    () => members.filter(m => m.status === 'pending' && !m.invited_by),
    [members]
  );
  const invitedMembers = useMemo(
    () => members.filter(m => m.status === 'pending' && !!m.invited_by),
    [members]
  );
  const activeMembers = useMemo(() => members.filter(m => m.status === 'active'), [members]);
  const suspendedMembers = useMemo(() => members.filter(m => m.status === 'suspended'), [members]);

  const openSeason = useMemo(() => seasons.find(s => s.status === 'open'), [seasons]);
  const openSeasonId = openSeason?.id;
  const { data: seasonRoster = [] } = useSeasonMembers(openSeasonId);

  // Sport-scoped rating + reputation for every member/roster row, batch-fetched
  // once (league members lack the enrichment the tournament participants RPC
  // bakes in).
  const badgePlayerIds = useMemo(
    () => [...members.map(m => m.user_id), ...seasonRoster.map(m => m.user_id)],
    [members, seasonRoster]
  );
  const { data: memberBadges } = usePlayersRatingReputation(badgePlayerIds, league?.sport_id);

  // Queued joiners are pending rows that also hold a waitlist entry; tag them
  // with their place in line and list them after the plain approval requests,
  // in queue order.
  const queueRankByUser = useMemo(() => {
    const map = new Map<string, number>();
    waitlistEntries.forEach((w, i) => map.set(w.user_id, i + 1));
    return map;
  }, [waitlistEntries]);

  const pendingMemberRows = useMemo<PendingMemberRow[]>(
    () =>
      isOrganizer
        ? pendingRequests
            .map(m => ({
              player: memberToPlayer(m, memberBadges?.[m.user_id]),
              memberId: m.id,
              version: m.version,
              queueRank: queueRankByUser.get(m.user_id),
            }))
            .sort((a, b) => (a.queueRank ?? 0) - (b.queueRank ?? 0))
        : [],
    [pendingRequests, isOrganizer, memberBadges, queueRankByUser]
  );

  const invitedMemberRows = useMemo<PendingMemberRow[]>(
    () =>
      isOrganizer
        ? invitedMembers.map(m => ({
            player: memberToPlayer(m, memberBadges?.[m.user_id]),
            memberId: m.id,
            version: m.version,
          }))
        : [],
    [invitedMembers, isOrganizer, memberBadges]
  );

  const activeMemberRows = useMemo<ManageMemberRow[]>(
    () =>
      activeMembers.map(m => ({
        player: memberToPlayer(m, memberBadges?.[m.user_id]),
        memberId: m.id,
        version: m.version,
        userId: m.user_id,
      })),
    [activeMembers, memberBadges]
  );
  const suspendedMemberRows = useMemo<ManageMemberRow[]>(
    () =>
      suspendedMembers.map(m => ({
        player: memberToPlayer(m, memberBadges?.[m.user_id]),
        memberId: m.id,
        version: m.version,
        userId: m.user_id,
      })),
    [suspendedMembers, memberBadges]
  );

  // Members-tab status segments. Requests / Invited / Suspended only exist
  // while they hold entries (all organizer-gated); the selection falls back to
  // Confirmed when its segment empties out.
  const [membersSegment, setMembersSegment] = useState<MembersSegment>('confirmed');
  const membersSegmentTabs = useMemo<UnderlineTabItem<MembersSegment>[]>(() => {
    const tabs: UnderlineTabItem<MembersSegment>[] = [
      {
        key: 'confirmed',
        label: t('leagueDetail.dashboard.memberTabs.confirmed'),
        count: activeMemberRows.length,
        tone: 'positive',
      },
    ];
    // Requests need the organizer to act, so they run warm; invites are just
    // waiting on the invitee.
    if (pendingMemberRows.length > 0)
      tabs.push({
        key: 'requests',
        label: t('leagueDetail.dashboard.memberTabs.requests'),
        count: pendingMemberRows.length,
        tone: 'warning',
      });
    if (invitedMemberRows.length > 0)
      tabs.push({
        key: 'invited',
        label: t('leagueDetail.dashboard.memberTabs.invited'),
        count: invitedMemberRows.length,
        tone: 'info',
      });
    if (isOrganizer && suspendedMemberRows.length > 0)
      tabs.push({
        key: 'suspended',
        label: t('leagueDetail.dashboard.memberTabs.suspended'),
        count: suspendedMemberRows.length,
        tone: 'danger',
      });
    return tabs;
  }, [
    t,
    activeMemberRows.length,
    pendingMemberRows.length,
    invitedMemberRows.length,
    suspendedMemberRows.length,
    isOrganizer,
  ]);
  const activeMembersSegment: MembersSegment = membersSegmentTabs.some(
    tab => tab.key === membersSegment
  )
    ? membersSegment
    : 'confirmed';

  const draftSeasons = useMemo(() => seasons.filter(s => s.status === 'draft'), [seasons]);

  const { data: seasonSessions = [] } = useSeasonSessions(openSeasonId);

  const { data: mySeasonMembership } = useMySeasonMembership(openSeasonId, userId);
  const isEnrolledInSeason = mySeasonMembership?.status === 'enrolled';
  const canParticipateInSeason = isOrganizer || myMembership?.status === 'active';

  const { mutate: enrollSeasonMut, isPending: isEnrollingSeason } = useEnrollInSeason(
    openSeasonId ?? '',
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.roster.enrolled'));
      },
      onError: e => {
        warningHaptic();
        toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
      },
    }
  );

  const { mutate: withdrawSeasonMut, isPending: isWithdrawingSeason } = useWithdrawFromSeason(
    openSeasonId ?? '',
    {
      onSuccess: () => {
        lightHaptic();
        toast.success(t('leagueDetail.roster.withdrew'));
      },
      onError: e => {
        warningHaptic();
        toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
      },
    }
  );

  // ---------------------------------------------------------------- paid seasons
  const isPaidSeason = (openSeason?.entry_fee_cents ?? 0) > 0;
  const { data: seasonFeeQuote } = useSeasonFeeQuote(openSeasonId, isPaidSeason);
  // What the open season has collected — the organizer's only in-app money view
  // (the Stripe dashboard is account-wide and can't be tied back to one season).
  const { data: seasonEarnings } = useEventEarnings(
    { seasonId: openSeasonId },
    isOrganizer && isPaidSeason
  );
  // Stripe-hosted receipt for the viewer's own paid enrollment. Not gated on
  // enrollment: after a withdrawal that same receipt is where the refund shows up.
  const { data: seasonReceiptUrl } = useSeasonReceiptUrl(mySeasonMembership?.id, isPaidSeason);
  const { mutateAsync: createSeasonPayment, isPending: isPayingSeason } =
    useCreateSeasonEnrollmentPayment();
  const { mutateAsync: refundSeasonEnrollmentAsync, isPending: isRefundingSeason } =
    useRefundSeasonEnrollment();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const handlePaidEnroll = useCallback(async () => {
    if (!openSeasonId || !seasonFeeQuote) return;

    // Point-of-sale disclosure before any charge: the full price breakdown,
    // the refund policy, that the service fee isn't refundable, and that
    // Rallia only facilitates (the organizer, not Rallia, owns the season).
    // GST/QST rides on Rallia's service fee; the player only pays the fee and
    // its tax in player_pays mode (organizer_absorbs nets them from the
    // organizer's take, so the player sees the entry price and nothing else).
    const cur = seasonFeeQuote.currency;
    const money = (cents: number) => formatPrice(cents, cur, { locale });
    const playerPaysFee = seasonFeeQuote.feePayer === 'player_pays';
    const breakdown = playerPaysFee
      ? ([
          t('leagueDetail.paid.breakdownEntry').replace(
            '{amount}',
            money(seasonFeeQuote.entryCents)
          ),
          t('leagueDetail.paid.breakdownServiceFee').replace(
            '{amount}',
            money(seasonFeeQuote.serviceFeeCents)
          ),
          seasonFeeQuote.feeTaxCents > 0
            ? t('leagueDetail.paid.breakdownFeeTax').replace(
                '{amount}',
                money(seasonFeeQuote.feeTaxCents)
              )
            : null,
          t('leagueDetail.paid.breakdownTotal').replace(
            '{amount}',
            money(seasonFeeQuote.totalCents)
          ),
        ]
          .filter(Boolean)
          .join('\n') as string)
      : [
          t('leagueDetail.paid.breakdownTotal').replace(
            '{amount}',
            money(seasonFeeQuote.totalCents)
          ),
          t('leagueDetail.paid.feeCoveredByOrganizer'),
        ].join('\n');
    const lines = [
      breakdown,
      seasonRefundPolicyLine(seasonFeeQuote, t, locale),
      playerPaysFee ? t('leagueDetail.paid.confirmFeeNonRefundable') : null,
      t('leagueDetail.paid.liabilityNotice'),
    ].filter(Boolean) as string[];

    const confirmed = await new Promise<boolean>(resolve => {
      Alert.alert(t('leagueDetail.paid.confirmTitle'), lines.join('\n\n'), [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('leagueDetail.paid.pay'), onPress: () => resolve(true) },
      ]);
    });
    if (!confirmed) return;

    try {
      const intent = await createSeasonPayment({ seasonId: openSeasonId });
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: intent.clientSecret,
        merchantDisplayName: 'Rallia',
        applePay: { merchantCountryCode: 'CA' },
        googlePay: { merchantCountryCode: 'CA', currencyCode: 'CAD', testEnv: __DEV__ },
      });
      if (initError) throw new Error(initError.message);

      const { error: payError } = await presentPaymentSheet();
      if (payError) {
        // Cancelling is not a failure: the 15-min reaper frees the slot.
        if (payError.code === 'Canceled') return;
        throw new Error(payError.message);
      }

      successHaptic();
      toast.success(t('leagueDetail.roster.enrolled'));

      // The webhook flips payment_pending -> enrolled asynchronously, so a single
      // invalidate here would re-read the pre-webhook state. Refetch again shortly
      // after (same trick TournamentDetail uses).
      const refresh = () => {
        void qc.invalidateQueries({ queryKey: leagueKeys.seasons(leagueId) });
        void qc.invalidateQueries({ queryKey: leagueKeys.seasonMembers(openSeasonId) });
        void qc.invalidateQueries({
          queryKey: leagueKeys.mySeasonMembership(openSeasonId, userId ?? ''),
        });
        void qc.invalidateQueries({ queryKey: leagueKeys.rankings(openSeasonId) });
      };
      refresh();
      setTimeout(refresh, 2500);
    } catch (e) {
      warningHaptic();
      const code = e instanceof TournamentPaymentError ? e.code : null;
      const key =
        code === 'season_not_open'
          ? 'leagueDetail.paid.errors.seasonNotOpen'
          : code === 'already_enrolled'
            ? 'leagueDetail.paid.errors.alreadyEnrolled'
            : code === 'enrollment_removed'
              ? 'leagueDetail.paid.errors.enrollmentRemoved'
              : code === 'organizer_not_ready'
                ? 'leagueDetail.paid.errors.organizerNotReady'
                : code === 'not_league_member'
                  ? 'leagueDetail.paid.errors.notMember'
                  : 'leagueDetail.paid.errors.generic';
      toast.error(t(key));
    }
  }, [
    createSeasonPayment,
    initPaymentSheet,
    leagueId,
    locale,
    openSeasonId,
    presentPaymentSheet,
    qc,
    seasonFeeQuote,
    t,
    toast,
    userId,
  ]);

  const handleWithdrawSeason = useCallback(() => {
    // A paid enrolment must go through the refund path, not a plain withdraw:
    // the refund RPC is what reverses the charge per the season's policy.
    if (isPaidSeason && mySeasonMembership) {
      // Client-side mirror of the SQL policy math, for the confirm copy only —
      // the server recomputes the authoritative amount.
      const estimate = estimateSeasonRefundCents(seasonFeeQuote);
      const money = (cents: number) =>
        formatPrice(cents, seasonFeeQuote?.currency ?? 'CAD', { locale });
      // The fee + its GST/QST only exist on the player's side in player_pays mode.
      const feesKeptCents = seasonFeeQuote
        ? seasonFeeQuote.serviceFeeCents + seasonFeeQuote.feeTaxCents
        : 0;
      const playerPaidFee =
        !!seasonFeeQuote && seasonFeeQuote.feePayer === 'player_pays' && feesKeptCents > 0;
      const cutoffLabel = seasonFeeQuote?.refundCutoffAt
        ? new Date(seasonFeeQuote.refundCutoffAt).toLocaleDateString(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : '';
      const zeroLine =
        seasonRefundZeroReason(seasonFeeQuote) === 'cutoff'
          ? t('leagueDetail.paid.withdrawConfirmCutoffPassed').replace('{date}', cutoffLabel)
          : t('leagueDetail.paid.withdrawConfirmNoRefund');
      const message = [
        seasonFeeQuote
          ? t('leagueDetail.paid.withdrawConfirmPaid').replace(
              '{amount}',
              money(seasonFeeQuote.totalCents)
            )
          : null,
        estimate > 0
          ? t('leagueDetail.paid.withdrawConfirmRefund').replace('{amount}', money(estimate))
          : zeroLine,
        estimate > 0 && playerPaidFee
          ? t('leagueDetail.paid.withdrawConfirmFeesKept').replace('{amount}', money(feesKeptCents))
          : null,
      ]
        .filter(Boolean)
        .join('\n');
      Alert.alert(t('leagueDetail.paid.withdrawConfirmTitle'), message, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.roster.leave'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const r = await refundSeasonEnrollmentAsync({
                  seasonMemberId: mySeasonMembership.id,
                  versionWas: mySeasonMembership.version,
                  seasonId: mySeasonMembership.season_id,
                  leagueId,
                });
                lightHaptic();
                toast.success(
                  r.refundedCents > 0
                    ? t('leagueDetail.paid.refunded').replace(
                        '{amount}',
                        formatPrice(r.refundedCents, seasonFeeQuote?.currency ?? 'CAD', {
                          locale,
                        })
                      )
                    : t('leagueDetail.roster.withdrew')
                );
              } catch {
                warningHaptic();
                toast.error(t('leagueDetail.paid.errors.refundFailed'));
              }
            })();
          },
        },
      ]);
      return;
    }

    Alert.alert(
      t('leagueDetail.roster.leaveConfirmTitle'),
      t('leagueDetail.roster.leaveConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.roster.leave'),
          style: 'destructive',
          onPress: () => withdrawSeasonMut(),
        },
      ]
    );
  }, [
    isPaidSeason,
    leagueId,
    locale,
    mySeasonMembership,
    refundSeasonEnrollmentAsync,
    seasonFeeQuote,
    t,
    toast,
    withdrawSeasonMut,
  ]);

  // Organizer removes a roster member. Removal marks the member disqualified;
  // on a paid season that queues an automatic refund through the settle cron
  // (the same path a cancellation uses), so the confirmation tells the player
  // their entry comes back per the season's policy. Mirrors how tournaments
  // treat an organizer removal.
  const { mutate: removeSeasonMemberMut, isPending: isRemovingSeasonMember } =
    useRemoveSeasonMember(openSeasonId ?? '', {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.roster.removed'));
      },
      onError: e => {
        const msg = e.message || '';
        const key = msg.includes('OPTIMISTIC_LOCK_CONFLICT')
          ? 'leagueDetail.roster.removeErrors.stale'
          : msg.includes('NOT_ORGANIZER')
            ? 'leagueDetail.roster.removeErrors.notOrganizer'
            : msg.includes('NOT_REMOVABLE')
              ? 'leagueDetail.roster.removeErrors.notRemovable'
              : 'leagueDetail.roster.removeErrors.generic';
        warningHaptic();
        toast.error(t(key));
      },
    });

  const handleRemoveSeasonMember = useCallback(
    (member: SeasonMemberWithProfile) => {
      if (isRemovingSeasonMember) return;
      const name = getHumanName(member.profile, t('leagueDetail.unknownMember'));
      const doRemove = () => {
        warningHaptic();
        removeSeasonMemberMut({ seasonMemberId: member.id, versionWas: member.version });
      };
      const body = isPaidSeason
        ? estimateSeasonRefundCents(seasonFeeQuote) > 0
          ? t('leagueDetail.roster.removeConfirmRefund', {
              amount: formatPrice(
                estimateSeasonRefundCents(seasonFeeQuote),
                seasonFeeQuote?.currency ?? 'CAD',
                {
                  locale,
                }
              ),
            })
          : seasonRefundZeroReason(seasonFeeQuote) === 'cutoff'
            ? t('leagueDetail.roster.removeConfirmCutoffPassed')
            : t('leagueDetail.roster.removeConfirmNoRefund')
        : t('leagueDetail.roster.removeConfirmFree');
      Alert.alert(t('leagueDetail.roster.removeConfirmTitle', { name }), body, [
        { text: t('leagueDetail.roster.keepMember'), style: 'cancel' },
        { text: t('leagueDetail.roster.removeConfirm'), style: 'destructive', onPress: doRemove },
      ]);
    },
    [isPaidSeason, isRemovingSeasonMember, locale, removeSeasonMemberMut, seasonFeeQuote, t]
  );

  // Every season that ever had standings, newest first: a closed season keeps
  // its table instead of being buried by the next one.
  const standingsSeasons = useMemo(
    () =>
      seasons
        .filter(s => s.status === 'open' || s.status === 'closed')
        .sort((a, b) => b.start_date.localeCompare(a.start_date)),
    [seasons]
  );
  const [pickedStandingsSeasonId, setPickedStandingsSeasonId] = useState<string | null>(null);

  // Default to the open season, else the most recent closed one.
  const rankingSeason = useMemo(
    () =>
      standingsSeasons.find(s => s.id === pickedStandingsSeasonId) ??
      openSeason ??
      standingsSeasons[0] ??
      null,
    [standingsSeasons, pickedStandingsSeasonId, openSeason]
  );
  const { data: rankings = [] } = useSeasonRankings(rankingSeason?.id);

  const { mutate: closeSeasonMut, isPending: isClosingSeason } = useCloseSeason(leagueId, {
    onSuccess: season => {
      successHaptic();
      toast.success(t('leagueDetail.seasonClosed'));
      Analytics.seasonClosedAnalytics({ leagueId, seasonId: season.id });
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
    },
  });

  // Closing freezes the final standings and cannot be undone, so it asks first,
  // the way cancelling a season and closing the league already do.
  const handleCloseSeasonPress = useCallback(
    (seasonId: string, versionWas: number, name: string) => {
      if (isClosingSeason) return;
      Alert.alert(
        t('leagueDetail.confirm.closeSeasonTitle', { name }),
        t('leagueDetail.confirm.closeSeasonMessage'),
        [
          { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
          {
            text: t('leagueDetail.confirm.closeSeasonConfirm'),
            style: 'destructive',
            onPress: () => {
              warningHaptic();
              closeSeasonMut({ seasonId, versionWas });
            },
          },
        ]
      );
    },
    [closeSeasonMut, isClosingSeason, t]
  );

  const { cancelSeasonAsync, isCancellingSeason } = useCancelSeason({
    onSuccess: () => {
      successHaptic();
      toast.success(t('leagueDetail.seasonCancelled'));
      invalidateAll();
    },
    onError: e => {
      const msg = e.message || '';
      const key = msg.includes('SEASON_NOT_CANCELLABLE')
        ? 'leagueDetail.seasonLifecycle.errors.notCancellable'
        : msg.includes('OPTIMISTIC_LOCK_CONFLICT') || msg.includes('NOT_ORGANIZER')
          ? 'leagueDetail.seasonLifecycle.errors.stale'
          : 'leagueDetail.seasonLifecycle.errors.cancelFailed';
      warningHaptic();
      toast.error(t(key));
    },
  });

  // Cancel is the abort path, distinct from close: it flips the season to
  // 'cancelled', which is the only status that feeds paid enrolments into the
  // refund cron (lt_cancel_refund_candidates). A paid open season is where the
  // money warning matters — cancel refunds everyone per policy, close pays the
  // organizer instead. Draft seasons have no enrolments so the copy is plainer.
  // season_cancel has always accepted a reason and stored it in
  // cancelled_reason; the UI sent null, so the cancellation notice reaching
  // members had nothing to explain it. Ask, the way session cancellation does.
  const [cancelSeasonTarget, setCancelSeasonTarget] = useState<Season | null>(null);
  const [cancelSeasonReason, setCancelSeasonReason] = useState('');

  // Money summary for the open season, from the payment ledger. Alert keeps it
  // glanceable; the Stripe dashboard remains the detailed view.
  const showSeasonEarnings = useCallback(() => {
    if (!seasonEarnings) return;
    const cur = seasonEarnings.currency ?? 'CAD';
    const money = (cents: number) => formatPrice(cents, cur, { locale });
    const e = seasonEarnings;
    const lines =
      e.paidCount === 0 && e.pendingCount === 0 && e.refundedCount === 0
        ? [t('leagueDetail.earnings.none')]
        : [
            t('leagueDetail.earnings.paidLine')
              .replace('{count}', String(e.paidCount))
              .replace('{amount}', money(e.entryCents)),
            t('leagueDetail.earnings.feesLine').replace(
              '{amount}',
              money(e.serviceFeeCents + e.feeTaxCents)
            ),
            ...(e.refundedCents > 0
              ? [
                  t('leagueDetail.earnings.refundedLine').replace(
                    '{amount}',
                    money(e.refundedCents)
                  ),
                ]
              : []),
            ...(e.pendingCount > 0
              ? [t('leagueDetail.earnings.pendingLine').replace('{count}', String(e.pendingCount))]
              : []),
            t('leagueDetail.earnings.netLine').replace('{amount}', money(e.netToOrganizerCents)),
            ...(e.releasedCount > 0
              ? [
                  t('leagueDetail.earnings.releasedLine').replace(
                    '{count}',
                    String(e.releasedCount)
                  ),
                ]
              : []),
          ];
    Alert.alert(t('leagueDetail.earnings.title'), lines.join('\n'), [
      { text: t('leagueDetail.earnings.close') },
    ]);
  }, [seasonEarnings, t, locale]);

  const handleCancelSeason = useCallback(
    (season: Season) => {
      if (isCancellingSeason) return;
      warningHaptic();
      setCancelSeasonReason('');
      setCancelSeasonTarget(season);
    },
    [isCancellingSeason]
  );

  const { mutate: publishSessionMut, isPending: isPublishingSession } = usePublishSession(
    openSeason?.id ?? '',
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.sessions.published'));
      },
      onError: e => {
        warningHaptic();
        toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
      },
    }
  );

  const stepIndex = useMemo(() => {
    if (openSeason) return 2;
    if (draftSeasons.length > 0) return 1;
    if (seasons.length > 0 && seasons.every(s => s.status === 'closed')) return 3;
    return 0;
  }, [openSeason, draftSeasons.length, seasons]);

  const organizerName = useMemo(() => {
    if (!league) return '';
    const profile = profiles?.[league.organizer_id];
    return profile ? getHumanName(profile, '') : '';
  }, [league, profiles]);

  const formatDate = useCallback(
    (isoOrDate: string | Date): string => {
      const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
      return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
    },
    [locale]
  );

  const formatDateTime = useCallback(
    (isoOrDate: string | Date): string => {
      const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
      return d.toLocaleString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    },
    [locale]
  );

  const currentSeasonLabel = openSeason
    ? openSeason.name
    : (draftSeasons[0]?.name ?? t('leagueDetail.dashboard.stats.noSeason'));

  const sessionPill = useCallback(
    (status: SessionStatus) => {
      const positive = status === 'published' || status === 'in_progress';
      const muted = status === 'completed' || status === 'cancelled';
      return {
        bg: positive
          ? colors.statusPositiveBg
          : muted
            ? colors.statusMutedBg
            : colors.statusNeutralBg,
        fg: positive
          ? colors.statusPositiveText
          : muted
            ? colors.statusMutedText
            : colors.statusNeutralText,
      };
    },
    [colors]
  );

  const tabs = useMemo(
    () => [
      { key: 'overview' as const, label: t('leagueDetail.tabs.overview') },
      { key: 'members' as const, label: t('leagueDetail.tabs.members') },
      { key: 'seasons' as const, label: t('leagueDetail.tabs.seasons') },
      { key: 'sessions' as const, label: t('leagueDetail.tabs.sessions') },
      { key: 'details' as const, label: t('leagueDetail.tabs.details') },
    ],
    [t]
  );
  const currentTabIdx = Math.min(activeTabIdx, tabs.length - 1);
  const currentTabKey = tabs[currentTabIdx].key;
  const membersTabIdx = tabs.findIndex(tab => tab.key === 'members');

  const goToTab = useCallback((idx: number) => {
    void lightHaptic();
    setActiveTabIdx(idx);
  }, []);

  const handlePlayerPress = useCallback(
    (player: PlayerSearchResult) => {
      if (!league) return;
      lightHaptic();
      navigation.navigate('PlayerProfile', {
        playerId: player.id,
        sportId: league.sport_id,
      });
    },
    [navigation, league]
  );

  const handleApprovePress = useCallback(
    (memberId: string, version: number) => {
      if (isApproving) return;
      lightHaptic();
      approveMember({ memberId, versionWas: version });
    },
    [approveMember, isApproving]
  );

  const handleRejectPress = useCallback(
    (memberId: string, version: number, name: string) => {
      if (isRemovingMember) return;
      Alert.alert(
        t('leagueDetail.confirm.rejectTitle', { name }),
        t('leagueDetail.confirm.rejectMessage', { name }),
        [
          { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
          {
            text: t('leagueDetail.confirm.rejectConfirm'),
            style: 'destructive',
            onPress: () => {
              warningHaptic();
              isRejectingRequest.current = true;
              removeMemberMut({ memberId, versionWas: version });
            },
          },
        ]
      );
    },
    [isRemovingMember, removeMemberMut, t]
  );

  const handleRevokePress = useCallback(
    (memberId: string, version: number) => {
      if (isRevoking) return;
      warningHaptic();
      revokeInvite({ memberId, versionWas: version });
    },
    [revokeInvite, isRevoking]
  );

  const handleLeavePress = useCallback(() => {
    if (isLeaving) return;
    Alert.alert(
      t('leagueDetail.confirm.leaveTitle'),
      t('leagueDetail.confirm.leaveMessage', { name: league?.name ?? '' }),
      [
        { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.confirm.leaveConfirm'),
          style: 'destructive',
          onPress: () => {
            warningHaptic();
            leaveLeagueMut(undefined, {
              onSuccess: () => {
                successHaptic();
                toast.success(t('leagueDetail.leftLeague'));
                invalidateAll();
              },
            });
          },
        },
      ]
    );
  }, [isLeaving, leaveLeagueMut, t, toast, league?.name, invalidateAll]);

  const handleCancelRequestPress = useCallback(() => {
    if (isLeaving) return;
    Alert.alert(
      t('leagueDetail.confirm.cancelRequestTitle'),
      t('leagueDetail.confirm.cancelRequestMessage', { name: league?.name ?? '' }),
      [
        { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.confirm.cancelRequestConfirm'),
          style: 'destructive',
          onPress: () => {
            warningHaptic();
            leaveLeagueMut(undefined, {
              onSuccess: () => {
                successHaptic();
                toast.success(t('leagueDetail.requestCancelled'));
                invalidateAll();
              },
            });
          },
        },
      ]
    );
  }, [isLeaving, leaveLeagueMut, t, toast, league?.name, invalidateAll]);

  const handleRemoveMemberPress = useCallback(
    (memberId: string, version: number, name: string) => {
      if (isRemovingMember) return;
      Alert.alert(
        t('leagueDetail.confirm.removeTitle', { name }),
        t('leagueDetail.confirm.removeMessage', { name }),
        [
          { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
          {
            text: t('leagueDetail.confirm.removeConfirm'),
            style: 'destructive',
            onPress: () => {
              warningHaptic();
              removeMemberMut({ memberId, versionWas: version });
            },
          },
        ]
      );
    },
    [isRemovingMember, removeMemberMut, t]
  );

  const handleSuspendMemberPress = useCallback(
    (memberId: string, version: number, name: string) => {
      if (isSuspendingMember) return;
      Alert.alert(
        t('leagueDetail.confirm.suspendTitle', { name }),
        t('leagueDetail.confirm.suspendMessage', { name }),
        [
          { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
          {
            text: t('leagueDetail.confirm.suspendConfirm'),
            style: 'destructive',
            onPress: () => {
              warningHaptic();
              suspendMemberMut({ memberId, versionWas: version });
            },
          },
        ]
      );
    },
    [isSuspendingMember, suspendMemberMut, t]
  );

  const handleReinstateMemberPress = useCallback(
    (memberId: string, version: number) => {
      if (isReinstatingMember) return;
      lightHaptic();
      reinstateMemberMut({ memberId, versionWas: version });
    },
    [isReinstatingMember, reinstateMemberMut]
  );

  const handleInvitePress = useCallback(() => {
    if (!league) return;
    lightHaptic();
    const exclude = members
      .filter(m => m.status === 'active' || m.status === 'pending' || m.status === 'suspended')
      .map(m => m.user_id);
    void SheetManager.show('league-invite-players', {
      payload: {
        leagueId,
        leagueName: league.name,
        sportId: league.sport_id,
        excludeUserIds: exclude,
      },
    });
  }, [league, members, leagueId]);

  const handleEditLeague = useCallback(() => {
    if (!league) return;
    lightHaptic();
    void SheetManager.show('league-edit', {
      payload: {
        league: {
          id: league.id,
          version: league.version,
          name: league.name,
          description: league.description,
          visibility: league.visibility as LeagueEditData['visibility'],
          joinMode: league.join_mode,
          minRating: league.min_rating,
          maxRating: league.max_rating,
          logoUrl: league.logo_url,
          memberCapacity: league.member_capacity,
          waitlistEnabled: league.waitlist_enabled,
          defaultRules: readRules(league.default_rules) as Record<string, unknown>,
        },
      },
    });
  }, [league]);

  // All three lifecycle transitions map their server errors the same way.
  const lifecycleErrorHandler = useCallback(
    (err: Error) => {
      const msg = err.message || '';
      const key = msg.includes('LEAGUE_HAS_OPEN_SEASONS')
        ? 'leagueDetail.lifecycle.errors.hasOpenSeasons'
        : msg.includes('OPTIMISTIC_LOCK_CONFLICT') ||
            msg.includes('LEAGUE_NOT_ACTIVE') ||
            msg.includes('LEAGUE_NOT_PAUSED') ||
            msg.includes('LEAGUE_NOT_CLOSABLE')
          ? 'leagueDetail.lifecycle.errors.stale'
          : 'leagueDetail.lifecycle.errors.generic';
      warningHaptic();
      toast.error(t(key));
    },
    [t, toast]
  );

  const { pauseLeagueAsync, isPausing } = usePauseLeague({ onError: lifecycleErrorHandler });
  const { resumeLeagueAsync, isResuming } = useResumeLeague({ onError: lifecycleErrorHandler });
  const { closeLeagueAsync, isClosing } = useCloseLeague({ onError: lifecycleErrorHandler });

  const handlePauseLeague = useCallback(() => {
    if (!league) return;
    lightHaptic();
    Alert.alert(
      t('leagueDetail.lifecycle.pauseConfirmTitle'),
      t('leagueDetail.lifecycle.pauseConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.lifecycle.pause'),
          onPress: () => {
            void (async () => {
              try {
                await pauseLeagueAsync({ leagueId: league.id, versionWas: league.version });
                successHaptic();
                toast.success(t('leagueDetail.lifecycle.paused'));
              } catch {
                // toast handled in hook
              }
            })();
          },
        },
      ]
    );
  }, [league, pauseLeagueAsync, t, toast]);

  const handleResumeLeague = useCallback(() => {
    if (!league) return;
    lightHaptic();
    void (async () => {
      try {
        await resumeLeagueAsync({ leagueId: league.id, versionWas: league.version });
        successHaptic();
        toast.success(t('leagueDetail.lifecycle.resumed'));
      } catch {
        // toast handled in hook
      }
    })();
  }, [league, resumeLeagueAsync, t, toast]);

  const handleCloseLeague = useCallback(() => {
    if (!league) return;
    lightHaptic();
    Alert.alert(
      t('leagueDetail.lifecycle.closeConfirmTitle'),
      t('leagueDetail.lifecycle.closeConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.lifecycle.close'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await closeLeagueAsync({
                  leagueId: league.id,
                  reason: null,
                  versionWas: league.version,
                });
                successHaptic();
                toast.success(t('leagueDetail.lifecycle.closed'));
              } catch {
                // toast handled in hook
              }
            })();
          },
        },
      ]
    );
  }, [league, closeLeagueAsync, t, toast]);

  const handleOpenCreateSeason = useCallback(() => {
    lightHaptic();
    void SheetManager.show('create-season', { payload: { leagueId } });
  }, [leagueId]);

  const handleOpenCreateSession = useCallback(() => {
    if (!openSeason) return;
    lightHaptic();
    const seasonRules = readRules(openSeason.rules);
    void SheetManager.show('create-session', {
      payload: {
        seasonId: openSeason.id,
        leagueId,
        defaultRounds: seasonRules.gamesPerPlayer,
      },
    });
  }, [openSeason, leagueId]);

  const handlePublishSession = useCallback(
    (sessionId: string, version: number) => {
      if (isPublishingSession) return;
      lightHaptic();
      publishSessionMut({ sessionId, versionWas: version });
    },
    [publishSessionMut, isPublishingSession]
  );

  const handleOpenSession = useCallback(
    (sessionId: string, name: string) => {
      lightHaptic();
      navigation.navigate('SessionDetail', { sessionId, leagueId, sessionName: name });
    },
    [navigation, leagueId]
  );

  // Pull-to-refresh: rosters, seasons and paid-enrolment state all settle
  // server-side after the user leaves the screen, so refetch the whole set.
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: leagueKeys.detail(leagueId) }),
        qc.invalidateQueries({ queryKey: leagueKeys.members(leagueId) }),
        qc.invalidateQueries({ queryKey: leagueKeys.seasons(leagueId) }),
        // The roster can move server-side while the user sits here, so the
        // card's member count is refreshed alongside the rest.
        qc.invalidateQueries({ queryKey: leagueKeys.lists() }),
        // Pulling is exactly what someone does when the screen looks stale,
        // and "am I in yet?" is the state most likely to have moved.
        userId
          ? qc.invalidateQueries({ queryKey: leagueKeys.myMembership(leagueId, userId) })
          : Promise.resolve(),
        userId
          ? qc.invalidateQueries({ queryKey: leagueKeys.myWaitlistStatus(leagueId, userId) })
          : Promise.resolve(),
        qc.invalidateQueries({ queryKey: leagueKeys.waitlist(leagueId) }),
        openSeasonId
          ? qc.invalidateQueries({ queryKey: leagueKeys.seasonMembers(openSeasonId) })
          : Promise.resolve(),
        openSeasonId
          ? qc.invalidateQueries({ queryKey: leagueKeys.sessions(openSeasonId) })
          : Promise.resolve(),
        openSeasonId
          ? qc.invalidateQueries({ queryKey: leagueKeys.rankings(openSeasonId) })
          : Promise.resolve(),
        openSeasonId && userId
          ? qc.invalidateQueries({
              queryKey: leagueKeys.mySeasonMembership(openSeasonId, userId),
            })
          : Promise.resolve(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [qc, leagueId, openSeasonId, userId]);

  if (isLoading) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <LeagueDetailSkeleton />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('leagueDetail.loadError')}
          </Text>
          <TouchableOpacity
            onPress={() => refetchLeague()}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text size="base" weight="semibold" color="#ffffff">
              {t('leagueDetail.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!league) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('leagueDetail.notFound')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centeredSubtext}>
            {t('leagueDetail.notFoundDescription')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const ratingRangeLabel = formatRatingRange(league.min_rating, league.max_rating);

  // How the league actually runs, read off the rules the standings use. The open
  // season wins: its rules are snapshotted at creation and can drift from the
  // league defaults afterwards.
  const rules = readRules(openSeason?.rules ?? league.default_rules);
  const scoringLabel = rules.matchFormat ? MATCH_FORMAT_KEY[rules.matchFormat] : undefined;
  const pointsLabel =
    rules.pointWin != null && rules.pointLoss != null
      ? t('leagueDetail.overview.rulesPoints', {
          win: String(rules.pointWin),
          loss: String(rules.pointLoss),
          bye: String(rules.pointBye ?? 0),
        })
      : undefined;

  /** Organizer utilities, rendered as one quiet grouped list in the Overview. */
  const organizerRows: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    destructive?: boolean;
    disabled?: boolean;
    badge?: { label: string; tone: 'positive' | 'warning' | 'muted' };
    testID: string;
  }> = [];
  if (isOrganizer) {
    organizerRows.push({
      icon: 'person-add-outline',
      label: t('leagueDetail.invitePlayers.button'),
      onPress: handleInvitePress,
      testID: 'action-invite-players',
    });
    // undefined = still loading (or no paid season, query disabled); the row
    // appears once payout status is known.
    if (hasPaidSeason && payoutAccount !== undefined) {
      organizerRows.push({
        icon: 'wallet-outline',
        label: t('leagueDetail.payments.payoutRow.label'),
        onPress:
          payoutAccount === null ? promptOnboardBusinessType : () => void handleManagePayouts(),
        badge: isOpeningPayoutDashboard
          ? { label: t('leagueDetail.payments.payoutRow.opening'), tone: 'muted' }
          : payoutAccount === null
            ? { label: t('leagueDetail.payments.payoutRow.setup'), tone: 'muted' }
            : !payoutAccount.chargesEnabled
              ? { label: t('leagueDetail.payments.payoutRow.actionNeeded'), tone: 'warning' }
              : { label: t('leagueDetail.payments.payoutRow.ready'), tone: 'positive' },
        testID: 'action-payouts',
      });
    }
    // A closed league is terminal server-side, so edit is hidden rather than
    // offered and then refused.
    if (league.status !== 'closed') {
      organizerRows.push({
        icon: 'create-outline',
        label: t('leagueDetail.editModal.title'),
        onPress: handleEditLeague,
        testID: 'cta-edit-league',
      });
    }
    // Lifecycle. Pause/resume are mutually exclusive on status; close is
    // terminal so it's hidden once closed rather than shown and refused.
    if (league.status === 'active') {
      organizerRows.push({
        icon: 'pause-circle-outline',
        label: isPausing ? t('leagueDetail.lifecycle.pausing') : t('leagueDetail.lifecycle.pause'),
        onPress: handlePauseLeague,
        disabled: isPausing,
        testID: 'cta-pause-league',
      });
    }
    if (league.status === 'paused') {
      organizerRows.push({
        icon: 'play-circle-outline',
        label: isResuming
          ? t('leagueDetail.lifecycle.resuming')
          : t('leagueDetail.lifecycle.resume'),
        onPress: handleResumeLeague,
        disabled: isResuming,
        testID: 'cta-resume-league',
      });
    }
    if (league.status !== 'closed') {
      organizerRows.push({
        icon: 'lock-closed-outline',
        label: isClosing ? t('leagueDetail.lifecycle.closing') : t('leagueDetail.lifecycle.close'),
        onPress: handleCloseLeague,
        destructive: true,
        disabled: isClosing,
        testID: 'cta-close-league',
      });
    }
  }

  /**
   * The one state-advancing action for this viewer, docked to the bottom of
   * the screen so it's reachable from any tab at any position (the tournament
   * pattern). Everything else stays quiet in the Overview.
   */
  const primaryAction: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    disabled: boolean;
    hint: string | null;
    testID: string;
  } | null = (() => {
    if (league.status === 'closed') return null;
    // Organizer-sent invite: accept is the conversion moment.
    if (!isOrganizer && myMembership?.status === 'pending' && myMembership.invited_by) {
      return {
        label: isAccepting ? t('leagueDetail.accepting') : t('leagueDetail.acceptInvite'),
        icon: 'mail-open-outline',
        onPress: () => {
          lightHaptic();
          acceptInvite();
        },
        disabled: isAccepting,
        hint: null,
        testID: 'cta-accept-invite',
      };
    }
    if (canJoin) {
      return {
        label: isJoining ? t('leagueDetail.actions.joining') : t('leagueDetail.actions.join'),
        icon: 'person-add-outline',
        onPress: () => {
          lightHaptic();
          joinLeague();
        },
        disabled: isJoining,
        hint: t('leagueDetail.dashboard.joinCta.description'),
        testID: 'cta-join-league',
      };
    }
    // Active member with a PAID open season they haven't paid into yet. A free
    // season needs no such step: opening it seeds every active member into the
    // standings, and confirming a session enrolls the player on its own.
    if (
      !isOrganizer &&
      league.status === 'active' &&
      openSeason &&
      isPaidSeason &&
      canParticipateInSeason &&
      !isEnrolledInSeason
    ) {
      const busy = isEnrollingSeason || isPayingSeason;
      return {
        label: busy
          ? t('leagueDetail.roster.enrolling')
          : isPaidSeason && seasonFeeQuote
            ? t('leagueDetail.paid.enrollFor').replace(
                '{amount}',
                formatPrice(seasonFeeQuote.totalCents, seasonFeeQuote.currency, {
                  locale,
                  trimZeroCents: true,
                })
              )
            : t('leagueDetail.roster.enroll'),
        icon: 'person-add-outline',
        onPress: () => {
          lightHaptic();
          if (isPaidSeason) void handlePaidEnroll();
          else enrollSeasonMut();
        },
        disabled: busy,
        hint: isPaidSeason ? seasonRefundPolicyLine(seasonFeeQuote, t, locale) : null,
        testID: 'cta-enroll-season',
      };
    }
    if (isOrganizer && league.status === 'active') {
      if (seasons.length === 0) {
        return {
          label: t('leagueDetail.createSeason.submit'),
          icon: 'add-outline',
          onPress: handleOpenCreateSeason,
          disabled: false,
          hint: t('leagueDetail.dashboard.createSeasonCta.description'),
          testID: 'cta-create-season-overview',
        };
      }
      if (!openSeason && draftSeasons.length > 0) {
        return {
          label: isOpeningSeason
            ? t('leagueDetail.actions.openingSeason')
            : t('leagueDetail.actions.openSeason'),
          icon: 'lock-open-outline',
          onPress: () => {
            lightHaptic();
            openSeasonMut({ seasonId: draftSeasons[0].id, versionWas: draftSeasons[0].version });
          },
          disabled: isOpeningSeason,
          hint: t('leagueDetail.dashboard.openSeasonCta.description').replace(
            '{name}',
            draftSeasons[0].name
          ),
          // Not 'cta-open-season': the Seasons tab keeps that id and Maestro
          // taps it there — duplicate ids make the tap ambiguous.
          testID: 'cta-open-season-docked',
        };
      }
    }
    return null;
  })();

  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.screenScroll}
        contentContainerStyle={[
          styles.screenScrollContent,
          // Clear the docked bar (button + a two-line hint at worst) so the
          // last card is never trapped behind it.
          primaryAction ? { paddingBottom: 120 + insets.bottom } : null,
        ]}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Hero */}
        <View style={styles.heroFixed}>
          {/* Full-bleed banner: status floats on the image, the scrim carries
              the identity line. Mirrors the list card so tapping a card reads
              as it expanding. The description lives in the Details tab. */}
          <View style={styles.heroBanner}>
            <LeagueBanner logoUrl={league.logo_url} />
            <View style={styles.heroBannerTopRow}>
              <LeagueStatusBadge status={league.status} colors={colors} t={t} onImage />
            </View>
            {/* Scrim is deliberately shallow and light: it only has to carry
                two lines, and the text shadow does the rest of the legibility
                work, so the artwork stays visible. */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.68)']}
              locations={[0, 0.42, 1]}
              style={styles.heroScrim}
            >
              <Text
                size="2xl"
                weight="bold"
                lineHeight="tight"
                color="#ffffff"
                numberOfLines={1}
                style={styles.scrimText}
              >
                {league.name}
              </Text>
              <Text
                size="sm"
                color="rgba(255,255,255,0.92)"
                numberOfLines={1}
                style={styles.scrimText}
              >
                {[
                  t('leagueDetail.hero.membersCount').replace(
                    '{count}',
                    String(activeMembers.length)
                  ),
                  league.venue_name,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </LinearGradient>
          </View>

          {/* One chip row carries the viewer's membership state; the quiet
              leave/cancel text action sits beside it. */}
          {!isOrganizer &&
          (myMembership?.status === 'active' || myMembership?.status === 'pending') ? (
            <View style={styles.heroChipRow}>
              {myMembership.status === 'active' ? (
                <HeroChip
                  icon="checkmark-circle"
                  tone="positive"
                  colors={colors}
                  label={t('leagueDetail.memberActive')}
                />
              ) : (
                <HeroChip
                  icon={myQueueStatus ? 'list-outline' : 'hourglass-outline'}
                  tone="outline"
                  colors={colors}
                  label={
                    myMembership.invited_by
                      ? t('leagueDetail.acceptInvite')
                      : myQueueStatus
                        ? t('leagueDetail.queuedInLine', {
                            rank: String(myQueueStatus.queueRank),
                            size: String(myQueueStatus.queueSize),
                          })
                        : t('leagueDetail.membershipPending')
                  }
                />
              )}
              {seasonReceiptUrl ? (
                <HeroChip
                  icon="receipt-outline"
                  tone="outline"
                  colors={colors}
                  onPress={() => void Linking.openURL(seasonReceiptUrl)}
                  label={t('leagueDetail.viewReceipt')}
                />
              ) : null}
              {myMembership.status === 'active' ? (
                <TouchableOpacity
                  onPress={handleLeavePress}
                  disabled={isLeaving}
                  style={styles.heroTextAction}
                  testID="cta-leave-league"
                >
                  <Text size="xs" weight="semibold" color={colors.danger}>
                    {t('leagueDetail.leaveLeague')}
                  </Text>
                </TouchableOpacity>
              ) : !myMembership.invited_by ? (
                <TouchableOpacity
                  onPress={handleCancelRequestPress}
                  disabled={isLeaving}
                  style={styles.heroTextAction}
                  testID="cta-cancel-request"
                >
                  <Text size="xs" weight="semibold" color={colors.danger}>
                    {t('leagueDetail.cancelRequest')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Sticky tab bar — scrollable underline tabs, matching the
            tournament detail screen. */}
        <View
          style={[
            styles.tabBarSticky,
            { backgroundColor: colors.background, borderBottomColor: colors.border },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBarContent}
          >
            {tabs.map((tab, i) => {
              const selected = i === currentTabIdx;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => goToTab(i)}
                  activeOpacity={0.7}
                  style={styles.tabItem}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  testID={`league-tab-${tab.key}`}
                >
                  <Text
                    size="sm"
                    weight={selected ? 'semibold' : 'medium'}
                    color={selected ? colors.primary : colors.textMuted}
                    numberOfLines={1}
                  >
                    {tab.label}
                  </Text>
                  <View
                    style={[
                      styles.tabUnderline,
                      { backgroundColor: selected ? colors.primary : 'transparent' },
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Overview */}
        {currentTabKey === 'overview' && (
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
                <Text
                  size="sm"
                  weight="semibold"
                  color={colors.statusMutedText}
                  style={styles.flex1}
                >
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
                  style={[
                    styles.standingRow,
                    styles.standingHeader,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <Text
                    size="xs"
                    weight="semibold"
                    color={colors.textMuted}
                    style={styles.standingRank}
                  >
                    #
                  </Text>
                  <Text
                    size="xs"
                    weight="semibold"
                    color={colors.textMuted}
                    style={styles.standingName}
                  >
                    {t('leagueDetail.standings.player')}
                  </Text>
                  <Text
                    size="xs"
                    weight="semibold"
                    color={colors.textMuted}
                    style={styles.standingWl}
                  >
                    {t('leagueDetail.standings.wl')}
                  </Text>
                  <Text
                    size="xs"
                    weight="semibold"
                    color={colors.textMuted}
                    style={styles.standingPts}
                  >
                    {t('leagueDetail.standings.pts')}
                  </Text>
                </View>
                {rankings.slice(0, 12).map((r, i) => (
                  <View
                    key={r.id}
                    style={[
                      styles.standingRow,
                      i < Math.min(rankings.length, 12) - 1 && {
                        borderBottomColor: colors.border,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <Text
                      size="sm"
                      weight="semibold"
                      color={colors.text}
                      style={styles.standingRank}
                    >
                      {r.rank ?? i + 1}
                    </Text>
                    <Text
                      size="sm"
                      color={colors.text}
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

            {/* Organizer utilities: quiet grouped rows, not competing cards. */}
            {isOrganizer && organizerRows.length > 0 && (
              <View style={styles.section}>
                <Text
                  size="xs"
                  weight="semibold"
                  color={colors.textMuted}
                  style={styles.sectionTitle}
                >
                  {t('leagueDetail.dashboard.manageTitle').toUpperCase()}
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
        )}

        {/* Members */}
        {currentTabKey === 'members' && (
          <View style={styles.playersTabContent}>
            {isOrganizer && (
              <TouchableOpacity
                onPress={handleInvitePress}
                style={[
                  styles.primaryButton,
                  styles.inviteButton,
                  { backgroundColor: colors.primary },
                ]}
                testID="cta-invite-players"
              >
                <Ionicons name="person-add-outline" size={20} color="#ffffff" />
                <Text size="base" weight="semibold" color="#ffffff">
                  {t('leagueDetail.invitePlayers.button')}
                </Text>
              </TouchableOpacity>
            )}
            {/* Edit and lifecycle controls live in the Overview's Manage list. */}
            {membersSegmentTabs.length > 1 && (
              <UnderlineTabBar
                tabs={membersSegmentTabs}
                activeKey={activeMembersSegment}
                onChange={setMembersSegment}
                style={styles.segmentBar}
              />
            )}
            {activeMembersSegment === 'requests' ? (
              <PendingMembersSection
                rows={pendingMemberRows}
                onPlayerPress={handlePlayerPress}
                onApprove={handleApprovePress}
                onReject={handleRejectPress}
                colors={colors}
                t={t}
              />
            ) : activeMembersSegment === 'invited' ? (
              <InvitedMembersSection
                rows={invitedMemberRows}
                onPlayerPress={handlePlayerPress}
                onRevoke={handleRevokePress}
                colors={colors}
                t={t}
              />
            ) : activeMembersSegment === 'suspended' && isOrganizer ? (
              <SuspendedMembersSection
                rows={suspendedMemberRows}
                onPlayerPress={handlePlayerPress}
                onReinstate={handleReinstateMemberPress}
                onRemove={handleRemoveMemberPress}
                colors={colors}
                t={t}
              />
            ) : (
              <MembersSection
                rows={activeMemberRows}
                ownerId={league.organizer_id}
                onPlayerPress={handlePlayerPress}
                organizerActions={
                  isOrganizer
                    ? { onSuspend: handleSuspendMemberPress, onRemove: handleRemoveMemberPress }
                    : undefined
                }
                colors={colors}
                t={t}
              />
            )}
          </View>
        )}

        {/* Seasons */}
        {currentTabKey === 'seasons' && (
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
                    <View
                      key={s.id}
                      style={[styles.seasonCard, { borderBottomColor: colors.border }]}
                    >
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
                      {isOrganizer &&
                        s.status === 'open' &&
                        s.id === openSeasonId &&
                        isPaidSeason && (
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
        )}

        {/* Sessions */}
        {currentTabKey === 'sessions' && (
          <View style={styles.tabContent}>
            {!openSeason ? (
              <Section title={t('leagueDetail.sessions.title')} colors={colors}>
                <View style={styles.participantEmpty}>
                  <Text size="sm" color={colors.textMuted} style={styles.sessionEmptyText}>
                    {t('leagueDetail.sessions.needOpenSeason')}
                  </Text>
                </View>
              </Section>
            ) : (
              <>
                <Section title={t('leagueDetail.sessions.title')} colors={colors}>
                  {seasonSessions.length === 0 ? (
                    <View style={styles.participantEmpty}>
                      <Text size="sm" color={colors.textMuted}>
                        {t('leagueDetail.sessions.empty')}
                      </Text>
                    </View>
                  ) : (
                    seasonSessions.map(s => {
                      const pill = sessionPill(s.status);
                      return (
                        <TouchableOpacity
                          key={s.id}
                          onPress={() => handleOpenSession(s.id, s.name)}
                          activeOpacity={0.7}
                          style={[styles.seasonRow, { borderBottomColor: colors.border }]}
                          testID={`session-row-${s.id}`}
                        >
                          <View style={styles.seasonRowMain}>
                            <Text size="base" weight="semibold" color={colors.text}>
                              {s.name}
                            </Text>
                            <Text size="xs" color={colors.textMuted}>
                              {formatDateTime(s.scheduled_at)}
                            </Text>
                          </View>
                          <View style={styles.seasonRowActions}>
                            <View style={[styles.seasonStatusPill, { backgroundColor: pill.bg }]}>
                              <Text size="xs" weight="semibold" color={pill.fg}>
                                {t(SESSION_STATUS_KEY[s.status] as TranslationKey)}
                              </Text>
                            </View>
                            {isOrganizer && s.status === 'draft' && (
                              <TouchableOpacity
                                onPress={() => handlePublishSession(s.id, s.version)}
                                disabled={isPublishingSession}
                                testID="cta-publish-session"
                                style={[styles.seasonActionButton, { borderColor: colors.primary }]}
                              >
                                <Text size="sm" weight="semibold" color={colors.primary}>
                                  {t('leagueDetail.sessions.publish')}
                                </Text>
                              </TouchableOpacity>
                            )}
                            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </Section>

                {isOrganizer && (
                  <TouchableOpacity
                    onPress={handleOpenCreateSession}
                    style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                    testID="cta-create-session"
                  >
                    <Ionicons name="add-outline" size={20} color="#ffffff" />
                    <Text size="base" weight="semibold" color="#ffffff">
                      {t('leagueDetail.sessions.submit')}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}

        {/* Details */}
        {currentTabKey === 'details' && (
          <View style={styles.tabContent}>
            {league.description?.trim() ? (
              <LabeledBlock
                label={t('leagueDetail.labels.description')}
                value={league.description}
                colors={colors}
              />
            ) : null}

            <Section title={t('leagueDetail.tabs.details')} colors={colors}>
              <InfoRow
                label={t('leagueDetail.labels.visibility')}
                value={t(VISIBILITY_KEY[league.visibility] as TranslationKey)}
                colors={colors}
              />
              <InfoRow
                label={t('leagueDetail.labels.joinMode')}
                value={t(JOIN_MODE_KEY[league.join_mode] as TranslationKey)}
                colors={colors}
              />
              {league.venue_name ? (
                <InfoRow
                  label={t('leagueDetail.labels.venue')}
                  value={league.venue_name}
                  colors={colors}
                />
              ) : null}
              {ratingRangeLabel && (
                <InfoRow
                  label={t('leagueDetail.labels.ratingRange')}
                  value={ratingRangeLabel}
                  colors={colors}
                />
              )}
            </Section>
          </View>
        )}
      </ScrollView>

      {/* Docked primary action — the one thing this viewer should do next, kept
          out of the scroll so it's reachable from any tab at any position. */}
      {primaryAction && (
        <View
          style={[
            styles.dockedBar,
            {
              backgroundColor: colors.cardBackground,
              borderTopColor: colors.border,
              paddingBottom: spacingPixels[3] + insets.bottom,
            },
          ]}
        >
          <TouchableOpacity
            onPress={primaryAction.onPress}
            disabled={primaryAction.disabled}
            activeOpacity={0.7}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary },
              primaryAction.disabled && styles.buttonDisabled,
            ]}
            accessibilityRole="button"
            testID={primaryAction.testID}
          >
            <Ionicons name={primaryAction.icon} size={20} color="#ffffff" />
            <Text size="base" weight="semibold" color="#ffffff">
              {primaryAction.label}
            </Text>
          </TouchableOpacity>
          {primaryAction.hint ? (
            <Text size="xs" color={colors.textMuted} numberOfLines={2} style={styles.dockedBarHint}>
              {primaryAction.hint}
            </Text>
          ) : null}
        </View>
      )}

      <ConfirmationModal
        visible={cancelSeasonTarget !== null}
        title={t('leagueDetail.seasonLifecycle.cancelConfirmTitle', {
          name: cancelSeasonTarget?.name ?? '',
        })}
        message={
          cancelSeasonTarget &&
          (cancelSeasonTarget.entry_fee_cents ?? 0) > 0 &&
          cancelSeasonTarget.status === 'open'
            ? cancelSeasonTarget.id === openSeasonId && (seasonEarnings?.paidCount ?? 0) > 0
              ? `${t('leagueDetail.seasonLifecycle.cancelConfirmBodyPaid')}\n\n${t(
                  'leagueDetail.seasonLifecycle.cancelAmounts'
                )
                  .replace('{count}', String(seasonEarnings?.paidCount ?? 0))
                  .replace(
                    '{amount}',
                    formatPrice(
                      seasonEarnings?.entryCents ?? 0,
                      seasonEarnings?.currency ?? 'CAD',
                      {
                        locale,
                      }
                    )
                  )}`
              : t('leagueDetail.seasonLifecycle.cancelConfirmBodyPaid')
            : t('leagueDetail.seasonLifecycle.cancelConfirmBody')
        }
        confirmLabel={t('leagueDetail.seasonLifecycle.cancelConfirm')}
        cancelLabel={t('leagueDetail.seasonLifecycle.keepSeason')}
        confirmTestID="confirm-cancel-season"
        destructive
        isLoading={isCancellingSeason}
        onClose={() => {
          setCancelSeasonTarget(null);
          setCancelSeasonReason('');
        }}
        onConfirm={() => {
          if (!cancelSeasonTarget) return;
          void cancelSeasonAsync({
            seasonId: cancelSeasonTarget.id,
            reason: cancelSeasonReason.trim() || null,
            versionWas: cancelSeasonTarget.version,
            leagueId,
          }).finally(() => setCancelSeasonTarget(null));
        }}
        extraContent={
          <TextInput
            style={[
              styles.seasonReasonInput,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            placeholder={t('leagueDetail.seasonLifecycle.cancelReasonPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={cancelSeasonReason}
            onChangeText={setCancelSeasonReason}
            multiline
            maxLength={300}
            editable={!isCancellingSeason}
            testID="season-cancel-reason"
          />
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  seasonReasonInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
    minHeight: 72,
    textAlignVertical: 'top',
  },
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  centeredText: { marginTop: spacingPixels[3], textAlign: 'center' },
  centeredSubtext: { marginTop: spacingPixels[2], textAlign: 'center' },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  heroFixed: {
    paddingBottom: spacingPixels[2],
  },
  heroBanner: {
    position: 'relative',
  },
  heroBannerTopRow: {
    position: 'absolute',
    top: spacingPixels[3],
    left: spacingPixels[4],
    right: spacingPixels[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
  },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[3],
    gap: spacingPixels[1],
  },
  scrimText: {
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  heroChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
  },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    flexShrink: 1,
  },
  heroTextAction: {
    paddingVertical: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[1],
  },
  screenScroll: { flex: 1 },
  screenScrollContent: { flexGrow: 1 },
  tabBarSticky: {
    paddingTop: spacingPixels[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBarContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
  },
  tabItem: {
    alignItems: 'center',
    paddingTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  tabUnderline: {
    alignSelf: 'stretch',
    height: 2,
    borderRadius: 1,
  },
  tabContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  playersTabContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  statusBadge: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  section: { marginBottom: spacingPixels[5] },
  sectionTitle: {
    marginBottom: spacingPixels[2],
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoRowLabel: {
    marginRight: spacingPixels[3],
  },
  infoRowValue: {
    flex: 1,
    textAlign: 'right',
  },
  stackedBlock: {
    padding: spacingPixels[4],
    gap: spacingPixels[1],
  },
  stackedValue: {
    lineHeight: 20,
  },
  stepperCard: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
  },
  lifecycleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
  },
  flex1: {
    flex: 1,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  stepperStep: {
    flex: 1,
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  stepperDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperConnector: {
    height: 2,
    flex: 0.4,
    marginTop: 13,
    borderRadius: 1,
  },
  ctaCard: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    gap: spacingPixels[4],
  },
  ctaCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
  },
  ctaCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaCardTextBlock: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  ctaCardDescription: { lineHeight: 19 },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    paddingVertical: spacingPixels[3],
  },
  statSegment: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacingPixels[2],
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  overviewActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3.5],
  },
  overviewActionLabel: {
    flex: 1,
  },
  overviewActionBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  overviewInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  overviewInfoIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewInfoTexts: {
    flex: 1,
    gap: 1,
  },
  overviewDescription: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  membersPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  membersPreviewAvatars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  membersPreviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  membersPreviewAvatarOverlap: {
    marginLeft: -10,
  },
  membersPreviewAvatarImg: {
    width: '100%',
    height: '100%',
  },
  dockedBar: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[3],
  },
  dockedBarHint: {
    textAlign: 'center',
    lineHeight: 16,
  },
  participantEmpty: {
    padding: spacingPixels[4],
    alignItems: 'center',
  },
  pendingSection: { marginBottom: spacingPixels[4] },
  queueBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingLeft: spacingPixels[14],
    paddingBottom: spacingPixels[2],
    marginTop: -spacingPixels[1],
  },
  segmentBar: {
    marginBottom: spacingPixels[4],
  },
  // Roster count sits inside the Section card, above the first row's divider.
  rosterCountLabel: {
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
    letterSpacing: 0.5,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
  },
  buttonDisabled: { opacity: 0.6 },
  inviteButton: {
    marginBottom: spacingPixels[3],
  },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seasonRowMain: { flex: 1, gap: spacingPixels[0.5] },
  seasonRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  seasonStatusPill: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  seasonActionButton: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
  },
  seasonCard: {
    padding: spacingPixels[4],
    gap: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seasonCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  seasonCardInfo: { flex: 1, gap: spacingPixels[0.5] },
  seasonCtaButton: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingVertical: spacingPixels[2.5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  seasonCancelAction: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2],
  },
  standingsSeasonBar: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
  },
  standingsSeasonChip: {
    borderWidth: 1,
    borderRadius: radiusPixels.full,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
  },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2.5],
  },
  standingHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  standingRank: { width: 28 },
  standingName: { flex: 1 },
  standingWl: { width: 56, textAlign: 'right' },
  standingPts: { width: 44, textAlign: 'right' },
  sessionEmptyText: {
    textAlign: 'center',
  },
});

export default LeagueDetail;
