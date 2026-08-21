/**
 * Presentational pieces of the league detail screen: status chrome, the
 * lifecycle stepper, hero chips and the member sections, plus the label maps,
 * refund helpers and error-key tables they share.
 *
 * Split out of LeagueDetail so the tab panes can live in their own files and
 * still reach the same building blocks.
 */

/**
 * LeagueDetail Screen
 *
 * Read-only summary plus organizer/member action affordances (V6 slice).
 * UI aligned with TournamentDetail: hero, sticky tabs, dashboard CTAs.
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V6
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral } from '@rallia/design-system';
import { getHumanName } from '@rallia/shared-utils';
import type {
  PlayerProfile,
  PlayerRatingReputation,
  PlayerSearchResult,
} from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import ParticipantRow from '../../../components/ParticipantRow';
import { EventDetailSkeleton } from '../../../features/events/components/EventDetailChrome';
import { styles } from './detailStyles';
import { LEAGUE_BANNER_ASPECT } from '../components/LeagueBanner';
import { type TranslationKey } from '../../../hooks';
import { type RpcErrorOverrides } from '../../../utils/rpcErrorMessage';

export type LeagueStatus = Enums<'league_status'>;
/** Members-tab status segments (pill tabs). */
export type MembersSegment = 'confirmed' | 'requests' | 'invited' | 'suspended';
export type JoinMode = Enums<'tournament_registration_mode'>;
export type Visibility = Enums<'tournament_visibility'>;
export type SeasonStatus = Enums<'season_status'>;
export type SessionStatus = Enums<'session_status'>;

export const JOIN_MODE_KEY: Record<JoinMode, string> = {
  open: 'leagueDetail.values.open',
  approval: 'leagueDetail.values.approval',
  invite_only: 'leagueDetail.values.inviteOnly',
};
export const VISIBILITY_KEY: Record<Visibility, string> = {
  private: 'leagueDetail.values.private',
  public: 'leagueDetail.values.public',
  community: 'leagueDetail.values.community',
};
/** Scoring labels for the rules card. The fused pickleball values are legacy:
 *  nothing writes them since the games/points split, but old rows carry them. */
export const MATCH_FORMAT_KEY: Record<string, string> = {
  one_set: 'leagueDetail.values.oneSet',
  two_of_three: 'leagueDetail.values.twoOfThree',
  three_of_five: 'leagueDetail.values.threeOfFive',
  pickleball_to_11: 'leagueDetail.values.twoOfThree',
  pickleball_to_15: 'leagueDetail.values.twoOfThree',
  pickleball_to_21: 'leagueDetail.values.twoOfThree',
};

/** The subset of the rules jsonb the client reads. */
export type LeagueRulesSummary = {
  matchFormat?: string;
  pointWin?: number;
  pointLoss?: number;
  pointBye?: number;
  pointPerSetWon?: number;
  pointPerGameWon?: number;
  gamesPerPlayer?: number;
  sessionScheduling?: string;
};

export function readRules(value: unknown): LeagueRulesSummary {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as LeagueRulesSummary)
    : {};
}

/**
 * When a session is played, in one line. A fixed session is an evening, so it
 * reads as a date, a time and a length. A flex session is a window that can run
 * for weeks, where the time of day means nothing, so it reads as a date range.
 */
export function formatSessionWhen(
  session: {
    scheduled_at: string;
    play_window_ends_at?: string | null;
    duration_minutes?: number | null;
  },
  locale: string,
  t: (k: TranslationKey, options?: Record<string, string | number | boolean>) => string
): string {
  const start = new Date(session.scheduled_at);
  if (!session.play_window_ends_at) {
    const when = start.toLocaleString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return session.duration_minutes ? `${when} · ${session.duration_minutes} min` : when;
  }
  const day = (d: Date): string => d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return t('leagueDetail.sessions.window.range', {
    from: day(start),
    to: day(new Date(session.play_window_ends_at)),
  });
}

