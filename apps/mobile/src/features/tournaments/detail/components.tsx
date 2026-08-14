/**
 * Presentational pieces of the tournament detail screen: status chrome, the
 * lifecycle stepper, hero chips, the participant sections and the points
 * ladder, plus the label maps and helpers they share.
 *
 * Split out of TournamentDetail so the tab panes can live in their own files
 * and still reach the same building blocks.
 */

/**
 * TournamentDetail Screen
 *
 * Read-only summary plus organizer/registrant action affordances.
 *
 * V1: hero, format/schedule/visibility cards, "Coming soon" placeholder.
 * V2: open/close registration (organizer), self-register/withdraw
 *     (registrant), registrations count.
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V1, §V2
 */

import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { primary, accent, neutral, secondary, duration } from '@rallia/design-system';
import { getHumanName, tournamentPointsLadder } from '@rallia/shared-utils';
import type { Enums } from '@rallia/shared-types';
import type { PlayerSearchResult } from '@rallia/shared-services';
import type { TournamentPlacement } from '@rallia/shared-utils';

import { type TranslationKey } from '../../../hooks';
import { EventDetailSkeleton } from '../../../features/events/components/EventDetailChrome';
import ParticipantRow from '../../../components/ParticipantRow';
import { styles } from './detailStyles';
import { TOURNAMENT_BANNER_ASPECT } from '../components/TournamentBanner';

export type TabKey = 'overview' | 'bracket' | 'players' | 'points' | 'rules' | 'details';
/** Players-tab status segments (pill tabs). */
export type PlayersSegment = 'confirmed' | 'requests' | 'invited';

export type Status = Enums<'tournament_status'>;
export type Visibility = Enums<'tournament_visibility'>;
export type RegistrationMode = Enums<'tournament_registration_mode'>;
export type BracketType = Enums<'bracket_type'>;
export type EntryFormat = Enums<'entry_format'>;
export type MatchFormat = Enums<'match_format'>;

export const VISIBILITY_LABEL_KEY: Record<Visibility, string> = {
  private: 'tournamentDetail.values.private',
  public: 'tournamentDetail.values.public',
  community: 'tournamentDetail.values.community',
};
export const REG_MODE_LABEL_KEY: Record<RegistrationMode, string> = {
  open: 'tournamentDetail.values.open',
  approval: 'tournamentDetail.values.approval',
  invite_only: 'tournamentDetail.values.inviteOnly',
};
export const BRACKET_TYPE_LABEL_KEY: Record<BracketType, string> = {
  single_elimination: 'tournamentDetail.values.singleElimination',
  double_elimination: 'tournamentDetail.values.doubleElimination',
  pool_knockout: 'tournamentDetail.values.poolKnockout',
};
export const ENTRY_FORMAT_LABEL_KEY: Record<EntryFormat, string> = {
  singles: 'tournamentDetail.values.singles',
  doubles: 'tournamentDetail.values.doubles',
  mixed_doubles: 'tournamentDetail.values.mixedDoubles',
};
export const MATCH_FORMAT_LABEL_KEY: Record<MatchFormat, string> = {
  one_set: 'tournamentDetail.values.oneSet',
  two_of_three: 'tournamentDetail.values.twoOfThree',
  three_of_five: 'tournamentDetail.values.threeOfFive',
  pickleball_to_11: 'tournamentDetail.values.pickleballTo11',
  pickleball_to_15: 'tournamentDetail.values.pickleballTo15',
  pickleball_to_21: 'tournamentDetail.values.pickleballTo21',
};

export const STATUS_TONE: Record<Status, 'neutral' | 'positive' | 'active' | 'muted'> = {
  draft: 'neutral',
  registration_open: 'positive',
  registration_closed: 'neutral',
  in_progress: 'active',
  completed: 'muted',
  cancelled: 'muted',
  archived: 'muted',
};

// Error codes from lt-create-registration-payment. The entry rules (rating,
// partner, removal) are enforced before any charge, so these all mean "refused,
// not billed" and reuse the same wording as the free register path.
export const PAID_REGISTER_ERROR_KEYS: Record<string, TranslationKey> = {
  tournament_full: 'tournamentDetail.payments.errors.full',
  already_registered: 'tournamentDetail.payments.errors.alreadyRegistered',
  organizer_not_ready: 'tournamentDetail.payments.errors.organizerNotReady',
  tournament_reg_closed: 'tournamentDetail.payments.errors.closed',
  // Reachable when a share-link holder tries to pay into a paid invite_only
  // draw: begin_paid_registration only admits open mode or a standing invite.
  paid_mode_unsupported: 'tournamentDetail.errors.notInvited',
  registration_removed: 'tournamentDetail.errors.registrationRemoved',
  rating_required: 'tournamentDetail.errors.ratingRequired',
  rating_too_low: 'tournamentDetail.errors.ratingTooLow',
  rating_too_high: 'tournamentDetail.errors.ratingTooHigh',
  partner_required: 'tournamentDetail.errors.partnerRequired',
  partner_not_allowed: 'tournamentDetail.errors.partnerInvalid',
  partner_invalid: 'tournamentDetail.errors.partnerInvalid',
  partner_sport_mismatch: 'tournamentDetail.errors.partnerSportMismatch',
  partner_already_registered: 'tournamentDetail.errors.partnerAlreadyRegistered',
  partner_rating_required: 'tournamentDetail.errors.partnerRatingRequired',
  partner_rating_too_low: 'tournamentDetail.errors.partnerRatingTooLow',
  partner_rating_too_high: 'tournamentDetail.errors.partnerRatingTooHigh',
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
  cancelledBg: string;
  cancelledBorder: string;
  cancelledText: string;
  highlightBg: string;
  highlightBorder: string;
  secondaryHighlightBg: string;
  secondaryHighlightBorder: string;
  secondaryAccent: string;
  secondaryAccentBg: string;
  championBg: string;
  championText: string;
  danger: string;
  dangerBg: string;
}

// =============================================================================

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

/** Full-width label-over-value row, for values too long to sit in the right
 *  column of an InfoRow (e.g. the refund-policy sentence). */
export const StackedRow: React.FC<{ label: string; value: string; colors: ScreenColors }> = ({
  label,
  value,
  colors,
}) => (
  <View style={[styles.stackedRow, { borderBottomColor: colors.border }]}>
    <Text size="sm" color={colors.textMuted}>
      {label}
    </Text>
    <Text size="base" weight="semibold" color={colors.text} style={styles.stackedValue}>
      {value}
    </Text>
  </View>
);

/** Standalone card holding a single soft "label over full-width value" block,
 *  the same treatment as the refund StackedRow — for the free-text fields
 *  (description, venue, rules) that shouldn't sit in a cramped right column. */
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

/** Initial-load placeholder mirroring the loaded Overview 1:1 — banner with the
 *  scrim identity lines, sticky-tab geometry, then the stats, stepper and event
 *  info cards — sharing the real StyleSheet so nothing jumps when data lands. */
export const TournamentDetailSkeleton: React.FC = () => (
  <EventDetailSkeleton bannerAspect={TOURNAMENT_BANNER_ASPECT} />
);

export const PLACEMENT_ICON: Record<TournamentPlacement, keyof typeof Ionicons.glyphMap> = {
  champion: 'trophy',
  finalist: 'medal-outline',
  semifinal: 'ribbon-outline',
  quarterfinal: 'flash-outline',
  round_of_16: 'arrow-up-circle-outline',
  round_of_32: 'arrow-up-circle-outline',
  round_of_64: 'arrow-up-circle-outline',
  participated: 'checkmark-circle-outline',
};

/**
 * Circuit Rallia points explainer: what each finish is worth on this specific
 * tournament. Numbers come from the shared ladder helper, which mirrors the
 * award function exactly — never recompute the scale here.
 */