export const LEAGUE_STATUS_KEY: Record<LeagueStatus, string> = {
  active: 'leagueDetail.status.active',
  paused: 'leagueDetail.status.paused',
  closed: 'leagueDetail.status.closed',
};
export const LEAGUE_STATUS_TONE: Record<LeagueStatus, 'positive' | 'neutral' | 'muted'> = {
  active: 'positive',
  paused: 'neutral',
  closed: 'muted',
};
export const SEASON_STATUS_KEY: Record<SeasonStatus, string> = {
  draft: 'leagueDetail.seasonStatus.draft',
  open: 'leagueDetail.seasonStatus.open',
  closed: 'leagueDetail.seasonStatus.closed',
  cancelled: 'leagueDetail.seasonStatus.cancelled',
};
export const SESSION_STATUS_KEY: Record<SessionStatus, string> = {
  draft: 'leagueDetail.sessionStatus.draft',
  published: 'leagueDetail.sessionStatus.published',
  in_progress: 'leagueDetail.sessionStatus.inProgress',
  completed: 'leagueDetail.sessionStatus.completed',
  cancelled: 'leagueDetail.sessionStatus.cancelled',
};

/** One-line, player-facing summary of a season's refund policy. Shared by the
 *  enroll CTA and the pre-payment confirmation so the wording can't drift. */
export function seasonRefundPolicyLine(
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
export function estimateSeasonRefundCents(
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
export function seasonRefundZeroReason(
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
export const SEASON_ERROR_KEYS: RpcErrorOverrides = {
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
export const JOIN_ERROR_KEYS: RpcErrorOverrides = {
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

export const JOIN_VIA_INVITE_ERROR_KEYS: RpcErrorOverrides = {
  ...JOIN_ERROR_KEYS,
  INVITE_INVALID: 'leagueDetail.joinErrors.inviteInvalid',
  SHARING_NOT_AVAILABLE: 'leagueDetail.joinErrors.inviteInvalid',
};

export interface ScreenColors {
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

export const InfoRow: React.FC<{ label: string; value: string; colors: ScreenColors }> = ({
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
export const LabeledBlock: React.FC<{
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

export const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  colors: ScreenColors;
}> = ({ title, children, colors }) => (
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
export const ON_IMAGE_TONE_TEXT: Record<'positive' | 'neutral' | 'muted', string> = {
  positive: '#15803d',
  neutral: neutral[700],
  muted: neutral[500],
};

export const LeagueStatusBadge: React.FC<{
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

export function formatRatingRange(min: number | null, max: number | null): string | null {
  const fmt = (v: number) => Number(v).toFixed(1);
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `≤ ${fmt(max)}`;
  return null;
}

export const STEP_ICONS: ReadonlyArray<keyof typeof Ionicons.glyphMap> = [
  'create-outline',
  'calendar-outline',
  'tennisball-outline',
  'trophy-outline',
];

export const LifecycleStepper: React.FC<{
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
export const LeagueDetailSkeleton: React.FC = () => (
  <EventDetailSkeleton bannerAspect={LEAGUE_BANNER_ASPECT} />
);

export const StatSegment: React.FC<{
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
export const HeroChip: React.FC<{
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
export const OverviewActionRow: React.FC<{
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
export const OverviewInfoRow: React.FC<{
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

export const DashboardCtaCard: React.FC<{
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

export function memberToPlayer(
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

export type PendingMemberRow = {
  player: PlayerSearchResult;
  memberId: string;
  version: number;
  /** 1-based place in the league waitlist; absent for plain approval requests. */
  queueRank?: number;
};

export const PendingMembersSection: React.FC<{
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

export const InvitedMembersSection: React.FC<{
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

export type ManageMemberRow = {
  player: PlayerSearchResult;
  memberId: string;
  version: number;
  userId: string;
};

export const MembersSection: React.FC<{
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

export const SuspendedMembersSection: React.FC<{
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