export const PointsTab: React.FC<{
  ladder: NonNullable<ReturnType<typeof tournamentPointsLadder>>;
  isDoubles: boolean;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ ladder, isDoubles, colors, t }) => {
  const { projected, rows } = ladder;
  const champion = rows[0];

  return (
    <View style={styles.tabContent}>
      {/* Headline: the number a player is actually competing for */}
      <View
        style={[
          styles.section,
          styles.pointsHero,
          { backgroundColor: colors.championBg, borderColor: colors.championText },
        ]}
      >
        <View style={[styles.pointsHeroIcon, { backgroundColor: colors.championText }]}>
          <Ionicons name="trophy" size={22} color={accent[900]} />
        </View>
        <Text size="xs" weight="semibold" color={colors.championText}>
          {t('tournamentDetail.points.eligibleLabel')}
        </Text>
        <View style={styles.pointsHeroValueRow}>
          {projected ? (
            <Text size="sm" weight="medium" color={colors.textMuted}>
              {t('tournamentDetail.points.upTo')}
            </Text>
          ) : null}
          {/* lineHeight is explicit: Text defaults to the body variant's fixed
              24px box, which clips ascenders at 3xl (30px). */}
          <Text size="3xl" weight="bold" lineHeight="tight" color={colors.championText}>
            {champion.points}
          </Text>
          <Text size="sm" weight="medium" color={colors.textMuted}>
            {t('tournamentDetail.points.unit')}
          </Text>
        </View>
        <Text size="sm" color={colors.textMuted} style={styles.pointsHeroCaption}>
          {t('tournamentDetail.points.heroCaption')}
        </Text>
      </View>

      {/* The ladder */}
      <Section title={t('tournamentDetail.points.tableTitle')} colors={colors}>
        {rows.map((row, i) => (
          <View
            key={row.placement}
            style={[
              styles.pointsRow,
              { borderBottomColor: colors.border },
              i === rows.length - 1 && styles.pointsRowLast,
            ]}
          >
            <View
              style={[
                styles.pointsRowIcon,
                {
                  backgroundColor:
                    row.placement === 'champion' ? colors.championBg : colors.statusMutedBg,
                },
              ]}
            >
              <Ionicons
                name={PLACEMENT_ICON[row.placement]}
                size={16}
                color={row.placement === 'champion' ? colors.championText : colors.textMuted}
              />
            </View>
            <Text
              size="base"
              weight={row.placement === 'champion' ? 'semibold' : 'medium'}
              color={colors.text}
              style={styles.pointsRowLabel}
            >
              {t(`tournamentDetail.points.placement.${row.placement}`)}
            </Text>
            <Text
              size="base"
              weight="bold"
              color={row.placement === 'champion' ? colors.championText : colors.text}
              style={styles.pointsRowValue}
            >
              {row.points}
            </Text>
          </View>
        ))}
      </Section>

      {/* How the number is set, and the rules that bite */}
      <Section title={t('tournamentDetail.points.howTitle')} colors={colors}>
        {[
          projected
            ? 'tournamentDetail.points.notes.projected'
            : 'tournamentDetail.points.notes.firm',
          'tournamentDetail.points.notes.scale',
          'tournamentDetail.points.notes.zeroWinFloor',
          ...(isDoubles ? ['tournamentDetail.points.notes.doubles'] : []),
          'tournamentDetail.points.notes.season',
        ].map((key, i, arr) => (
          <View
            key={key}
            style={[
              styles.pointsNoteRow,
              { borderBottomColor: colors.border },
              i === arr.length - 1 && styles.pointsRowLast,
            ]}
          >
            <View style={[styles.ruleDot, { backgroundColor: colors.primary }]} />
            <Text size="sm" color={colors.text} style={styles.ruleText}>
              {t(key as TranslationKey)}
            </Text>
          </View>
        ))}
      </Section>
    </View>
  );
};

/** Fallback label for a bracket slot whose player has no resolvable name yet. */
export function seedFallbackLabel(
  seed: number | undefined,
  t: (k: TranslationKey) => string
): string {
  return t('tournamentDetail.bracket.seed').replace('{n}', seed !== undefined ? String(seed) : '?');
}

/** Player-facing level requirement, e.g. "3.0+", "≤ 4.5", "3.0–4.5".
 *  Mirrors the tournament-card formatting so display stays consistent. */
export function formatRatingRange(min: number | null, max: number | null): string | null {
  const fmt = (v: number) => Number(v).toFixed(1);
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `≤ ${fmt(max)}`;
  return null;
}

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

// Fixed light-tone text colors for badges sitting on the hero banner: the pill
// background is near-white there regardless of theme.
export const ON_IMAGE_TONE_TEXT: Record<'neutral' | 'positive' | 'active' | 'muted', string> = {
  positive: '#15803d',
  active: primary[700],
  neutral: neutral[700],
  muted: neutral[500],
};

export const StatusBadge: React.FC<{
  status: Status;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
  onImage?: boolean;
}> = ({ status, colors, t, onImage }) => {
  const tone = STATUS_TONE[status];
  const bg = onImage
    ? 'rgba(255,255,255,0.94)'
    : tone === 'positive'
      ? colors.statusPositiveBg
      : tone === 'active'
        ? colors.statusActiveBg
        : tone === 'muted'
          ? colors.statusMutedBg
          : colors.statusNeutralBg;
  const fg = onImage
    ? ON_IMAGE_TONE_TEXT[tone]
    : tone === 'positive'
      ? colors.statusPositiveText
      : tone === 'active'
        ? colors.statusActiveText
        : tone === 'muted'
          ? colors.statusMutedText
          : colors.statusNeutralText;
  return (
    <View style={[styles.statusBadge, { backgroundColor: bg }]}>
      <Text size="xs" weight="semibold" color={fg}>
        {t(`tournamentDetail.status.${status}`)}
      </Text>
    </View>
  );
};

/**
 * Live "in progress" chip with a pulsing dot, mirroring the ongoing-match
 * indicator in MatchCard (coral/red `secondary` palette, expanding ring +
 * core glow).
 */
export const LiveBadge: React.FC<{ label: string; isDark: boolean; onImage?: boolean }> = ({
  label,
  isDark,
  onImage,
}) => {
  const pulse = useRef(new Animated.Value(0)).current;
  // On the banner the pill is near-white in both themes, so the dot and label
  // take the darker coral that reads against it.
  const liveColor = onImage ? secondary[600] : isDark ? secondary[400] : secondary[500];

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: duration.extraSlow,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: duration.extraSlow,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.6, 0.3, 0] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.7, 1] });

  return (
    <View
      style={[
        styles.liveBadge,
        {
          backgroundColor: onImage
            ? 'rgba(255,255,255,0.94)'
            : `${secondary[500]}${isDark ? '30' : '1f'}`,
        },
      ]}
    >
      <View style={styles.liveIndicatorContainer}>
        <Animated.View
          style={[
            styles.liveRing,
            { backgroundColor: liveColor, transform: [{ scale: ringScale }], opacity: ringOpacity },
          ]}
        />
        <Animated.View
          style={[styles.liveDot, { backgroundColor: liveColor, opacity: dotOpacity }]}
        />
      </View>
      <Text size="xs" weight="bold" color={liveColor}>
        {label}
      </Text>
    </View>
  );
};

// =============================================================================
// DASHBOARD COMPONENTS
// =============================================================================

export const STEP_ICONS: ReadonlyArray<keyof typeof Ionicons.glyphMap> = [
  'create-outline',
  'people-outline',
  'git-network-outline',
  'trophy-outline',
];

/** Draft → Registration → Play → Done lifecycle pipeline. */
export const LifecycleStepper: React.FC<{
  stepIndex: number;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
}> = ({ stepIndex, colors, t }) => {
  const labels = [
    t('tournamentDetail.dashboard.steps.draft'),
    t('tournamentDetail.dashboard.steps.registration'),
    t('tournamentDetail.dashboard.steps.play'),
    t('tournamentDetail.dashboard.steps.done'),
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

/** One column of the segmented stats card. The card draws the single border;
 *  segments stay flat with hairline dividers between them, mirroring the
 *  Players empty-state stats strip. */
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
 * Primary-tinted callout used as the organizer's "what's next" card and the
 * participant's register CTA: icon circle, title, description, optional CTA.
 */
export const DashboardCtaCard: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  buttonLabel?: string;
  buttonIcon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  disabled?: boolean;
  /** Coral "leave" tone (plain card + coral button) — used for withdraw. */
  destructive?: boolean;
  /** Primary (default) or secondary palette for card tint and CTA button. */
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
  destructive,
  accent = 'primary',
  colors,
  testID,
}) => {
  const cardBg = destructive
    ? colors.cardBackground
    : accent === 'secondary'
      ? colors.secondaryHighlightBg
      : colors.highlightBg;
  const cardBorder = destructive
    ? colors.border
    : accent === 'secondary'
      ? colors.secondaryHighlightBorder
      : colors.highlightBorder;
  const iconBg = destructive
    ? colors.dangerBg
    : accent === 'secondary'
      ? colors.secondaryAccentBg
      : colors.statusActiveBg;
  const iconColor = destructive
    ? colors.danger
    : accent === 'secondary'
      ? colors.secondaryAccent
      : colors.primary;
  const buttonBg = destructive
    ? colors.danger
    : accent === 'secondary'
      ? colors.secondaryAccent
      : colors.primary;

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

/**
 * Compact status chip sitting in the row under the hero banner. Replaces the
 * full-width registered band / chat button / ranking banner stack — same
 * information, one row instead of three blocks.
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
 * Quiet grouped row for the organizer's utility actions (invite, payouts, edit,
 * co-organizers). Deliberately lower-contrast than DashboardCtaCard so the one
 * accent card and the docked bar stay the loudest things on the screen.
 */
export const OverviewActionRow: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  colors: ScreenColors;
  onPress: () => void;
  badge?: { label: string; tone: 'positive' | 'warning' | 'muted' };
  showDivider?: boolean;
  testID?: string;
}> = ({ icon, label, colors, onPress, badge, showDivider, testID }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    testID={testID}
    accessibilityRole="button"
    style={[
      styles.overviewActionRow,
      showDivider && {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      },
    ]}
  >
    <Ionicons name={icon} size={18} color={colors.primary} />
    <Text size="sm" weight="medium" color={colors.text} style={styles.overviewActionLabel}>
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
                  ? colors.cancelledBg
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
                ? colors.cancelledText
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

/** One-line, player-facing summary of a tournament's refund policy. Shared by
 *  the register CTA and the pre-payment confirmation so the wording can't drift. */
export function refundPolicyLine(
  feeQuote:
    | {
        refundPolicyKind: string;
        refundPartialBps: number | null;
        refundCutoffAt: string | null;
      }
    | null
    | undefined,
  t: (k: TranslationKey) => string,
  locale: string
): string | null {
  if (!feeQuote) return null;
  const cutoff = feeQuote.refundCutoffAt
    ? new Date(feeQuote.refundCutoffAt).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;
  if (feeQuote.refundPolicyKind === 'none') return t('tournamentDetail.payments.refundNone');
  if (feeQuote.refundPolicyKind === 'full')
    return cutoff
      ? t('tournamentDetail.payments.refundFullUntil').replace('{date}', cutoff)
      : t('tournamentDetail.payments.refundFull');
  const pct = String(Math.round((feeQuote.refundPartialBps ?? 0) / 100));
  return cutoff
    ? t('tournamentDetail.payments.refundPartialUntil')
        .replace('{pct}', pct)
        .replace('{date}', cutoff)
    : t('tournamentDetail.payments.refundPartial').replace('{pct}', pct);
}

/** Registered players as compact rows inside a Section-style card.
 *  onRemovePress is set only when the caller may remove registrants
 *  (organizer, pre-bracket); the organizer's own row never shows it. */
export const ParticipantsSection: React.FC<{
  players: PlayerSearchResult[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onRemovePress?: (player: PlayerSearchResult) => void;
  currentUserId?: string;
  /** Draw capacity, surfaced in the empty state so a bare roster still says
   *  how big the event is. */
  maxParticipants: number;
  /** Pre-formatted registration deadline, or null when there's none to show. */
  deadlineLabel?: string | null;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({
  players,
  onPlayerPress,
  onRemovePress,
  currentUserId,
  maxParticipants,
  deadlineLabel,
  colors,
  t,
}) => {
  return (
    <View>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {players.length === 0 ? (
          <View style={styles.participantEmpty}>
            <View style={[styles.participantEmptyDisc, { backgroundColor: colors.statusActiveBg }]}>
              <Ionicons name="people-outline" size={34} color={colors.primary} />
            </View>
            <Text size="base" weight="semibold" color={colors.text}>
              {t('tournamentDetail.dashboard.participants.empty')}
            </Text>
            <Text size="sm" color={colors.textMuted} style={styles.participantEmptyText}>
              {t('tournamentDetail.dashboard.participants.emptyDescription')}
            </Text>
            <View style={[styles.participantEmptyStats, { borderTopColor: colors.border }]}>
              <View style={styles.participantEmptyStat}>
                <Text size="base" weight="bold" color={colors.text}>
                  {maxParticipants}
                </Text>
                <Text size="xs" color={colors.textMuted}>
                  {t('tournamentDetail.dashboard.participants.emptySpotsLabel')}
                </Text>
              </View>
              {deadlineLabel ? (
                <>
                  <View
                    style={[styles.participantEmptyStatDivider, { backgroundColor: colors.border }]}
                  />
                  <View style={styles.participantEmptyStat}>
                    <Text size="base" weight="bold" color={colors.text} numberOfLines={1}>
                      {deadlineLabel}
                    </Text>
                    <Text size="xs" color={colors.textMuted}>
                      {t('tournamentDetail.dashboard.participants.emptyDeadlineLabel')}
                    </Text>
                  </View>
                </>
              ) : null}
            </View>
          </View>
        ) : (
          players.map((player, i) => (
            <ParticipantRow
              key={player.id}
              player={player}
              onPress={onPlayerPress}
              colors={colors}
              showDivider={i > 0}
              trailingActions={
                onRemovePress && player.id !== currentUserId
                  ? [
                      {
                        icon: 'person-remove-outline',
                        accessibilityLabel: t(
                          'tournamentDetail.dashboard.participants.removeLabel',
                          { name: getHumanName(player, '') }
                        ),
                        onPress: onRemovePress,
                      },
                    ]
                  : undefined
              }
            />
          ))
        )}
      </View>
    </View>
  );
};

export type PendingRequestRow = {
  player: PlayerSearchResult;
  registrationId: string;
  version: number;
};

/** Organizer-only approval queue (approval-mode tournaments, pre-bracket).
 *  One row per pending registration with Approve / Decline actions.
 *  Display data is reused from the enriched participants list; the registration
 *  row supplies id + version for the optimistic-locked RPCs. */
export const PendingRequestsSection: React.FC<{
  rows: PendingRequestRow[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onApprove: (registrationId: string, version: number) => void;
  onDecline: (player: PlayerSearchResult) => void;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, onPlayerPress, onApprove, onDecline, colors, t }) => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.pendingSection}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {rows.map(({ player, registrationId, version }, i) => (
          <ParticipantRow
            key={registrationId}
            player={player}
            onPress={onPlayerPress}
            colors={colors}
            showDivider={i > 0}
            trailingActions={[
              {
                icon: 'checkmark-circle',
                color: colors.statusPositiveText,
                accessibilityLabel: t('tournamentDetail.dashboard.pendingRequests.approveLabel', {
                  name: getHumanName(player, ''),
                }),
                onPress: () => onApprove(registrationId, version),
              },
              {
                icon: 'close-circle',
                color: colors.danger,
                accessibilityLabel: t('tournamentDetail.dashboard.pendingRequests.declineLabel', {
                  name: getHumanName(player, ''),
                }),
                onPress: () => onDecline(player),
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

/** Organizer-only, read-only list of players the organizer invited who haven't
 *  accepted yet. Distinct from the approval queue — these await the invitee. */
export const InvitedSection: React.FC<{
  rows: PendingRequestRow[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onRevoke: (row: PendingRequestRow) => void;
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
        {rows.map((row, i) => (
          <ParticipantRow
            key={row.registrationId}
            player={row.player}
            onPress={onPlayerPress}
            colors={colors}
            showDivider={i > 0}
            trailingActions={[
              {
                icon: 'close-circle',
                color: colors.danger,
                accessibilityLabel: t('tournamentDetail.dashboard.invited.revokeLabel', {
                  name: getHumanName(row.player, ''),
                }),
                onPress: () => onRevoke(row),
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

// =============================================================================
