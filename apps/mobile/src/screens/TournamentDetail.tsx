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

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Platform,
  Pressable,
  TextInput,
  Image,
  Animated,
  Easing,
  Alert,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { SheetManager } from 'react-native-actions-sheet';
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
  accent,
  neutral,
  secondary,
  status,
  duration,
} from '@rallia/design-system';
import { useStripe } from '@stripe/stripe-react-native';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getHumanName,
  getProfilePictureUrl,
  formatPrice,
  tournamentRankingHeadline,
  tournamentPointsLadder,
} from '@rallia/shared-utils';
import type { TournamentPlacement } from '@rallia/shared-utils';
import {
  useTheme,
  useTournament,
  useTournamentRegistrations,
  useMyTournamentRegistration,
  useTournamentFeeQuote,
  useMyPayoutAccount,
  useCreateRegistrationPayment,
  useRefundRegistration,
  useOpenTournamentRegistration,
  useCloseTournamentRegistration,
  useReopenTournamentRegistration,
  useRegisterForTournament,
  useAcceptTournamentInvite,
  useRevokeTournamentInvite,
  useWithdrawFromTournament,
  useRemoveTournamentRegistration,
  useApproveTournamentRegistration,
  useTournamentInvitePreview,
  useJoinTournamentViaInvite,
  useTournamentMatches,
  useOpenTournamentRoundChat,
  useIsTournamentOrganizer,
  useIsCertifiedOrganizer,
  useCancelTournament,
  useArchiveTournament,
  useProfilesByIds,
  useTournamentParticipants,
  useSports,
  useAuth,
  tournamentKeys,
} from '@rallia/shared-hooks';
import { useQueryClient } from '@tanstack/react-query';
import type { Enums, Tables } from '@rallia/shared-types';
import * as WebBrowser from 'expo-web-browser';
import { getTournamentChat, TournamentPaymentError, supabase } from '@rallia/shared-services';
import type { PlayerSearchResult } from '@rallia/shared-services';

import { useTranslation, useThemeStyles, type TranslationKey } from '../hooks';
import * as Analytics from '../services/analytics';
import { useActionsSheet } from '../context';
import { ConfirmationModal } from '../components/ConfirmationModal';
import ParticipantRow from '../components/ParticipantRow';
import UnderlineTabBar, { type UnderlineTabItem } from '../components/UnderlineTabBar';
import { ChampionCard } from '../features/tournaments/components/ChampionCard';
import {
  TournamentBanner,
  TOURNAMENT_BANNER_ASPECT,
} from '../features/tournaments/components/TournamentBanner';
import type { RootStackParamList } from '../navigation';

type TournamentDetailRoute = RouteProp<RootStackParamList, 'TournamentDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type TabKey = 'overview' | 'bracket' | 'players' | 'points' | 'rules' | 'details';
/** Players-tab status segments (pill tabs). */
type PlayersSegment = 'confirmed' | 'requests' | 'invited';

type Status = Enums<'tournament_status'>;
type Visibility = Enums<'tournament_visibility'>;
type RegistrationMode = Enums<'tournament_registration_mode'>;
type BracketType = Enums<'bracket_type'>;
type EntryFormat = Enums<'entry_format'>;
type MatchFormat = Enums<'match_format'>;

const VISIBILITY_LABEL_KEY: Record<Visibility, string> = {
  private: 'tournamentDetail.values.private',
  public: 'tournamentDetail.values.public',
  community: 'tournamentDetail.values.community',
};
const REG_MODE_LABEL_KEY: Record<RegistrationMode, string> = {
  open: 'tournamentDetail.values.open',
  approval: 'tournamentDetail.values.approval',
  invite_only: 'tournamentDetail.values.inviteOnly',
};
const BRACKET_TYPE_LABEL_KEY: Record<BracketType, string> = {
  single_elimination: 'tournamentDetail.values.singleElimination',
  double_elimination: 'tournamentDetail.values.doubleElimination',
};
const ENTRY_FORMAT_LABEL_KEY: Record<EntryFormat, string> = {
  singles: 'tournamentDetail.values.singles',
  doubles: 'tournamentDetail.values.doubles',
  mixed_doubles: 'tournamentDetail.values.mixedDoubles',
};
const MATCH_FORMAT_LABEL_KEY: Record<MatchFormat, string> = {
  one_set: 'tournamentDetail.values.oneSet',
  two_of_three: 'tournamentDetail.values.twoOfThree',
  three_of_five: 'tournamentDetail.values.threeOfFive',
  pickleball_to_11: 'tournamentDetail.values.pickleballTo11',
  pickleball_to_15: 'tournamentDetail.values.pickleballTo15',
  pickleball_to_21: 'tournamentDetail.values.pickleballTo21',
};

const STATUS_TONE: Record<Status, 'neutral' | 'positive' | 'active' | 'muted'> = {
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
const PAID_REGISTER_ERROR_KEYS: Record<string, TranslationKey> = {
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

/** Full-width label-over-value row, for values too long to sit in the right
 *  column of an InfoRow (e.g. the refund-policy sentence). */
const StackedRow: React.FC<{ label: string; value: string; colors: ScreenColors }> = ({
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

/** Initial-load placeholder mirroring the loaded Overview 1:1 — banner with the
 *  scrim identity lines, sticky-tab geometry, then the stats, stepper and event
 *  info cards — sharing the real StyleSheet so nothing jumps when data lands. */
const TournamentDetailSkeleton: React.FC = () => {
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
            height={Math.round(width / TOURNAMENT_BANNER_ASPECT)}
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

        {/* Event info: icon-disc rows behind a section title */}
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

const PLACEMENT_ICON: Record<TournamentPlacement, keyof typeof Ionicons.glyphMap> = {
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
const PointsTab: React.FC<{
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
function seedFallbackLabel(seed: number | undefined, t: (k: TranslationKey) => string): string {
  return t('tournamentDetail.bracket.seed').replace('{n}', seed !== undefined ? String(seed) : '?');
}

/** Player-facing level requirement, e.g. "3.0+", "≤ 4.5", "3.0–4.5".
 *  Mirrors the tournament-card formatting so display stays consistent. */
function formatRatingRange(min: number | null, max: number | null): string | null {
  const fmt = (v: number) => Number(v).toFixed(1);
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `≤ ${fmt(max)}`;
  return null;
}

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

// Fixed light-tone text colors for badges sitting on the hero banner: the pill
// background is near-white there regardless of theme.
const ON_IMAGE_TONE_TEXT: Record<'neutral' | 'positive' | 'active' | 'muted', string> = {
  positive: '#15803d',
  active: primary[700],
  neutral: neutral[700],
  muted: neutral[500],
};

const StatusBadge: React.FC<{
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
const LiveBadge: React.FC<{ label: string; isDark: boolean; onImage?: boolean }> = ({
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

const STEP_ICONS: ReadonlyArray<keyof typeof Ionicons.glyphMap> = [
  'create-outline',
  'people-outline',
  'git-network-outline',
  'trophy-outline',
];

/** Draft → Registration → Play → Done lifecycle pipeline. */
const LifecycleStepper: React.FC<{
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
 * Primary-tinted callout used as the organizer's "what's next" card and the
 * participant's register CTA: icon circle, title, description, optional CTA.
 */
const DashboardCtaCard: React.FC<{
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
 * Quiet grouped row for the organizer's utility actions (invite, payouts, edit,
 * co-organizers). Deliberately lower-contrast than DashboardCtaCard so the one
 * accent card and the docked bar stay the loudest things on the screen.
 */
const OverviewActionRow: React.FC<{
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

/** One-line, player-facing summary of a tournament's refund policy. Shared by
 *  the register CTA and the pre-payment confirmation so the wording can't drift. */
function refundPolicyLine(
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
const ParticipantsSection: React.FC<{
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

type PendingRequestRow = {
  player: PlayerSearchResult;
  registrationId: string;
  version: number;
};

/** Organizer-only approval queue (approval-mode tournaments, pre-bracket).
 *  One row per pending registration with Approve / Decline actions.
 *  Display data is reused from the enriched participants list; the registration
 *  row supplies id + version for the optimistic-locked RPCs. */
const PendingRequestsSection: React.FC<{
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
const InvitedSection: React.FC<{
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

export const TournamentDetail: React.FC = () => {
  const { params } = useRoute<TournamentDetailRoute>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const toast = useToast();
  const isDark = theme === 'dark';
  const userId = session?.user?.id;

  const {
    data: directTournament,
    isLoading,
    isError,
    refetch,
  } = useTournament(params.tournamentId);
  const { data: registrations = [] } = useTournamentRegistrations(params.tournamentId);
  const { data: myRegistration } = useMyTournamentRegistration(params.tournamentId, userId);
  const { sports } = useSports();
  const { openSheetForTournamentEdit } = useActionsSheet();

  // Invite-token fallback: when the direct fetch comes back empty (private
  // tournament, caller not yet registered → RLS hides the row), a valid
  // token still renders the page via the preview RPC.
  const invitePreviewEnabled = !!params.inviteToken && !isLoading && !directTournament;
  const {
    data: invitePreview,
    isLoading: invitePreviewLoading,
    isError: inviteInvalid,
  } = useTournamentInvitePreview(params.inviteToken, invitePreviewEnabled);
  const tournament = directTournament ?? invitePreview?.tournament ?? null;

  const isPrimaryOrganizer = !!tournament && !!userId && tournament.organizer_id === userId;
  // Co-organizers share full organizer rights; resolved server-side. OR with the
  // sync primary check so the owner sees controls immediately (no query flicker).
  const { data: amIOrganizer } = useIsTournamentOrganizer(tournament?.id);
  const isOrganizer = isPrimaryOrganizer || !!amIOrganizer;
  // Only a certified organizer's tournament awards Circuit Rallia points.
  const { data: organizerIsCertified } = useIsCertifiedOrganizer(tournament?.organizer_id);
  const awardsRankingPoints = !!organizerIsCertified;
  const canManageCoOrganizers =
    isPrimaryOrganizer &&
    !!tournament &&
    tournament.status !== 'completed' &&
    tournament.status !== 'cancelled' &&
    tournament.status !== 'archived';
  const myActiveRegistration =
    myRegistration &&
    (myRegistration.status === 'registered' || myRegistration.status === 'pending')
      ? myRegistration
      : null;

  // Tournament chat (trigger-managed conversation). RLS only returns it to
  // participants, so an existing id doubles as the access check.
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const isChatMember = isOrganizer || myRegistration?.status === 'registered';
  useEffect(() => {
    let isMounted = true;
    if (!userId || !isChatMember) {
      setChatConversationId(null);
      return;
    }
    getTournamentChat(params.tournamentId).then(conversation => {
      if (isMounted) setChatConversationId(conversation?.id ?? null);
    });
    return () => {
      isMounted = false;
    };
  }, [params.tournamentId, userId, isChatMember]);

  const handleOpenChat = useCallback(() => {
    if (!chatConversationId || !tournament) return;
    lightHaptic();
    navigation.navigate('ChatConversation', {
      conversationId: chatConversationId,
      title: tournament.name,
    });
  }, [chatConversationId, tournament, navigation]);
  // RLS hides other players' registrations on private tournaments, so the
  // token preview supplies the count until the caller registers.
  //
  // activeCount = registered + pending (self-requests AND unaccepted invites).
  // It reflects reserved capacity, so it drives spotsLeft — the DB counts the
  // same set against max_participants, and showing pending slots as "free"
  // would let the register CTA offer spots the RPC then rejects.
  const activeCount = directTournament ? registrations.length : (invitePreview?.activeCount ?? 0);
  // registeredCount = confirmed entries only. Pending rows (approval requests
  // and unaccepted organizer invites) are neither in the Confirmed tab nor the
  // bracket, so they must not inflate any "registered / players in" display.
  // The private-tournament viewer can't see the breakdown; fall back to active.
  const registeredCount = directTournament
    ? registrations.filter(r => r.status === 'registered').length
    : (invitePreview?.activeCount ?? 0);

  const showError = useCallback(
    (errMsg: string, fallbackKey: TranslationKey) => {
      const lower = errMsg.toLowerCase();
      // Partner codes come first: partner_already_registered and
      // partner_sport_mismatch contain the bare codes as substrings.
      // paid_use_refund means the caller reached tournament_withdraw with a paid
      // entry. The UI routes those to the refund flow, so this is a safety net.
      const key: TranslationKey = lower.includes('paid_use_refund')
        ? 'tournamentDetail.errors.paidUseRefund'
        : lower.includes('partner_already_registered')
          ? 'tournamentDetail.errors.partnerAlreadyRegistered'
          : lower.includes('partner_sport_mismatch')
            ? 'tournamentDetail.errors.partnerSportMismatch'
            : lower.includes('partner_required')
              ? 'tournamentDetail.errors.partnerRequired'
              : lower.includes('partner_invalid') || lower.includes('partner_not_allowed')
                ? 'tournamentDetail.errors.partnerInvalid'
                : lower.includes('invite_invalid')
                  ? 'tournamentDetail.errors.inviteInvalid'
                  : lower.includes('sport_mismatch')
                    ? 'tournamentDetail.errors.sportMismatch'
                    : lower.includes('tournament_full')
                      ? 'tournamentDetail.errors.tournamentFull'
                      : lower.includes('already_registered')
                        ? 'tournamentDetail.errors.alreadyRegistered'
                        : lower.includes('not_invited')
                          ? 'tournamentDetail.errors.notInvited'
                          : lower.includes('optimistic_lock')
                            ? 'tournamentDetail.errors.lockConflict'
                            : lower.includes('start_passed')
                              ? 'tournamentDetail.errors.startPassed'
                              : lower.includes('withdraw_not_allowed')
                                ? 'tournamentDetail.errors.withdrawClosed'
                                : lower.includes('registration_removed')
                                  ? 'tournamentDetail.errors.registrationRemoved'
                                  : lower.includes('approve_not_allowed')
                                    ? 'tournamentDetail.errors.approveNotAllowed'
                                    : lower.includes('remove_not_allowed')
                                      ? 'tournamentDetail.errors.removeNotAllowed'
                                      : lower.includes('registration_not_found')
                                        ? 'tournamentDetail.errors.lockConflict'
                                        : lower.includes('tournament_reg_closed') ||
                                            lower.includes('reg_closed')
                                          ? 'tournamentDetail.errors.regClosed'
                                          : // partner_rating_* first: they contain the bare rating_* codes.
                                            lower.includes('partner_rating_too_low')
                                            ? 'tournamentDetail.errors.partnerRatingTooLow'
                                            : lower.includes('partner_rating_too_high')
                                              ? 'tournamentDetail.errors.partnerRatingTooHigh'
                                              : lower.includes('partner_rating_required')
                                                ? 'tournamentDetail.errors.partnerRatingRequired'
                                                : lower.includes('rating_too_low')
                                                  ? 'tournamentDetail.errors.ratingTooLow'
                                                  : lower.includes('rating_too_high')
                                                    ? 'tournamentDetail.errors.ratingTooHigh'
                                                    : lower.includes('rating_required')
                                                      ? 'tournamentDetail.errors.ratingRequired'
                                                      : fallbackKey;
      warningHaptic();
      toast.error(t(key));
    },
    [t, toast]
  );

  // Organizer payout onboarding: a card-capable Stripe Express account (manual
  // payouts) that becomes the settlement merchant for paid registrations.
  // Organizers must finish this before a paid event can open.
  const handleStripeOnboard = useCallback(
    async (businessType: 'individual' | 'company') => {
      try {
        const { data, error } = await supabase.functions.invoke('player-stripe-onboard', {
          body: { businessType },
        });
        if (error || !data?.url) throw new Error(error?.message);
        // The return URL must be the app's custom scheme, not an https URL:
        // ASWebAuthenticationSession only auto-dismisses on a custom-scheme
        // callback. Stripe's https return_url bounces to this scheme via the
        // web /stripe-connect-return page, which closes the modal.
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          'rallia://stripe-connect-return'
        );
        if (result.type === 'success') {
          // stripe-connect-webhook flips onboarding_completed once charges are
          // enabled; refetch to clear the organizer payout gate. It settles
          // asynchronously, so refetch again shortly after.
          successHaptic();
          void refetch();
          setTimeout(() => void refetch(), 2500);
        }
      } catch {
        warningHaptic();
        toast.error(t('tournamentDetail.payments.onboardingError'));
      }
    },
    [toast, t, refetch]
  );

  // Confirm, then kick off Stripe onboarding. Everyone onboards as an individual
  // for now — the club/business path is hidden here but still supported
  // server-side. Shared by the registration-guard error path and the payout card.
  const promptOnboardPayouts = useCallback(() => {
    Alert.alert(
      t('tournamentDetail.payments.payoutsSetupTitle'),
      t('tournamentDetail.payments.payoutsSetupBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.continue'),
          onPress: () => void handleStripeOnboard('individual'),
        },
      ]
    );
  }, [t, handleStripeOnboard]);

  const open = useOpenTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => {
      // Paid event without completed payout setup: prompt the organizer to
      // finish Stripe onboarding instead of a generic error.
      if (e.message.includes('PAYOUTS_SETUP_REQUIRED')) {
        warningHaptic();
        promptOnboardPayouts();
        return;
      }
      showError(e.message, 'tournamentDetail.errors.openFailed');
    },
  });
  const close = useCloseTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.closeFailed'),
  });
  const reopen = useReopenTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.reopenFailed'),
  });
  const register = useRegisterForTournament({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.registerFailed'),
  });
  const joinViaInvite = useJoinTournamentViaInvite({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.inviteLanding.joinedToast'));
      Analytics.tournamentInviteRedeemed({
        tournamentId: params.tournamentId,
        result: 'registered',
      });
    },
    onError: e => {
      Analytics.tournamentInviteRedeemed({
        tournamentId: params.tournamentId,
        result: 'error',
        errorCode: e.message,
      });
      showError(e.message, 'tournamentDetail.errors.registerFailed');
    },
  });
  const registerPending = register.isPending || joinViaInvite.isPending;

  // Paid-registration flow (Stripe PaymentSheet). isPaidTournament gates the
  // price display + the payment branch in onRegister.
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const isPaidTournament = (tournament?.entry_fee_cents ?? 0) > 0;
  const { data: feeQuote } = useTournamentFeeQuote(params.tournamentId, isPaidTournament);
  // Organizer payout status drives the manage/onboard card on paid events.
  const { data: payoutAccount } = useMyPayoutAccount(userId, isOrganizer && isPaidTournament);

  // Post-onboarding management: opens the Stripe Express dashboard (update bank
  // details, view payouts) when ready, or resumes onboarding when unfinished.
  // The webhook refreshes account status, so invalidate on return.
  const handleManagePayouts = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('player-stripe-manage');
      if (error || !data?.url) throw new Error(error?.message);
      // Custom scheme (not https) so the auth session dismisses on return — see
      // handleStripeOnboard.
      await WebBrowser.openAuthSessionAsync(data.url, 'rallia://stripe-connect-return');
      if (userId) {
        void queryClient.invalidateQueries({ queryKey: tournamentKeys.myPayoutAccount(userId) });
      }
    } catch {
      warningHaptic();
      toast.error(t('tournamentDetail.payments.manageError'));
    }
  }, [toast, t, userId, queryClient]);

  const createRegistrationPayment = useCreateRegistrationPayment();

  const handlePaidRegister = useCallback(
    async (partnerId?: string) => {
      if (!tournament) return;

      // The actual charge — only runs after the player accepts the disclosure.
      const runPayment = async () => {
        try {
          const intent = await createRegistrationPayment.mutateAsync({
            tournamentId: tournament.id,
            partnerId,
          });
          const { error: initError } = await initPaymentSheet({
            paymentIntentClientSecret: intent.clientSecret,
            merchantDisplayName: 'Rallia',
            applePay: { merchantCountryCode: 'CA' },
            googlePay: { merchantCountryCode: 'CA', currencyCode: 'CAD', testEnv: __DEV__ },
          });
          if (initError) throw new Error(initError.message);
          const { error: paymentError } = await presentPaymentSheet();
          if (paymentError) {
            if (paymentError.code === 'Canceled') return; // user backed out — slot reaper frees it
            throw new Error(paymentError.message);
          }
          successHaptic();
          toast.success(t('tournamentDetail.payments.successToast'));
          // The webhook flips payment_pending → registered; refetch now and again
          // shortly after to catch the async finalize.
          const invalidate = () => {
            void queryClient.invalidateQueries({ queryKey: tournamentKeys.detail(tournament.id) });
            void queryClient.invalidateQueries({
              queryKey: tournamentKeys.registrations(tournament.id),
            });
            void queryClient.invalidateQueries({
              queryKey: tournamentKeys.myRegistration(tournament.id, userId ?? ''),
            });
          };
          invalidate();
          setTimeout(invalidate, 2500);
        } catch (e) {
          warningHaptic();
          const code = e instanceof TournamentPaymentError ? e.code : undefined;
          const key = code
            ? (PAID_REGISTER_ERROR_KEYS[code] ?? 'tournamentDetail.payments.errors.generic')
            : 'tournamentDetail.payments.errors.generic';
          toast.error(t(key as TranslationKey));
        }
      };

      // Point-of-sale disclosure before any charge: what they pay, the refund
      // policy, that the service fee isn't refundable, and that Rallia only
      // facilitates (the organizer, not Rallia, owns the event).
      const totalLabel = feeQuote
        ? formatPrice(feeQuote.totalCents, feeQuote.currency, { locale })
        : null;
      // GST/QST rides on Rallia's service fee; the player only pays it in
      // player_pays mode (organizer_absorbs nets it from the organizer's take).
      const taxLabel =
        feeQuote && feeQuote.feePayer === 'player_pays' && feeQuote.feeTaxCents > 0
          ? formatPrice(feeQuote.feeTaxCents, feeQuote.currency, { locale })
          : null;
      const message = [
        totalLabel
          ? t('tournamentDetail.payments.confirmAmount').replace('{amount}', totalLabel)
          : null,
        taxLabel
          ? t('tournamentDetail.payments.confirmFeeTax').replace('{amount}', taxLabel)
          : null,
        refundPolicyLine(feeQuote, t, locale),
        t('tournamentDetail.payments.confirmFeeNonRefundable'),
        t('tournamentDetail.payments.liabilityNotice'),
      ]
        .filter(Boolean)
        .join('\n\n');

      Alert.alert(t('tournamentDetail.payments.confirmTitle'), message, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: totalLabel
            ? `${t('tournamentDetail.payments.confirmPay')} · ${totalLabel}`
            : t('tournamentDetail.payments.confirmPay'),
          onPress: () => {
            void runPayment();
          },
        },
      ]);
    },
    [
      tournament,
      userId,
      createRegistrationPayment,
      initPaymentSheet,
      presentPaymentSheet,
      queryClient,
      toast,
      t,
      locale,
      feeQuote,
    ]
  );

  const withdraw = useWithdrawFromTournament({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.withdrawFailed'),
  });
  const refundRegistration = useRefundRegistration({
    onSuccess: r => {
      successHaptic();
      toast.success(
        r.refundedCents > 0
          ? t('tournamentDetail.payments.refundIssued').replace(
              '{amount}',
              formatPrice(r.refundedCents, tournament?.currency ?? 'CAD', { locale })
            )
          : t('tournamentDetail.payments.withdrawnNoRefund')
      );
    },
    onError: e => showError(e.message, 'tournamentDetail.errors.withdrawFailed'),
  });
  const acceptInvite = useAcceptTournamentInvite({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.acceptInviteFailed'),
  });
  const revokeInvite = useRevokeTournamentInvite({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.revokeInviteFailed'),
  });
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PlayerSearchResult | null>(null);
  const insets = useSafeAreaInsets();

  // Decline reuses the remove RPC (sets 'disqualified'); the ref lets the
  // shared mutation callbacks pick decline- vs remove-flavored copy.
  const declineModeRef = useRef(false);

  const removeRegistrant = useRemoveTournamentRegistration({
    onSuccess: () => {
      successHaptic();
      setRemoveTarget(null);
      toast.success(
        t(
          declineModeRef.current
            ? 'tournamentDetail.declineModal.success'
            : 'tournamentDetail.removeModal.success'
        )
      );
    },
    onError: e => {
      setRemoveTarget(null);
      showError(
        e.message,
        declineModeRef.current
          ? 'tournamentDetail.errors.declineFailed'
          : 'tournamentDetail.errors.removeFailed'
      );
    },
  });

  const approveRegistrant = useApproveTournamentRegistration({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.dashboard.pendingRequests.approvedToast'));
    },
    onError: e => showError(e.message, 'tournamentDetail.errors.approveFailed'),
  });

  const cancel = useCancelTournament({
    onSuccess: () => {
      successHaptic();
      setShowCancelModal(false);
      setCancelReason('');
    },
    onError: e => {
      const msg = e.message.toLowerCase();
      const key: TranslationKey = msg.includes('not_cancellable')
        ? 'tournamentDetail.cancelModal.errorNotCancellable'
        : msg.includes('optimistic_lock')
          ? 'tournamentDetail.cancelModal.errorLockConflict'
          : 'tournamentDetail.cancelModal.errorGeneric';
      warningHaptic();
      toast.error(t(key));
    },
  });

  const archive = useArchiveTournament({
    onSuccess: () => {
      successHaptic();
      setShowArchiveModal(false);
    },
    onError: e => {
      const msg = e.message.toLowerCase();
      const key: TranslationKey = msg.includes('settlement_pending')
        ? 'tournamentDetail.archiveModal.errorSettlementPending'
        : msg.includes('not_archivable')
          ? 'tournamentDetail.archiveModal.errorNotArchivable'
          : msg.includes('optimistic_lock')
            ? 'tournamentDetail.archiveModal.errorLockConflict'
            : 'tournamentDetail.archiveModal.errorGeneric';
      warningHaptic();
      toast.error(t(key));
    },
  });

  const onOpen = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    open.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, open]);

  const onClose = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    close.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, close]);

  const onReopen = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    reopen.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, reopen]);

  const isDoubles = !!tournament && tournament.entry_format !== 'singles';

  // Invite-only invitees land a 'pending' row the organizer never approves —
  // they accept it themselves (tournament_register flips pending → registered).
  // Distinct from approval-mode pending, which is passive (await organizer).
  const isInvitePending =
    !!myActiveRegistration &&
    myActiveRegistration.status === 'pending' &&
    tournament?.registration_mode === 'invite_only';

  // Organizer-initiated intra-app invite (any mode), marked by invited_by. The
  // invitee confirms via tournament_accept_invite — distinct from the legacy
  // invite_only self-accept path (isInvitePending) above.
  const isInvitedPending =
    !!myActiveRegistration &&
    myActiveRegistration.status === 'pending' &&
    !!myActiveRegistration.invited_by;

  const onRegister = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    // Accepting an existing pending invite flips it via tournament_register
    // (join-via-invite is idempotent on a pending row and wouldn't confirm it);
    // a fresh invitee with only a share link redeems the token. Organizers and
    // direct registrants take the normal path. Doubles routes through the
    // partner picker first in every case.
    const inviteToken = !isOrganizer && !isInvitePending ? params.inviteToken : undefined;
    // Paid tournaments charge via Stripe before confirming the spot. Share-link
    // holders included: redeeming a token used to skip this and call
    // joinViaInvite, which the paid gate rejects with PAYMENT_REQUIRED and no
    // route into payment, so the link just dead-ended. The token isn't needed to
    // pay — begin_paid_registration takes it from here.
    //
    // isInvitePending (invite_only + pending, no invited_by) still falls through
    // because that row can't exist on a paid tournament: the gate only admits a
    // pending row when invited_by is set, and those take the accept-invite CTA.
    if (isPaidTournament && !isInvitePending) {
      if (isDoubles) {
        void SheetManager.show('tournament-partner-picker', {
          payload: {
            sportId: tournament.sport_id,
            onPick: partner => {
              void handlePaidRegister(partner.id);
            },
          },
        });
        return;
      }
      void handlePaidRegister();
      return;
    }
    if (isDoubles) {
      void SheetManager.show('tournament-partner-picker', {
        payload: {
          sportId: tournament.sport_id,
          onPick: partner => {
            if (inviteToken) {
              joinViaInvite.mutate({
                token: inviteToken,
                tournamentId: tournament.id,
                partnerId: partner.id,
              });
            } else {
              register.mutate({ tournamentId: tournament.id, partnerId: partner.id });
            }
          },
        },
      });
      return;
    }
    if (inviteToken) {
      joinViaInvite.mutate({ token: inviteToken, tournamentId: tournament.id });
      return;
    }
    register.mutate({ tournamentId: tournament.id });
  }, [
    tournament,
    isDoubles,
    isInvitePending,
    register,
    joinViaInvite,
    params.inviteToken,
    isOrganizer,
    isPaidTournament,
    handlePaidRegister,
  ]);

  const onWithdraw = useCallback(() => {
    if (!tournament || !myActiveRegistration) return;
    lightHaptic();

    // Paid registration: confirm with the refund estimate, then withdraw+refund.
    // Only a confirmed (paid) row has a captured payment to refund — an unpaid
    // pending invite falls through to the plain withdraw below.
    if (isPaidTournament && myActiveRegistration.status === 'registered') {
      const pastCutoff =
        !!feeQuote?.refundCutoffAt && new Date(feeQuote.refundCutoffAt) < new Date();
      const estimateCents = !feeQuote
        ? 0
        : feeQuote.refundPolicyKind === 'none' || pastCutoff
          ? 0
          : feeQuote.refundPolicyKind === 'full'
            ? feeQuote.entryCents
            : Math.round((feeQuote.entryCents * (feeQuote.refundPartialBps ?? 0)) / 10000);
      const amountLabel = formatPrice(estimateCents, tournament.currency ?? 'CAD', { locale });
      Alert.alert(
        t('tournamentDetail.payments.withdrawConfirmTitle'),
        estimateCents > 0
          ? t('tournamentDetail.payments.withdrawConfirmRefund').replace('{amount}', amountLabel)
          : t('tournamentDetail.payments.withdrawConfirmNoRefund'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('tournamentDetail.actions.withdraw'),
            style: 'destructive',
            onPress: () =>
              refundRegistration.mutate({
                registrationId: myActiveRegistration.id,
                versionWas: myActiveRegistration.version,
                tournamentId: tournament.id,
              }),
          },
        ]
      );
      return;
    }

    withdraw.mutate({
      registrationId: myActiveRegistration.id,
      versionWas: myActiveRegistration.version,
      tournamentId: tournament.id,
    });
  }, [
    tournament,
    myActiveRegistration,
    withdraw,
    isPaidTournament,
    feeQuote,
    refundRegistration,
    t,
    locale,
  ]);

  const onAcceptInvite = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    // Paid tournaments: an invited player still pays the entry fee to claim the
    // slot. Same Stripe flow as self-register — begin_paid_registration reuses
    // the pending invite row, and the webhook confirms the spot after payment.
    if (isPaidTournament) {
      if (isDoubles) {
        void SheetManager.show('tournament-partner-picker', {
          payload: {
            sportId: tournament.sport_id,
            onPick: partner => {
              void handlePaidRegister(partner.id);
            },
          },
        });
        return;
      }
      void handlePaidRegister();
      return;
    }
    if (isDoubles) {
      void SheetManager.show('tournament-partner-picker', {
        payload: {
          sportId: tournament.sport_id,
          onPick: partner =>
            acceptInvite.mutate({ tournamentId: tournament.id, partnerId: partner.id }),
        },
      });
      return;
    }
    acceptInvite.mutate({ tournamentId: tournament.id });
  }, [tournament, isDoubles, acceptInvite, isPaidTournament, handlePaidRegister]);

  const onSetUpBracket = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    navigation.navigate('TournamentBracketSetup', { tournamentId: tournament.id });
  }, [tournament, navigation]);

  // Bracket: only fetch when the bracket has been generated (status >= in_progress).
  const bracketStatuses: ReadonlyArray<Enums<'tournament_status'>> = [
    'registration_closed',
    'in_progress',
    'completed',
    'archived',
  ];
  const shouldFetchBracket = !!tournament && bracketStatuses.includes(tournament.status);
  const { data: matches = [] } = useTournamentMatches(
    shouldFetchBracket ? tournament?.id : undefined
  );

  // Map registration_id → seed number (1-indexed). The order matches the
  // RPC's seeding criteria so the labels here line up with the bracket.
  const seedByRegId = useMemo(() => {
    const map = new Map<string, number>();
    [...registrations]
      .sort((a, b) => {
        const sa = a.seed_rank ?? Number.MAX_SAFE_INTEGER;
        const sb = b.seed_rank ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        const ta = new Date(a.registered_at).getTime();
        const tb = new Date(b.registered_at).getTime();
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      })
      .forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [registrations]);

  // Map registration_id → member user ids (captain first, partner second for
  // doubles), used to decide whether the caller can tap into a bracket match.
  const membersByRegId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of registrations) {
      map.set(r.id, r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id]);
    }
    return map;
  }, [registrations]);

  // Batch-fetch player profiles so the bracket and players list can render
  // real names; includes the organizer for the hero byline.
  const userIds = useMemo(
    () => [
      ...registrations.flatMap(r =>
        r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id]
      ),
      ...(tournament ? [tournament.organizer_id] : []),
    ],
    [registrations, tournament]
  );
  const { data: profiles } = useProfilesByIds(userIds);
  const nameByRegId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of registrations) {
      const p = profiles?.[r.user_id];
      // Always use first (+ last). display_name is intentionally ignored
      // per the app-wide convention in @rallia/shared-utils/getHumanName.
      const name = p ? getHumanName(p, '') : '';
      // Doubles entries render as a pair label ("Alex & Sam") everywhere the
      // registration is shown: bracket slots, champion, opponent, score sheet.
      const partner = r.partner_user_id ? profiles?.[r.partner_user_id] : undefined;
      const partnerName = partner ? getHumanName(partner, '') : '';
      const label = partnerName && name ? `${name} & ${partnerName}` : name;
      if (label) map.set(r.id, label);
    }
    return map;
  }, [registrations, profiles]);

  // Members of each registration as clickable avatar descriptors (captain first,
  // partner second for doubles), so bracket slots can show avatars that link to
  // each player's profile.
  const slotPlayersByRegId = useMemo(() => {
    const map = new Map<string, Array<{ id: string; avatarUrl: string | null }>>();
    for (const r of registrations) {
      const ids = r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id];
      map.set(
        r.id,
        ids.map(id => ({
          id,
          avatarUrl: getProfilePictureUrl(profiles?.[id]?.profile_picture_url),
        }))
      );
    }
    return map;
  }, [registrations, profiles]);

  // Seed-ordered participants enriched with rating/reputation/online, fetched
  // server-side so the Players tab renders full community PlayerCards.
  const { data: participantPlayers = [] } = useTournamentParticipants(params.tournamentId);

  // Registrant removal is a pre-bracket organizer tool; participant rows map
  // back to their registration (id + version) through user_id.
  const canRemoveRegistrants =
    isOrganizer &&
    (tournament?.status === 'registration_open' || tournament?.status === 'registration_closed');

  const registrationByUserId = useMemo(() => {
    const map = new Map<string, (typeof registrations)[number]>();
    for (const r of registrations) {
      map.set(r.user_id, r);
      // Removing either member of a doubles pair removes the whole entry.
      if (r.partner_user_id) map.set(r.partner_user_id, r);
    }
    return map;
  }, [registrations]);

  // Enriched participant cards keyed by player id, for the pending queue.
  const participantById = useMemo(() => {
    const map = new Map<string, PlayerSearchResult>();
    for (const p of participantPlayers) map.set(p.id, p);
    return map;
  }, [participantPlayers]);

  // Registered list excludes pending approvals — those render in PendingRequestsSection.
  const registeredParticipantPlayers = useMemo(
    () => participantPlayers.filter(p => registrationByUserId.get(p.id)?.status !== 'pending'),
    [participantPlayers, registrationByUserId]
  );

  // Organizer approval queue: one entry per pending registration, enriched with
  // the captain's participant card. Same pre-bracket + organizer gate as remove.
  const pendingRequestRows = useMemo<PendingRequestRow[]>(() => {
    if (!canRemoveRegistrants) return [];
    const rows: PendingRequestRow[] = [];
    for (const r of registrations) {
      // Only self-requested pendings need organizer approval. Organizer-sent
      // invites (invited_by) are awaiting the invitee's acceptance, not approval.
      if (r.status !== 'pending' || r.invited_by) continue;
      const player = participantById.get(r.user_id);
      if (player) rows.push({ player, registrationId: r.id, version: r.version });
    }
    return rows;
  }, [registrations, participantById, canRemoveRegistrants]);

  // Organizer-only: players invited via the in-app picker who haven't accepted
  // yet (status pending + invited_by). Shown read-only in the Players tab.
  const invitedPendingRows = useMemo<PendingRequestRow[]>(() => {
    if (!isOrganizer) return [];
    const rows: PendingRequestRow[] = [];
    for (const r of registrations) {
      if (r.status !== 'pending' || !r.invited_by) continue;
      const player = participantById.get(r.user_id);
      if (player) rows.push({ player, registrationId: r.id, version: r.version });
    }
    return rows;
  }, [registrations, participantById, isOrganizer]);

  // Players-tab status segments. Requests / Invited only exist while they hold
  // entries (both are organizer-gated upstream); the selection falls back to
  // Confirmed when its segment empties out.
  const [playersSegment, setPlayersSegment] = useState<PlayersSegment>('confirmed');
  const playersSegmentTabs = useMemo<UnderlineTabItem<PlayersSegment>[]>(() => {
    const tabs: UnderlineTabItem<PlayersSegment>[] = [
      {
        key: 'confirmed',
        label: t('tournamentDetail.dashboard.playerTabs.confirmed'),
        count: registeredParticipantPlayers.length,
        tone: 'positive',
      },
    ];
    // Requests need the organizer to act, so they run warm; invites are just
    // waiting on the invitee.
    if (pendingRequestRows.length > 0)
      tabs.push({
        key: 'requests',
        label: t('tournamentDetail.dashboard.playerTabs.requests'),
        count: pendingRequestRows.length,
        tone: 'warning',
      });
    if (invitedPendingRows.length > 0)
      tabs.push({
        key: 'invited',
        label: t('tournamentDetail.dashboard.playerTabs.invited'),
        count: invitedPendingRows.length,
        tone: 'info',
      });
    return tabs;
  }, [
    t,
    registeredParticipantPlayers.length,
    pendingRequestRows.length,
    invitedPendingRows.length,
  ]);
  const activePlayersSegment: PlayersSegment = playersSegmentTabs.some(
    tab => tab.key === playersSegment
  )
    ? playersSegment
    : 'confirmed';

  const handleRemovePress = useCallback((player: PlayerSearchResult) => {
    lightHaptic();
    setRemoveTarget(player);
  }, []);

  const handleRevokeInvite = useCallback(
    (row: PendingRequestRow) => {
      if (!tournament) return;
      lightHaptic();
      Alert.alert(
        t('tournamentDetail.dashboard.invited.revokeConfirmTitle'),
        t('tournamentDetail.dashboard.invited.revokeConfirmMessage').replace(
          '{name}',
          getHumanName(row.player, '')
        ),
        [
          { text: t('tournamentDetail.dashboard.invited.revokeCancel'), style: 'cancel' },
          {
            text: t('tournamentDetail.dashboard.invited.revokeConfirm'),
            style: 'destructive',
            onPress: () =>
              revokeInvite.mutate({
                registrationId: row.registrationId,
                versionWas: row.version,
                tournamentId: tournament.id,
              }),
          },
        ]
      );
    },
    [tournament, revokeInvite, t]
  );

  // Decline a pending request reuses the remove confirmation modal, but with
  // decline-flavored copy and the disqualify-is-terminal warning.
  const removeTargetIsPending = useMemo(
    () => (removeTarget ? registrationByUserId.get(removeTarget.id)?.status === 'pending' : false),
    [removeTarget, registrationByUserId]
  );

  const confirmRemove = useCallback(() => {
    if (!tournament || !removeTarget) return;
    const reg = registrationByUserId.get(removeTarget.id);
    if (!reg) {
      setRemoveTarget(null);
      warningHaptic();
      toast.error(t('tournamentDetail.errors.lockConflict'));
      return;
    }
    declineModeRef.current = reg.status === 'pending';
    removeRegistrant.mutate({
      registrationId: reg.id,
      versionWas: reg.version,
      tournamentId: tournament.id,
    });
  }, [tournament, removeTarget, registrationByUserId, removeRegistrant, toast, t]);

  const handleApprovePress = useCallback(
    (registrationId: string, version: number) => {
      if (!tournament || approveRegistrant.isPending) return;
      lightHaptic();
      approveRegistrant.mutate({
        registrationId,
        versionWas: version,
        tournamentId: tournament.id,
      });
    },
    [tournament, approveRegistrant]
  );

  const handlePlayerPress = useCallback(
    (player: PlayerSearchResult) => {
      if (!tournament) return;
      lightHaptic();
      navigation.navigate('PlayerProfile', {
        playerId: player.id,
        sportId: tournament.sport_id,
      });
    },
    [navigation, tournament]
  );

  // Tapping a bracket-slot avatar opens that player's profile (by user id).
  const handleBracketPlayerPress = useCallback(
    (playerId: string) => {
      if (!tournament) return;
      lightHaptic();
      navigation.navigate('PlayerProfile', {
        playerId,
        sportId: tournament.sport_id,
      });
    },
    [navigation, tournament]
  );

  // ---------------------------------------------------------------------------
  // Dashboard-derived state
  // ---------------------------------------------------------------------------

  const organizerName = useMemo(() => {
    if (!tournament) return '';
    // Official events carry a brand override so they read "Rallia" rather than
    // whichever team member owns the row; player-run events fall back to the
    // organizer's profile.
    const brand = tournament.organizer_display_name?.trim();
    if (brand) return brand;
    const p = profiles?.[tournament.organizer_id];
    return p ? getHumanName(p, '') : '';
  }, [profiles, tournament]);

  // Doubles: the other member of the caller's pair, for the hero label.
  const myPartnerName = useMemo(() => {
    if (!myActiveRegistration?.partner_user_id || !userId) return '';
    const otherId =
      myActiveRegistration.user_id === userId
        ? myActiveRegistration.partner_user_id
        : myActiveRegistration.user_id;
    const p = profiles?.[otherId];
    return p ? getHumanName(p, '') : '';
  }, [myActiveRegistration, userId, profiles]);

  const myRegId = myActiveRegistration?.id ?? null;

  const totalRounds = useMemo(
    () => matches.reduce((max, m) => Math.max(max, m.round_number), 0),
    [matches]
  );

  const championName = useMemo(() => {
    if (!totalRounds) return null;
    const final = matches.find(m => m.round_number === totalRounds && m.winner_registration_id);
    if (!final?.winner_registration_id) return null;
    return (
      nameByRegId.get(final.winner_registration_id) ??
      seedFallbackLabel(seedByRegId.get(final.winner_registration_id), t)
    );
  }, [matches, totalRounds, nameByRegId, seedByRegId, t]);

  // Playable games only — bye/phantom slots auto-advance and are never played.
  const matchProgress = useMemo(() => {
    const real = matches.filter(m => !m.player1_is_bye && !m.player2_is_bye);
    return { done: real.filter(m => !!m.winner_registration_id).length, total: real.length };
  }, [matches]);

  const myNextMatch = useMemo(() => {
    if (!myRegId) return null;
    return (
      matches
        .filter(
          m =>
            m.status === 'pending' &&
            !m.player1_is_bye &&
            !m.player2_is_bye &&
            (m.player1_registration_id === myRegId || m.player2_registration_id === myRegId)
        )
        .sort((a, b) => a.round_number - b.round_number)[0] ?? null
    );
  }, [matches, myRegId]);

  const myBracketState = useMemo<'next' | 'waiting' | 'eliminated' | 'champion' | null>(() => {
    if (!myRegId || tournament?.status !== 'in_progress') return null;
    if (myNextMatch) {
      return myNextMatch.player1_registration_id && myNextMatch.player2_registration_id
        ? 'next'
        : 'waiting';
    }
    const mine = matches.filter(
      m => m.player1_registration_id === myRegId || m.player2_registration_id === myRegId
    );
    if (mine.some(m => m.winner_registration_id && m.winner_registration_id !== myRegId)) {
      return 'eliminated';
    }
    const final = matches.find(m => m.round_number === totalRounds);
    return final?.winner_registration_id === myRegId ? 'champion' : 'waiting';
  }, [myRegId, tournament?.status, myNextMatch, matches, totalRounds]);

  const myOpponentLabel = useMemo(() => {
    if (!myNextMatch || !myRegId) return null;
    const oppId =
      myNextMatch.player1_registration_id === myRegId
        ? myNextMatch.player2_registration_id
        : myNextMatch.player1_registration_id;
    if (!oppId) return null;
    return nameByRegId.get(oppId) ?? seedFallbackLabel(seedByRegId.get(oppId), t);
  }, [myNextMatch, myRegId, nameByRegId, seedByRegId, t]);

  // Flashscore-style content tabs (Overview / Bracket / Players / Details).
  // Keyed, not positional: tabs appear and disappear with tournament state, so
  // an index would silently select a different tab underneath the user.
  const [activeTabKey, setActiveTabKey] = useState<TabKey>('overview');

  // Tab switches scroll back to the tab bar (measured, since the hero varies in
  // height) so a new pane never opens mid-content.
  const scrollRef = useRef<ScrollView>(null);
  const heroHeightRef = useRef(0);

  const handleBracketMatchTap = useCallback(
    (tournamentMatchId: string, p1RegId: string, p2RegId: string) => {
      const team1 = membersByRegId.get(p1RegId);
      const team2 = membersByRegId.get(p2RegId);
      if (!team1?.length || !team2?.length || !tournament) return;
      lightHaptic();
      SheetManager.show('tournament-link-match', {
        payload: {
          tournamentMatchId,
          tournamentId: tournament.id,
          sportId: tournament.sport_id,
          entryFormat: tournament.entry_format,
          team1UserIds: team1,
          team2UserIds: team2,
        },
      });
    },
    [membersByRegId, tournament]
  );

  // Open (get-or-create) the per-pairing round chat and drop the caller in, so
  // they can organize the game with their opponent (creating it links the match
  // to this bracket round, and the chat becomes the match chat — no duplicate).
  const openRoundChat = useOpenTournamentRoundChat();
  const handleOpenRoundChat = useCallback(
    (tournamentMatchId: string) => {
      lightHaptic();
      openRoundChat.mutate(tournamentMatchId, {
        onSuccess: conversationId => {
          navigation.navigate('ChatConversation', {
            conversationId,
            title: tournament?.name,
          });
        },
        onError: () => {
          toast.error(t('tournamentDetail.dashboard.myMatch.organizeError'));
        },
      });
    },
    [openRoundChat, navigation, tournament?.name, toast, t]
  );

  // Organizer-only: record an authoritative result for a stalled/disputed
  // bracket match via the structured set-entry sheet.
  const handleOrganizerOverride = useCallback(
    (tournamentMatchId: string, p1RegId: string, p2RegId: string) => {
      if (!tournament) return;
      lightHaptic();
      const sportName = sports.find(s => s.id === tournament.sport_id)?.name;
      SheetManager.show('tournament-record-score', {
        payload: {
          tournamentMatchId,
          tournamentId: tournament.id,
          player1RegId: p1RegId,
          player2RegId: p2RegId,
          player1Name: nameByRegId.get(p1RegId) ?? seedFallbackLabel(seedByRegId.get(p1RegId), t),
          player2Name: nameByRegId.get(p2RegId) ?? seedFallbackLabel(seedByRegId.get(p2RegId), t),
          isPickleball: sportName === 'pickleball',
          matchFormat: tournament.match_format,
          onSuccess: () => {
            successHaptic();
          },
        },
      });
    },
    [tournament, sports, nameByRegId, seedByRegId, t]
  );

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
      cancelledBg: isDark ? '#7c2d1230' : accent[100],
      cancelledBorder: isDark ? status.warning.DEFAULT : status.warning.light,
      cancelledText: isDark ? status.warning.light : accent[800],
      highlightBg: isDark ? primary[950] : primary[50],
      highlightBorder: isDark ? `${primary[400]}40` : `${primary[500]}20`,
      secondaryHighlightBg: isDark ? secondary[950] : secondary[50],
      secondaryHighlightBorder: isDark ? `${secondary[400]}40` : `${secondary[500]}20`,
      secondaryAccent: isDark ? secondary[400] : secondary[500],
      secondaryAccentBg: isDark ? `${secondary[500]}30` : `${secondary[500]}20`,
      championBg: isDark ? `${accent[400]}25` : `${accent[500]}15`,
      championText: isDark ? accent[400] : accent[600],
      danger: isDark ? secondary[400] : secondary[500],
      dangerBg: isDark ? `${secondary[500]}30` : `${secondary[500]}1f`,
    }),
    [themeColors, isDark]
  );

  // Organizer admin actions surfaced via the header "⋯" overflow menu.
  const adminActions = useMemo(() => {
    const s = tournament?.status;
    // Details are only editable before registration closes (draft / open).
    const canEdit = s === 'draft' || s === 'registration_open';
    // Links can be shared ahead of opening — they redeem once registration opens.
    const canInvite = s === 'draft' || s === 'registration_open';
    const canCancel =
      s === 'draft' ||
      s === 'registration_open' ||
      s === 'registration_closed' ||
      s === 'in_progress';
    const canArchive = s === 'completed' || s === 'cancelled';
    // Reopen a closed window for late entrants, while the bracket isn't generated.
    const canReopen = s === 'registration_closed' && !tournament?.bracket_locked_at;
    // The shareable invite link stays active until the bracket is published: even
    // after registration closes, the organizer can still admit late entrants by
    // link (draft/open already reach the link through the "Invite players" sheet).
    const canShareLink = s === 'registration_closed' && !tournament?.bracket_locked_at;
    const enabled =
      isOrganizer && (canEdit || canInvite || canReopen || canShareLink || canCancel || canArchive);
    return { canEdit, canInvite, canReopen, canShareLink, canCancel, canArchive, enabled };
  }, [isOrganizer, tournament?.status, tournament?.bracket_locked_at]);

  // Creation-success handoff: land here with openInviteSheet=true and the
  // invite sheet opens once, after the screen settles. The param is cleared
  // inside the timeout — clearing it synchronously re-runs this effect and
  // the cleanup would cancel the timer before it fires.
  useEffect(() => {
    if (!params.openInviteSheet || !isOrganizer || !tournament) return;
    const { id: tournamentId, name: tournamentName } = tournament;
    const timer = setTimeout(() => {
      navigation.setParams({ openInviteSheet: undefined });
      void SheetManager.show('tournament-invite', {
        payload: { tournamentId, tournamentName },
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [params.openInviteSheet, isOrganizer, tournament, navigation]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: adminActions.enabled
        ? () => (
            <TouchableOpacity
              onPress={() => {
                lightHaptic();
                setShowActionsMenu(true);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('tournamentDetail.sections.manage')}
              style={styles.headerMenuButton}
              testID="tournament-overflow-menu"
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [navigation, adminActions.enabled, colors.text, t]);

  const sport = useMemo(
    () => sports.find(s => s.id === tournament?.sport_id),
    [sports, tournament]
  );

  // Edit/Invite are reachable from the header overflow, a prominent Overview
  // action row, and the Players tab — so the open logic lives in one callback.
  const handleEditDetails = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    openSheetForTournamentEdit({
      id: tournament.id,
      version: tournament.version,
      status: tournament.status,
      name: tournament.name,
      description: tournament.description,
      rules: tournament.rules,
      logoUrl: tournament.logo_url,
      minRating: tournament.min_rating,
      maxRating: tournament.max_rating,
      visibility: tournament.visibility,
      startDate: tournament.start_date,
      endDate: tournament.end_date,
      maxParticipants: tournament.max_participants,
      matchFormat: tournament.match_format,
      sport: {
        id: tournament.sport_id,
        name: sport?.name ?? '',
        display_name: sport?.display_name ?? '',
      },
      facilityId: tournament.facility_id,
      venueName: tournament.venue_name,
      venueAddress: tournament.venue_address,
      city: tournament.city,
      prizeMoneyCents: tournament.prize_money_cents,
      entryFeeCents: tournament.entry_fee_cents,
      currency: tournament.currency,
      feePayer: tournament.fee_payer,
      refundPolicyKind: tournament.refund_policy_kind,
      refundPartialBps: tournament.refund_partial_bps,
      refundCutoffAt: tournament.refund_cutoff_at,
    });
  }, [tournament, sport, openSheetForTournamentEdit]);

  const handleInvitePlayers = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    // Open the in-app player picker (which also offers "share a link instead").
    // Exclude the organizer and anyone already registered/pending/invited.
    const excludeUserIds = [
      ...registrations
        .filter(r => r.status === 'registered' || r.status === 'pending')
        .flatMap(r => [r.user_id, r.partner_user_id]),
      userId,
    ].filter((x): x is string => !!x);
    void SheetManager.show('tournament-invite-players', {
      payload: {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        sportId: tournament.sport_id,
        excludeUserIds,
      },
    });
  }, [tournament, registrations, userId]);

  const handleManageCoOrganizers = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    void SheetManager.show('tournament-co-organizers', {
      payload: {
        tournamentId: tournament.id,
        sportId: tournament.sport_id,
        organizerId: tournament.organizer_id,
      },
    });
  }, [tournament]);

  // Post-close, pre-bracket: hand the organizer the still-active share link so
  // they can admit late entrants (the in-app invite picker closes with the
  // registration window, but the link stays live until the bracket publishes).
  const handleShareInviteLink = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    void SheetManager.show('tournament-invite', {
      payload: { tournamentId: tournament.id, tournamentName: tournament.name },
    });
  }, [tournament]);

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  // Pull-to-refresh: results, rosters and paid-registration state all settle
  // server-side after the user leaves the screen, so refetch the whole set.
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tournamentKeys.detail(params.tournamentId) }),
        queryClient.invalidateQueries({
          queryKey: tournamentKeys.registrations(params.tournamentId),
        }),
        queryClient.invalidateQueries({
          queryKey: tournamentKeys.participants(params.tournamentId),
        }),
        queryClient.invalidateQueries({ queryKey: tournamentKeys.matches(params.tournamentId) }),
        userId
          ? queryClient.invalidateQueries({
              queryKey: tournamentKeys.myRegistration(params.tournamentId, userId),
            })
          : Promise.resolve(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, params.tournamentId, userId]);

  if (isLoading || (invitePreviewEnabled && invitePreviewLoading)) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <TournamentDetailSkeleton />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('tournamentDetail.loadError')}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text size="base" weight="semibold" color="#ffffff">
              {t('tournamentDetail.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!tournament) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {inviteInvalid
              ? t('tournamentDetail.inviteLanding.invalidTitle')
              : t('tournamentDetail.notFound')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centeredSubtext}>
            {inviteInvalid
              ? t('tournamentDetail.inviteLanding.invalidDescription')
              : t('tournamentDetail.notFoundDescription')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const daysToStart = Math.round(
    (new Date(tournament.start_date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86_400_000
  );
  const spotsLeft = Math.max(0, tournament.max_participants - activeCount);
  const isLive = tournament.status === 'in_progress';
  const isFinished = tournament.status === 'completed' || tournament.status === 'archived';
  // Cancellation survives archival (status flips to 'archived', cancelled_at stays set),
  // so drive cancelled-state UI off the timestamp, not the live status.
  const wasCancelled = tournament.status === 'cancelled' || tournament.cancelled_at != null;
  const stepIndex =
    tournament.status === 'draft'
      ? 0
      : tournament.status === 'registration_open' || tournament.status === 'registration_closed'
        ? 1
        : isLive
          ? 2
          : 3;
  // Kept short: this sits in a narrow stats segment, so an upcoming start shows
  // the date ("Jul 26") rather than a countdown phrase that would wrap.
  const startTileValue = isLive
    ? t('tournamentDetail.dashboard.stats.live')
    : isFinished
      ? t('tournamentDetail.dashboard.stats.ended')
      : daysToStart === 0
        ? t('tournamentDetail.dashboard.stats.startsToday')
        : new Date(tournament.start_date).toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          });
  const myMatchP1 = myNextMatch?.player1_registration_id ?? null;
  const myMatchP2 = myNextMatch?.player2_registration_id ?? null;
  const registerCloseHint = tournament.registration_closes_at
    ? t('tournamentList.registerBy').replace(
        '{date}',
        formatDate(tournament.registration_closes_at)
      )
    : null;

  // Paid-registration display: total to charge + a one-line refund summary.
  const feeTotalLabel =
    isPaidTournament && feeQuote
      ? formatPrice(feeQuote.totalCents, feeQuote.currency, { locale })
      : null;
  const refundSummary = isPaidTournament ? refundPolicyLine(feeQuote, t, locale) : null;
  const registerBusy = registerPending || createRegistrationPayment.isPending;

  // Late entry by share link: registration closed but the bracket isn't
  // published, so a still-active invite link still gets a visitor in.
  const canLateEnterViaInvite =
    !isOrganizer &&
    tournament.status === 'registration_closed' &&
    !tournament.bracket_locked_at &&
    !!params.inviteToken &&
    !isPaidTournament &&
    !myActiveRegistration &&
    spotsLeft > 0;

  const spotsLeftLabel =
    spotsLeft > 0
      ? t(
          isDoubles
            ? 'tournamentDetail.dashboard.registerCta.spotsLeftTeams'
            : 'tournamentDetail.dashboard.registerCta.spotsLeft'
        ).replace('{n}', String(spotsLeft))
      : null;

  /**
   * The one state-advancing action for this viewer, docked to the bottom of the
   * screen so the conversion moment is never below the fold. Everything else
   * (utilities, withdraw, informational cards) stays in the Overview tab.
   * Null once the tournament is cancelled, finished, or there's nothing to do.
   */
  const primaryAction: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    disabled: boolean;
    hint: string | null;
    testID: string;
  } | null = (() => {
    if (wasCancelled || isFinished || isLive) return null;
    const withFee = (base: string) => (feeTotalLabel ? `${base} · ${feeTotalLabel}` : base);
    const registerHint = [spotsLeftLabel, registerCloseHint, refundSummary]
      .filter(Boolean)
      .join(' · ');

    // Organizer-sent invite: accepted via tournament_accept_invite.
    if (isInvitedPending) {
      const busy = acceptInvite.isPending || createRegistrationPayment.isPending;
      return {
        label: busy
          ? t('tournamentDetail.actions.accepting')
          : withFee(t('tournamentDetail.actions.acceptInvite')),
        icon: 'checkmark-circle-outline',
        onPress: onAcceptInvite,
        disabled: busy,
        hint: refundSummary,
        testID: 'cta-accept-tournament-invite',
      };
    }
    // Invite-only invitee confirming their own pending row.
    if (isInvitePending) {
      return {
        label: registerPending
          ? t('tournamentDetail.actions.accepting')
          : t('tournamentDetail.actions.acceptInvite'),
        icon: 'checkmark-circle-outline',
        onPress: onRegister,
        disabled: registerPending,
        hint: null,
        testID: 'cta-accept-invite',
      };
    }
    if (!isOrganizer && !myActiveRegistration) {
      if (tournament.status === 'registration_open' && spotsLeft > 0) {
        return {
          label: registerBusy
            ? t('tournamentDetail.actions.registering')
            : withFee(t('tournamentDetail.actions.register')),
          icon: 'person-add-outline',
          onPress: onRegister,
          disabled: registerBusy,
          hint: registerHint || null,
          testID: 'cta-register',
        };
      }
      if (canLateEnterViaInvite) {
        return {
          label: registerBusy
            ? t('tournamentDetail.actions.registering')
            : t('tournamentDetail.actions.register'),
          icon: 'person-add-outline',
          onPress: onRegister,
          disabled: registerBusy,
          hint: t('tournamentDetail.dashboard.registerCta.inviteLateDescription'),
          testID: 'cta-register-invite-late',
        };
      }
    }
    if (isOrganizer) {
      if (tournament.status === 'draft') {
        return {
          label: open.isPending
            ? t('tournamentDetail.actions.opening')
            : t('tournamentDetail.actions.openRegistration'),
          icon: 'lock-open-outline',
          onPress: onOpen,
          disabled: open.isPending,
          hint: t('tournamentDetail.dashboard.nextStep.draftDescription'),
          testID: 'cta-open-registration',
        };
      }
      if (tournament.status === 'registration_open') {
        return {
          label: close.isPending
            ? t('tournamentDetail.actions.closing')
            : t('tournamentDetail.actions.closeRegistration'),
          icon: 'lock-closed-outline',
          onPress: onClose,
          disabled: close.isPending,
          hint: t('tournamentDetail.dashboard.nextStep.openDescription')
            .replace('{count}', String(registeredCount))
            .replace('{max}', String(tournament.max_participants)),
          testID: 'cta-close-registration',
        };
      }
      if (tournament.status === 'registration_closed') {
        return {
          label: t('tournamentDetail.actions.setUpBracket'),
          icon: 'git-network-outline',
          onPress: onSetUpBracket,
          disabled: false,
          hint: t('tournamentDetail.dashboard.nextStep.closedDescription').replace(
            '{count}',
            String(registeredCount)
          ),
          testID: 'cta-setup-bracket',
        };
      }
    }
    return null;
  })();

  /** Organizer utilities, rendered as one quiet grouped list in the Overview. */
  const organizerRows: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    badge?: { label: string; tone: 'positive' | 'warning' | 'muted' };
    testID: string;
  }> = [];
  if (isOrganizer) {
    if (adminActions.canInvite) {
      organizerRows.push({
        icon: 'share-social-outline',
        label: t('tournamentDetail.actions.invitePlayers'),
        onPress: handleInvitePlayers,
        testID: 'action-invite-players',
      });
    }
    if (tournament.status === 'registration_open' && !myActiveRegistration) {
      organizerRows.push({
        icon: 'person-add-outline',
        label: register.isPending
          ? t('tournamentDetail.actions.registering')
          : t('tournamentDetail.actions.addMyself'),
        onPress: onRegister,
        testID: 'cta-add-myself',
      });
    }
    // undefined = still loading; the row appears once the status is known.
    if (isPaidTournament && payoutAccount !== undefined) {
      organizerRows.push({
        icon: 'wallet-outline',
        label: t('tournamentDetail.payments.payoutRow.label'),
        onPress: payoutAccount === null ? promptOnboardPayouts : () => void handleManagePayouts(),
        badge:
          payoutAccount === null
            ? { label: t('tournamentDetail.payments.payoutRow.setup'), tone: 'muted' }
            : !payoutAccount.chargesEnabled
              ? { label: t('tournamentDetail.payments.payoutRow.actionNeeded'), tone: 'warning' }
              : { label: t('tournamentDetail.payments.payoutRow.ready'), tone: 'positive' },
        testID: 'action-payouts',
      });
    }
    if (adminActions.canEdit) {
      organizerRows.push({
        icon: 'create-outline',
        label: t('tournamentDetail.actions.editDetails'),
        onPress: handleEditDetails,
        testID: 'action-edit-details',
      });
    }
    if (canManageCoOrganizers) {
      organizerRows.push({
        icon: 'people-circle-outline',
        label: t('tournamentDetail.coOrganizers.ctaTitle'),
        onPress: handleManageCoOrganizers,
        testID: 'action-manage-co-organizers',
      });
    }
  }

  // Details-tab spec-sheet values: level requirement, venue, and the money
  // (entry fee / what the player pays / prize) so every attribute set at
  // creation has a persistent home beyond the glanceable hero.
  const ratingRangeLabel = formatRatingRange(tournament.min_rating, tournament.max_rating);
  const rankingHeadline = tournamentRankingHeadline(tournament);
  const showRegisteredChip =
    !!myActiveRegistration && !wasCancelled && tournament.status !== 'archived';
  const showRankingChip = !!rankingHeadline && awardsRankingPoints;
  const entryFeeLabel = isPaidTournament
    ? formatPrice(tournament.entry_fee_cents, tournament.currency, { locale, trimZeroCents: true })
    : null;
  const prizePoolLabel =
    tournament.prize_money_cents && tournament.prize_money_cents > 0
      ? formatPrice(tournament.prize_money_cents, tournament.currency, {
          locale,
          trimZeroCents: true,
        })
      : null;
  const hasVenueDetails = !!(tournament.venue_name || tournament.venue_address || tournament.city);
  // Address line under the venue name; when only a city is known it's the primary
  // line instead, so it isn't repeated here.
  const venueSecondaryLine = [
    tournament.venue_address,
    tournament.venue_name ? tournament.city : null,
  ]
    .filter(Boolean)
    .join(', ');
  const showFeesSection = isPaidTournament || !!prizePoolLabel;
  // Only surface "You pay" when a service fee is added on top of the entry fee
  // (player-absorbs mode); organizer-absorbs makes the two amounts equal.
  const playerPaysServiceFee = !!feeQuote && feeQuote.totalCents > feeQuote.entryCents;

  // Circuit Rallia eligibility. The ranking ceiling is stamped on EVERY
  // tournament, certified organizer or not, so the ceiling alone would promise
  // points the award will never pay — the certification is the real gate.
  const pointsLadder = awardsRankingPoints ? tournamentPointsLadder(tournament) : null;
  const showPointsTab = !!pointsLadder;

  const showBracketTab = shouldFetchBracket && matches.length > 0;
  const showPlayersTab = tournament.status !== 'draft';
  const showRulesTab = !!tournament.rules?.trim();
  // Split rules into per-line rows so each rule reads as its own item. Falls
  // back to the whole string as one row when the organizer wrote a paragraph.
  const rulesLines = (tournament.rules ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  // Overview → Bracket → Rules → Points → Players → Details. Bracket sits up
  // front because it's the tab that matters most once play starts; everything
  // else follows the reading order of "what is this / what do I win / who's in".
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: t('tournamentDetail.tabs.overview') },
    ...(showBracketTab
      ? [{ key: 'bracket' as const, label: t('tournamentDetail.tabs.bracket') }]
      : []),
    ...(showRulesTab ? [{ key: 'rules' as const, label: t('tournamentDetail.tabs.rules') }] : []),
    ...(showPointsTab
      ? [{ key: 'points' as const, label: t('tournamentDetail.tabs.points') }]
      : []),
    ...(showPlayersTab
      ? [{ key: 'players' as const, label: t('tournamentDetail.tabs.players') }]
      : []),
    { key: 'details', label: t('tournamentDetail.tabs.details') },
  ];
  // The selected tab can vanish (bracket published, rules cleared) — fall back
  // to Overview rather than rendering an empty pane.
  const currentTabKey = tabs.some(tab => tab.key === activeTabKey) ? activeTabKey : 'overview';
  const hasPlayersTab = tabs.some(tab => tab.key === 'players');

  /** Tab-bar taps: switch panes and leave the scroll position alone. */
  const selectTab = (key: TabKey) => {
    void lightHaptic();
    setActiveTabKey(key);
  };

  /** Jumping into a tab from elsewhere on the page (hero badge, a CTA) does
   *  scroll, otherwise the pane you asked for opens off-screen. */
  const goToTab = (key: TabKey) => {
    selectTab(key);
    scrollRef.current?.scrollTo({ y: heroHeightRef.current, animated: true });
  };

  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollRef}
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
        <View
          style={styles.heroFixed}
          onLayout={e => {
            heroHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          {/* Full-bleed banner: status and prize float on the image, the scrim
              carries the identity line. Mirrors the list card so tapping a card
              reads as it expanding, and keeps the fold free for the tabs. The
              description now lives at the top of the Details tab. */}
          <View style={styles.heroBanner}>
            <TournamentBanner logoUrl={tournament.logo_url} />
            <View style={styles.heroBannerTopRow}>
              {isLive ? (
                <LiveBadge
                  label={t('tournamentDetail.status.in_progress')}
                  isDark={isDark}
                  onImage
                />
              ) : (
                <StatusBadge status={tournament.status} colors={colors} t={t} onImage />
              )}
              {/* What the event is worth, both currencies together: cash in the
                  solid gold pill, Circuit Rallia points in the lighter one. */}
              <View style={styles.heroBannerBadges}>
                {tournament.prize_money_cents && tournament.prize_money_cents > 0 ? (
                  <View style={styles.heroPrizeBadge}>
                    <Ionicons name="trophy" size={13} color={accent[900]} />
                    <Text size="xs" weight="semibold" color={accent[900]} numberOfLines={1}>
                      {formatPrice(tournament.prize_money_cents, tournament.currency, {
                        locale,
                        trimZeroCents: true,
                      })}
                    </Text>
                  </View>
                ) : null}
                {showRankingChip && rankingHeadline ? (
                  <TouchableOpacity
                    onPress={() => goToTab('points')}
                    activeOpacity={0.7}
                    style={styles.heroPointsBadge}
                    accessibilityRole="button"
                    accessibilityLabel={t('tournamentDetail.tabs.points')}
                    testID="hero-ranking-banner"
                  >
                    <Ionicons name="ribbon" size={13} color={accent[700]} />
                    <Text size="xs" weight="semibold" color={accent[700]} numberOfLines={1}>
                      {t('tournamentList.rankingPoints').replace(
                        '{points}',
                        String(rankingHeadline.points)
                      )}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            {/* Scrim is deliberately shallow and light: it only has to carry two
                lines, and the text shadow does the rest of the legibility work,
                so the artwork stays visible. */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.68)']}
              locations={[0, 0.42, 1]}
              style={styles.heroScrim}
            >
              {/* One line: the 2.4:1 banner is a wide strip, so a two-line
                  title left almost no artwork visible. */}
              <Text
                size="2xl"
                weight="bold"
                lineHeight="tight"
                color="#ffffff"
                numberOfLines={1}
                style={styles.scrimText}
              >
                {tournament.name}
              </Text>
              <Text
                size="sm"
                color="rgba(255,255,255,0.92)"
                numberOfLines={1}
                style={styles.scrimText}
              >
                {/* Dates + venue only: the organizer byline has its own row in
                    the Overview's Event info card and overflowed this line. */}
                {[
                  `${formatDate(tournament.start_date)} – ${formatDate(tournament.end_date)}`,
                  tournament.venue_name || tournament.city,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </LinearGradient>
          </View>

          {/* One chip row replaces the registered band and the chat button. */}
          {showRegisteredChip || !!chatConversationId ? (
            <View style={styles.heroChipRow}>
              {showRegisteredChip ? (
                <HeroChip
                  icon="checkmark-circle"
                  tone="positive"
                  colors={colors}
                  label={
                    myActiveRegistration.status === 'pending'
                      ? isInvitePending || isInvitedPending
                        ? t('tournamentDetail.actions.invitePendingLabel')
                        : t('tournamentDetail.actions.registrationPendingLabel')
                      : myPartnerName
                        ? t('tournamentDetail.actions.registeredWithPartnerLabel').replace(
                            '{name}',
                            myPartnerName
                          )
                        : t('tournamentDetail.actions.registeredLabel')
                  }
                />
              ) : null}
              {chatConversationId ? (
                <HeroChip
                  icon="chatbubbles-outline"
                  tone="outline"
                  colors={colors}
                  onPress={handleOpenChat}
                  label={t('tournamentDetail.chat.open')}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Sticky tab bar — scrollable underline tabs: each sized to its label
            and left-aligned, so any number of tabs scrolls cleanly */}
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
            {tabs.map(tab => {
              const selected = tab.key === currentTabKey;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => selectTab(tab.key)}
                  activeOpacity={0.7}
                  style={styles.tabItem}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  testID={`tournament-tab-${tab.key}`}
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

        {/* ============================ OVERVIEW ============================ */}
        {currentTabKey === 'overview' && (
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
              <StatSegment
                value={startTileValue}
                label={t('tournamentDetail.dashboard.stats.start')}
                colors={colors}
                showDivider
              />
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
                <Text
                  size="xs"
                  weight="semibold"
                  color={colors.textMuted}
                  style={styles.sectionTitle}
                >
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
                          {roundLabel(myNextMatch.round_number, totalRounds, t)} ·{' '}
                          {t('tournamentDetail.dashboard.myMatch.hint')}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.primary} />
                    </TouchableOpacity>

                    {/* Organize the game with your opponent in a shared round chat. */}
                    <TouchableOpacity
                      onPress={() => handleOpenRoundChat(myNextMatch.id)}
                      activeOpacity={0.7}
                      disabled={openRoundChat.isPending}
                      style={[
                        styles.primaryButton,
                        styles.roundChatBtn,
                        { backgroundColor: colors.primary },
                        openRoundChat.isPending && styles.buttonDisabled,
                      ]}
                      accessibilityRole="button"
                    >
                      {openRoundChat.isPending ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Ionicons name="chatbubbles-outline" size={20} color="#ffffff" />
                      )}
                      <Text size="base" weight="semibold" color="#ffffff">
                        {t('tournamentDetail.dashboard.myMatch.organize')}
                      </Text>
                    </TouchableOpacity>
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
                  text={t('tournamentDetail.dashboard.organizedBy').replace(
                    '{name}',
                    organizerName
                  )}
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
                <Text
                  size="xs"
                  weight="semibold"
                  color={colors.textMuted}
                  style={styles.sectionTitle}
                >
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
        )}

        {/* ============================ BRACKET ============================= */}
        {currentTabKey === 'bracket' && showBracketTab && (
          <View style={styles.tabContent}>
            <BracketSection
              matches={matches}
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
          </View>
        )}

        {/* ============================ PLAYERS ============================= */}
        {currentTabKey === 'players' && showPlayersTab && (
          <View style={styles.playersTabContent}>
            {adminActions.canInvite && (
              <Pressable
                onPress={handleInvitePlayers}
                style={({ pressed }) => [
                  styles.playersInviteBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
                ]}
                testID="players-invite-cta"
              >
                <Ionicons name="share-social-outline" size={18} color="#ffffff" />
                <Text size="sm" weight="semibold" color="#ffffff">
                  {t('tournamentDetail.actions.invitePlayers')}
                </Text>
              </Pressable>
            )}
            {playersSegmentTabs.length > 1 && (
              <UnderlineTabBar
                tabs={playersSegmentTabs}
                activeKey={activePlayersSegment}
                onChange={setPlayersSegment}
                style={styles.segmentBar}
              />
            )}
            {activePlayersSegment === 'requests' ? (
              <PendingRequestsSection
                rows={pendingRequestRows}
                onPlayerPress={handlePlayerPress}
                onApprove={handleApprovePress}
                onDecline={handleRemovePress}
                colors={colors}
                t={t}
              />
            ) : activePlayersSegment === 'invited' ? (
              <InvitedSection
                rows={invitedPendingRows}
                onPlayerPress={handlePlayerPress}
                onRevoke={handleRevokeInvite}
                colors={colors}
                t={t}
              />
            ) : (
              <ParticipantsSection
                players={registeredParticipantPlayers}
                onPlayerPress={handlePlayerPress}
                onRemovePress={canRemoveRegistrants ? handleRemovePress : undefined}
                currentUserId={userId}
                maxParticipants={tournament.max_participants}
                deadlineLabel={
                  tournament.registration_closes_at && tournament.status === 'registration_open'
                    ? formatDate(tournament.registration_closes_at)
                    : null
                }
                colors={colors}
                t={t}
              />
            )}
          </View>
        )}

        {/* ============================ DETAILS ============================= */}
        {currentTabKey === 'details' && (
          <View style={styles.tabContent}>
            {tournament.description?.trim() ? (
              <LabeledBlock
                label={t('tournamentDetail.labels.description')}
                value={tournament.description}
                colors={colors}
              />
            ) : null}

            <Section title={t('tournamentDetail.dashboard.details')} colors={colors}>
              <InfoRow
                label={t('tournamentDetail.labels.startDate')}
                value={formatDate(tournament.start_date)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.endDate')}
                value={formatDate(tournament.end_date)}
                colors={colors}
              />
              {tournament.registration_closes_at &&
                (tournament.status === 'draft' || tournament.status === 'registration_open') && (
                  <InfoRow
                    label={t('tournamentDetail.labels.registrationCloses')}
                    value={formatDate(tournament.registration_closes_at)}
                    colors={colors}
                  />
                )}
              <InfoRow
                label={t('tournamentDetail.labels.bracketSize')}
                value={String(tournament.max_participants)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.bracketType')}
                value={t(BRACKET_TYPE_LABEL_KEY[tournament.bracket_type] as TranslationKey)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.entryFormat')}
                value={t(ENTRY_FORMAT_LABEL_KEY[tournament.entry_format] as TranslationKey)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.matchFormat')}
                value={t(MATCH_FORMAT_LABEL_KEY[tournament.match_format] as TranslationKey)}
                colors={colors}
              />
              {ratingRangeLabel ? (
                <InfoRow
                  label={t('tournamentDetail.labels.ratingRange')}
                  value={ratingRangeLabel}
                  colors={colors}
                />
              ) : null}
              <InfoRow
                label={t('tournamentDetail.labels.visibility')}
                value={t(VISIBILITY_LABEL_KEY[tournament.visibility] as TranslationKey)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.registrationMode')}
                value={t(REG_MODE_LABEL_KEY[tournament.registration_mode] as TranslationKey)}
                colors={colors}
              />
            </Section>

            {hasVenueDetails ? (
              <LabeledBlock label={t('tournamentDetail.labels.location')} colors={colors}>
                <Text size="base" weight="semibold" color={colors.text}>
                  {tournament.venue_name || tournament.city}
                </Text>
                {venueSecondaryLine ? (
                  <Text size="sm" color={colors.textMuted} style={styles.venueAddress}>
                    {venueSecondaryLine}
                  </Text>
                ) : null}
              </LabeledBlock>
            ) : null}

            {showFeesSection ? (
              <Section title={t('tournamentDetail.dashboard.feesTitle')} colors={colors}>
                <InfoRow
                  label={t('tournamentDetail.labels.entryFee')}
                  value={entryFeeLabel ?? t('tournamentCreation.payments.freeNote')}
                  colors={colors}
                />
                {playerPaysServiceFee && feeTotalLabel ? (
                  <InfoRow
                    label={t('tournamentDetail.labels.youPay')}
                    value={feeTotalLabel}
                    colors={colors}
                  />
                ) : null}
                {refundSummary ? (
                  <StackedRow
                    label={t('tournamentDetail.labels.refundPolicy')}
                    value={refundSummary}
                    colors={colors}
                  />
                ) : null}
                {prizePoolLabel ? (
                  <InfoRow
                    label={t('tournamentDetail.dashboard.prizePool')}
                    value={prizePoolLabel}
                    colors={colors}
                  />
                ) : null}
              </Section>
            ) : null}
          </View>
        )}

        {/* ============================= POINTS ============================= */}
        {currentTabKey === 'points' && pointsLadder && (
          <PointsTab ladder={pointsLadder} isDoubles={isDoubles} colors={colors} t={t} />
        )}

        {/* ============================= RULES ============================== */}
        {currentTabKey === 'rules' && showRulesTab && (
          <View style={styles.tabContent}>
            <View
              style={[
                styles.card,
                styles.rulesCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              {rulesLines.map((line, i) => (
                <View key={i} style={styles.ruleRow}>
                  <View style={[styles.ruleDot, { backgroundColor: colors.primary }]} />
                  <Text size="sm" color={colors.text} style={styles.ruleText}>
                    {line}
                  </Text>
                </View>
              ))}
            </View>
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

      {/* Organizer admin overflow menu (anchored under the header "⋯") */}
      <Modal
        visible={showActionsMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionsMenu(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setShowActionsMenu(false)}>
          <View
            style={[
              styles.menuCard,
              {
                top: insets.top + (Platform.OS === 'ios' ? 44 : 56),
                backgroundColor: colors.cardBackground,
                borderColor: colors.border,
              },
            ]}
          >
            {adminActions.canEdit && (
              <MenuItem
                icon="create-outline"
                label={t('tournamentDetail.actions.editDetails')}
                testID="menu-edit-details"
                onPress={() => {
                  setShowActionsMenu(false);
                  handleEditDetails();
                }}
                colors={colors}
              />
            )}
            {adminActions.canInvite && (
              <MenuItem
                icon="share-social-outline"
                label={t('tournamentDetail.actions.invitePlayers')}
                testID="menu-invite-players"
                showDivider={adminActions.canEdit}
                onPress={() => {
                  setShowActionsMenu(false);
                  handleInvitePlayers();
                }}
                colors={colors}
              />
            )}
            {adminActions.canShareLink && (
              <MenuItem
                icon="link-outline"
                label={t('tournamentDetail.actions.shareInviteLink')}
                testID="menu-share-invite-link"
                showDivider={adminActions.canEdit || adminActions.canInvite}
                onPress={() => {
                  setShowActionsMenu(false);
                  handleShareInviteLink();
                }}
                colors={colors}
              />
            )}
            {adminActions.canReopen && (
              <MenuItem
                icon="lock-open-outline"
                label={t('tournamentDetail.actions.reopenRegistration')}
                testID="menu-reopen-registration"
                showDivider={
                  adminActions.canEdit || adminActions.canInvite || adminActions.canShareLink
                }
                onPress={() => {
                  setShowActionsMenu(false);
                  onReopen();
                }}
                colors={colors}
              />
            )}
            {adminActions.canCancel && (
              <MenuItem
                icon="close-circle-outline"
                label={t('tournamentDetail.actions.cancelTournament')}
                testID="menu-cancel-tournament"
                destructive
                showDivider={adminActions.canEdit || adminActions.canInvite}
                onPress={() => {
                  setShowActionsMenu(false);
                  lightHaptic();
                  setShowCancelModal(true);
                }}
                colors={colors}
              />
            )}
            {adminActions.canArchive && (
              <MenuItem
                icon="archive-outline"
                label={t('tournamentDetail.actions.archiveTournament')}
                testID="menu-archive-tournament"
                showDivider={adminActions.canEdit || adminActions.canCancel}
                onPress={() => {
                  setShowActionsMenu(false);
                  lightHaptic();
                  setShowArchiveModal(true);
                }}
                colors={colors}
              />
            )}
          </View>
        </Pressable>
      </Modal>

      <ConfirmationModal
        visible={showCancelModal && !!tournament}
        title={t('tournamentDetail.cancelModal.title')}
        message={t('tournamentDetail.cancelModal.description')}
        confirmLabel={t('tournamentDetail.cancelModal.confirm')}
        cancelLabel={t('tournamentDetail.cancelModal.keepIt')}
        confirmTestID="confirm-cancel-tournament"
        destructive
        isLoading={cancel.isPending}
        onClose={() => {
          setShowCancelModal(false);
          setCancelReason('');
        }}
        onConfirm={() => {
          if (!tournament) return;
          cancel.mutate({
            tournamentId: tournament.id,
            reason: cancelReason.trim(),
            versionWas: tournament.version,
          });
        }}
        extraContent={
          <TextInput
            style={[
              styles.reasonInput,
              {
                backgroundColor: colors.statusMutedBg,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            placeholder={t('tournamentDetail.cancelModal.reasonPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={cancelReason}
            onChangeText={setCancelReason}
            multiline
            maxLength={300}
            editable={!cancel.isPending}
          />
        }
      />

      <ConfirmationModal
        visible={showArchiveModal && !!tournament}
        title={t('tournamentDetail.archiveModal.title')}
        message={t('tournamentDetail.archiveModal.description')}
        confirmLabel={t('tournamentDetail.archiveModal.confirm')}
        cancelLabel={t('tournamentDetail.archiveModal.keepIt')}
        confirmTestID="confirm-archive-tournament"
        isLoading={archive.isPending}
        onClose={() => setShowArchiveModal(false)}
        onConfirm={() => {
          if (!tournament) return;
          archive.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
        }}
      />

      <ConfirmationModal
        visible={!!removeTarget && !!tournament}
        title={t(
          removeTargetIsPending
            ? 'tournamentDetail.declineModal.title'
            : 'tournamentDetail.removeModal.title'
        )}
        message={t(
          removeTargetIsPending
            ? 'tournamentDetail.declineModal.message'
            : isPaidTournament
              ? // A confirmed registrant on a paid event has paid, and removal
                // now queues their entry back. Say so before the organizer taps.
                'tournamentDetail.removeModal.messagePaid'
              : 'tournamentDetail.removeModal.message',
          { name: removeTarget ? getHumanName(removeTarget, '') : '' }
        )}
        confirmLabel={t(
          removeTargetIsPending
            ? 'tournamentDetail.declineModal.confirm'
            : 'tournamentDetail.removeModal.confirm'
        )}
        cancelLabel={t(
          removeTargetIsPending
            ? 'tournamentDetail.declineModal.keepIt'
            : 'tournamentDetail.removeModal.keepIt'
        )}
        destructive
        isLoading={removeRegistrant.isPending}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
      />
    </SafeAreaView>
  );
};

type MatchRow = Tables<'tournament_matches'>;

const roundLabel = (
  round: number,
  totalRounds: number,
  t: (k: TranslationKey) => string
): string => {
  if (round === totalRounds) return t('tournamentDetail.bracket.final');
  if (round === totalRounds - 1) return t('tournamentDetail.bracket.semifinal');
  if (round === totalRounds - 2) return t('tournamentDetail.bracket.quarterfinal');
  return t('tournamentDetail.bracket.round').replace('{n}', String(round));
};

const slotLabel = (
  regId: string | null,
  isBye: boolean,
  isPhantom: boolean,
  seedByRegId: Map<string, number>,
  nameByRegId: Map<string, string>,
  t: (k: TranslationKey) => string
): string => {
  if (isPhantom) return t('tournamentDetail.bracket.phantom');
  if (isBye) return t('tournamentDetail.bracket.bye');
  if (!regId) return t('tournamentDetail.bracket.tbd');
  const name = nameByRegId.get(regId);
  if (name) return name;
  // Fall back to the seed rank for a determined-but-unnamed slot.
  const seed = seedByRegId.get(regId);
  return seed !== undefined ? seedFallbackLabel(seed, t) : t('tournamentDetail.bracket.tbd');
};

type SlotKind = 'player' | 'bye' | 'tbd' | 'phantom';

const slotKind = (regId: string | null, isBye: boolean, isPhantom: boolean): SlotKind => {
  if (isPhantom) return 'phantom';
  if (isBye) return 'bye';
  if (!regId) return 'tbd';
  return 'player';
};

// The bracket score is a free-form string the organizer types ("e.g., 6-4
// 6-2"). We split it into per-set pairs in written order; the caller orients
// each set onto the right player's row using the known match winner.
const parseScoreSets = (score: string | null): Array<{ a: number; b: number }> => {
  if (!score) return [];
  const sets: Array<{ a: number; b: number }> = [];
  const re = /(\d{1,2})\s*[-–:]\s*(\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(score)) !== null) {
    sets.push({ a: parseInt(m[1], 10), b: parseInt(m[2], 10) });
  }
  return sets;
};

const BracketSection: React.FC<{
  matches: MatchRow[];
  seedByRegId: Map<string, number>;
  nameByRegId: Map<string, string>;
  membersByRegId: Map<string, string[]>;
  slotPlayersByRegId: Map<string, Array<{ id: string; avatarUrl: string | null }>>;
  currentUserId: string | undefined;
  isOrganizer: boolean;
  onMatchPress: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  onOrganizerOverride: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  onPlayerPress: (playerId: string) => void;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
  showTitle?: boolean;
}> = ({
  matches,
  seedByRegId,
  nameByRegId,
  membersByRegId,
  slotPlayersByRegId,
  currentUserId,
  isOrganizer,
  onMatchPress,
  onOrganizerOverride,
  onPlayerPress,
  colors,
  t,
  showTitle = true,
}) => {
  const totalRounds = matches.reduce((max, m) => Math.max(max, m.round_number), 0);
  const byRound = new Map<number, MatchRow[]>();
  for (const m of matches) {
    const arr = byRound.get(m.round_number) ?? [];
    arr.push(m);
    byRound.set(m.round_number, arr);
  }
  const roundNumbers = [...byRound.keys()].sort((a, b) => a - b);

  // Flashscore-style round pager: open on the first round still being played.
  const [selectedIdx, setSelectedIdx] = useState(() => {
    const idx = roundNumbers.findIndex(r =>
      (byRound.get(r) ?? []).some(
        m => !m.winner_registration_id && !(m.player1_is_bye && m.player2_is_bye)
      )
    );
    return idx === -1 ? Math.max(0, roundNumbers.length - 1) : idx;
  });
  const [pageWidth, setPageWidth] = useState(0);
  const pagerRef = useRef<ScrollView>(null);

  // Snap to the selected page once the pager is measured (no animation).
  useEffect(() => {
    if (pageWidth > 0) {
      pagerRef.current?.scrollTo({ x: selectedIdx * pageWidth, animated: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageWidth]);

  const goToRound = (idx: number) => {
    void lightHaptic();
    setSelectedIdx(idx);
    pagerRef.current?.scrollTo({ x: idx * pageWidth, animated: true });
  };

  const onPagerSettle = (offsetX: number) => {
    if (pageWidth <= 0) return;
    const idx = Math.min(roundNumbers.length - 1, Math.max(0, Math.round(offsetX / pageWidth)));
    if (idx !== selectedIdx) setSelectedIdx(idx);
  };

  // Round is "complete" once every real (non-bye) game has a winner — used to
  // mark the chip with a check and drive the per-round progress pill.
  const roundProgress = (round: number) => {
    const real = (byRound.get(round) ?? []).filter(m => !(m.player1_is_bye && m.player2_is_bye));
    const done = real.filter(m => m.winner_registration_id).length;
    return { done, total: real.length, complete: real.length > 0 && done === real.length };
  };

  // Final-round winner → celebratory champion header at the top of the bracket.
  const finalMatch = matches.find(m => m.round_number === totalRounds && m.winner_registration_id);
  const championRegId = finalMatch?.winner_registration_id ?? null;
  const championName = championRegId
    ? (nameByRegId.get(championRegId) ?? seedFallbackLabel(seedByRegId.get(championRegId), t))
    : null;

  const renderMatch = (m: MatchRow) => {
    const isPhantom = m.player1_is_bye && m.player2_is_bye && m.winner_registration_id === null;
    const winnerSlot = !m.winner_registration_id
      ? 0
      : m.winner_registration_id === m.player1_registration_id
        ? 1
        : m.winner_registration_id === m.player2_registration_id
          ? 2
          : 0;
    const isFinalRound = m.round_number === totalRounds;

    const p1Members = m.player1_registration_id
      ? (membersByRegId.get(m.player1_registration_id) ?? [])
      : [];
    const p2Members = m.player2_registration_id
      ? (membersByRegId.get(m.player2_registration_id) ?? [])
      : [];
    // Avatars only for real, named slots (never bye/tbd/phantom).
    const p1SlotPlayers =
      m.player1_registration_id && !m.player1_is_bye && !isPhantom
        ? (slotPlayersByRegId.get(m.player1_registration_id) ?? [])
        : [];
    const p2SlotPlayers =
      m.player2_registration_id && !m.player2_is_bye && !isPhantom
        ? (slotPlayersByRegId.get(m.player2_registration_id) ?? [])
        : [];
    const callerIsParticipant =
      !!currentUserId && (p1Members.includes(currentUserId) || p2Members.includes(currentUserId));
    const slotsReady =
      !m.player1_is_bye &&
      !m.player2_is_bye &&
      !!m.player1_registration_id &&
      !!m.player2_registration_id;
    const isPlayable = m.status === 'pending' && slotsReady;
    // Organizers record results (override) and may also CORRECT a completed
    // match; the RPC rejects (NEXT_MATCH_ALREADY_PLAYED) once the downstream
    // match has its own result. Participants link their own played match.
    const canOrganizerOverride =
      isOrganizer && slotsReady && (m.status === 'pending' || m.status === 'completed');
    const canParticipantAttach = isPlayable && callerIsParticipant;
    const isTappable = canOrganizerOverride || canParticipantAttach;
    // An organizer who is playing in this match acts as a participant on it
    // (link your own played game); the override sheet stays for matches they're
    // not in and for correcting a completed result they can no longer attach.
    const useOrganizerOverride = canOrganizerOverride && !canParticipantAttach;

    const isLive = m.status === 'in_progress';
    const isDisputed = m.status === 'disputed';

    const headerRight = isLive ? (
      <View style={[styles.bmStatusPill, { backgroundColor: colors.statusActiveBg }]}>
        <View style={[styles.bmLiveDot, { backgroundColor: colors.primary }]} />
        <Text size="xs" weight="bold" color={colors.primary}>
          {t('tournamentDetail.bracket.live')}
        </Text>
      </View>
    ) : isDisputed ? (
      <View style={[styles.bmStatusPill, { backgroundColor: colors.cancelledBg }]}>
        <Ionicons name="alert-circle" size={12} color={colors.cancelledText} />
        <Text size="xs" weight="bold" color={colors.cancelledText}>
          {t('tournamentDetail.bracket.disputed')}
        </Text>
      </View>
    ) : null;

    // Per-player set scores: each set's games sit on that player's own row, the
    // set-winner's number bolded per column. The raw string has no fixed player
    // order, so we orient it by the known match winner — whichever side took
    // more sets is the winner's — then map onto rows. A winner with no parseable
    // score gets a check instead.
    const sets = parseScoreSets(m.score);
    const aWins = sets.filter(s => s.a > s.b).length;
    const bWins = sets.filter(s => s.b > s.a).length;
    const winnerOnSideA = aWins >= bWins;
    const winnerGames = sets.map(s => (winnerOnSideA ? s.a : s.b));
    const loserGames = sets.map(s => (winnerOnSideA ? s.b : s.a));
    const p1Games =
      winnerSlot === 1 ? winnerGames : winnerSlot === 2 ? loserGames : sets.map(s => s.a);
    const p2Games =
      winnerSlot === 2 ? winnerGames : winnerSlot === 1 ? loserGames : sets.map(s => s.b);
    const cells1 = p1Games.map((v, i) => ({ value: v, won: v > p2Games[i] }));
    const cells2 = p2Games.map((v, i) => ({ value: v, won: v > p1Games[i] }));

    const statusStrip =
      isLive || isDisputed ? <View style={styles.bmStatusStrip}>{headerRight}</View> : null;

    const matchInner = (
      <>
        {statusStrip}
        <BracketPlayerRow
          label={slotLabel(
            m.player1_registration_id,
            m.player1_is_bye,
            isPhantom,
            seedByRegId,
            nameByRegId,
            t
          )}
          seed={m.player1_registration_id ? seedByRegId.get(m.player1_registration_id) : undefined}
          kind={slotKind(m.player1_registration_id, m.player1_is_bye, isPhantom)}
          isWinner={winnerSlot === 1}
          isFinalWinner={winnerSlot === 1 && isFinalRound}
          decided={winnerSlot !== 0}
          cells={cells1}
          showCheck={winnerSlot === 1 && sets.length === 0}
          players={p1SlotPlayers}
          onPlayerPress={onPlayerPress}
          colors={colors}
        />
        <View style={[styles.bmRowDivider, { backgroundColor: colors.border }]} />
        <BracketPlayerRow
          label={slotLabel(
            m.player2_registration_id,
            m.player2_is_bye,
            isPhantom,
            seedByRegId,
            nameByRegId,
            t
          )}
          seed={m.player2_registration_id ? seedByRegId.get(m.player2_registration_id) : undefined}
          kind={slotKind(m.player2_registration_id, m.player2_is_bye, isPhantom)}
          isWinner={winnerSlot === 2}
          isFinalWinner={winnerSlot === 2 && isFinalRound}
          decided={winnerSlot !== 0}
          cells={cells2}
          showCheck={winnerSlot === 2 && sets.length === 0}
          players={p2SlotPlayers}
          onPlayerPress={onPlayerPress}
          colors={colors}
        />
      </>
    );

    if (isTappable && m.player1_registration_id && m.player2_registration_id) {
      const p1RegId = m.player1_registration_id;
      const p2RegId = m.player2_registration_id;
      const handlePress = useOrganizerOverride
        ? () => onOrganizerOverride(m.id, p1RegId, p2RegId)
        : () => onMatchPress(m.id, p1RegId, p2RegId);
      const a11yLabel = useOrganizerOverride
        ? t('tournamentDetail.bracket.overrideMatch')
        : t('tournamentDetail.bracket.linkMatch');
      const ctaLabel = useOrganizerOverride
        ? t('tournamentDetail.bracket.recordResult')
        : t('tournamentDetail.bracket.addResult');
      return (
        <TouchableOpacity
          key={m.id}
          onPress={handlePress}
          activeOpacity={0.7}
          style={[
            styles.bmCard,
            styles.bmCardPlayable,
            { backgroundColor: colors.cardBackground, borderColor: colors.primary },
          ]}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          testID="bracket-playable-match"
        >
          {matchInner}
          <View
            style={[
              styles.bmFooter,
              { backgroundColor: colors.highlightBg, borderTopColor: colors.border },
            ]}
          >
            <Ionicons
              name={useOrganizerOverride ? 'create-outline' : 'add-circle-outline'}
              size={16}
              color={colors.primary}
            />
            <Text size="sm" weight="semibold" color={colors.primary} style={styles.bmFooterLabel}>
              {ctaLabel}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <View
        key={m.id}
        style={[
          styles.bmCard,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {matchInner}
      </View>
    );
  };

  // Each pair of sibling matches feeds one match in the next round — group them
  // with a connector + chevron that advances the pager, mirroring a real tree.
  const renderRoundPage = (round: number, roundIdx: number) => {
    const roundMatches = (byRound.get(round) ?? []).sort(
      (a, b) => a.match_position - b.match_position
    );
    const hasNextRound = roundIdx < roundNumbers.length - 1;
    const pairs: MatchRow[][] = [];
    for (let i = 0; i < roundMatches.length; i += 2) {
      pairs.push(roundMatches.slice(i, i + 2));
    }
    return (
      <View key={round} style={[styles.bracketPage, { width: pageWidth }]}>
        {pairs.map(pair => (
          <View key={pair[0].id} style={styles.bmPair}>
            <View style={styles.bmPairCards}>{pair.map(renderMatch)}</View>
            {hasNextRound && pair.length === 2 && (
              <View style={styles.bmConnector}>
                <View style={[styles.bmConnectorSpine, { backgroundColor: colors.border }]} />
                <View style={[styles.bmConnectorArm, { backgroundColor: colors.border }]} />
                <TouchableOpacity
                  onPress={() => goToRound(roundIdx + 1)}
                  activeOpacity={0.7}
                  style={[
                    styles.bmConnectorBtn,
                    { backgroundColor: colors.statusMutedBg, borderColor: colors.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={roundLabel(roundNumbers[roundIdx + 1], totalRounds, t)}
                >
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </View>
    );
  };

  const sel = roundProgress(roundNumbers[selectedIdx] ?? totalRounds);

  return (
    <View style={styles.section}>
      {showTitle && (
        <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
          {t('tournamentDetail.bracket.sectionTitle').toUpperCase()}
        </Text>
      )}

      {/* Round selector chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bracketChipsRow}
      >
        {roundNumbers.map((round, idx) => {
          const selected = idx === selectedIdx;
          const { complete } = roundProgress(round);
          return (
            <TouchableOpacity
              key={round}
              onPress={() => goToRound(idx)}
              activeOpacity={0.85}
              style={[
                styles.bracketChip,
                {
                  backgroundColor: selected ? colors.primary : colors.cardBackground,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              {complete && (
                <Ionicons
                  name="checkmark-circle"
                  size={13}
                  color={selected ? '#ffffff' : colors.primary}
                />
              )}
              <Text
                size="xs"
                weight={selected ? 'semibold' : 'medium'}
                color={selected ? '#ffffff' : colors.textMuted}
              >
                {roundLabel(round, totalRounds, t)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Selected-round header with progress */}
      <View style={styles.bmRoundHeader}>
        <Text size="base" weight="bold" color={colors.text}>
          {roundLabel(roundNumbers[selectedIdx] ?? totalRounds, totalRounds, t)}
        </Text>
        {sel.total > 0 && (
          <View style={[styles.bmProgressPill, { backgroundColor: colors.statusMutedBg }]}>
            <Ionicons
              name={sel.complete ? 'checkmark-done' : 'ellipse-outline'}
              size={12}
              color={sel.complete ? colors.statusPositiveText : colors.textMuted}
            />
            <Text size="xs" weight="semibold" color={colors.textMuted}>
              {t('tournamentDetail.bracket.gamesProgress')
                .replace('{done}', String(sel.done))
                .replace('{total}', String(sel.total))}
            </Text>
          </View>
        )}
      </View>

      {/* Round pager — swipe or tap a chip to slide between rounds */}
      <View style={styles.bmPager} onLayout={e => setPageWidth(e.nativeEvent.layout.width)}>
        {pageWidth > 0 && (
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={e => onPagerSettle(e.nativeEvent.contentOffset.x)}
          >
            {roundNumbers.map((round, roundIdx) => renderRoundPage(round, roundIdx))}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

const BracketPlayerRow: React.FC<{
  label: string;
  seed?: number;
  kind: SlotKind;
  isWinner: boolean;
  isFinalWinner: boolean;
  decided: boolean;
  cells: Array<{ value: number; won: boolean }>;
  showCheck: boolean;
  players: Array<{ id: string; avatarUrl: string | null }>;
  onPlayerPress: (playerId: string) => void;
  colors: ScreenColors;
}> = ({
  label,
  seed,
  kind,
  isWinner,
  isFinalWinner,
  decided,
  cells,
  showCheck,
  players,
  onPlayerPress,
  colors,
}) => {
  const isPlayer = kind === 'player';
  const isLoser = decided && isPlayer && !isWinner;
  const winnerColor = isFinalWinner ? colors.championText : colors.primary;
  // Winner: bright + bold. Loser: muted. Undecided / non-player: neutral.
  const nameColor = !isPlayer || isLoser ? colors.textMuted : colors.text;
  // Within the score column, the set-winner's number is emphasized per column.
  const wonColor = isFinalWinner ? colors.championText : colors.text;

  return (
    <View style={styles.bmRow}>
      {isFinalWinner && (
        <Ionicons name="trophy" size={14} color={colors.championText} style={styles.bmRowCrown} />
      )}
      {isPlayer && players.length > 0 && (
        <View style={[styles.bmAvatarCluster, isLoser && styles.bmAvatarClusterDim]}>
          {players.map((p, i) => (
            <TouchableOpacity
              key={p.id}
              onPress={() => onPlayerPress(p.id)}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              style={[
                styles.bmAvatar,
                { backgroundColor: colors.highlightBg },
                i > 0 && [styles.bmAvatarStacked, { borderColor: colors.cardBackground }],
              ]}
            >
              {p.avatarUrl ? (
                <Image source={{ uri: p.avatarUrl }} style={styles.bmAvatarImg} />
              ) : (
                <Ionicons name="person" size={13} color={colors.textMuted} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.bmNameWrap}>
        <Text
          size="sm"
          weight={isWinner ? 'bold' : 'medium'}
          color={nameColor}
          numberOfLines={1}
          style={styles.bmNameText}
        >
          {label}
        </Text>
        {isPlayer && seed !== undefined && (
          <Text size="xs" weight="medium" color={colors.textMuted}>
            ({seed})
          </Text>
        )}
      </View>
      {cells.length > 0 ? (
        <View style={styles.bmSetRow}>
          {cells.map((c, i) => (
            <Text
              key={i}
              size="sm"
              weight={c.won ? 'bold' : 'regular'}
              color={c.won ? wonColor : colors.textMuted}
              style={styles.bmSetCell}
            >
              {c.value}
            </Text>
          ))}
        </View>
      ) : showCheck ? (
        <Ionicons name="checkmark" size={16} color={winnerColor} style={styles.bmScore} />
      ) : null}
    </View>
  );
};

/** Row inside the header "⋯" overflow menu. */
const MenuItem: React.FC<{
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  showDivider?: boolean;
  colors: ScreenColors;
  testID?: string;
}> = ({ label, icon, onPress, destructive, showDivider, colors, testID }) => {
  const fg = destructive ? colors.danger : colors.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      testID={testID}
      style={[
        styles.menuItem,
        showDivider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={18} color={fg} />
      <Text size="base" weight="medium" color={fg}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
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
  playersInviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
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
  heroBannerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    marginLeft: 'auto',
    flexShrink: 1,
  },
  heroPrizeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    backgroundColor: accent[300],
  },
  heroPointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    backgroundColor: 'rgba(255,255,255,0.94)',
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
  aboutBlock: {
    padding: spacingPixels[4],
    gap: spacingPixels[2],
  },
  aboutText: {
    lineHeight: 20,
  },
  aboutMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
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
  playersPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  playersPreviewAvatars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  playersPreviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  playersPreviewAvatarOverlap: {
    marginLeft: -10,
  },
  playersPreviewAvatarImg: {
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
  screenScroll: {
    flex: 1,
  },
  screenScrollContent: {
    flexGrow: 1,
  },
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
  rulesCard: {
    paddingVertical: spacingPixels[1],
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2.5],
  },
  ruleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  ruleText: {
    flex: 1,
    lineHeight: 20,
  },
  playersTabContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  pointsHero: {
    alignItems: 'center',
    gap: spacingPixels[1],
    padding: spacingPixels[5],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  pointsHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[1],
  },
  pointsHeroValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacingPixels[1.5],
  },
  pointsHeroCaption: {
    textAlign: 'center',
    lineHeight: 19,
  },
  pointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pointsRowLast: {
    borderBottomWidth: 0,
  },
  pointsRowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointsRowLabel: {
    flex: 1,
  },
  pointsRowValue: {
    fontVariant: ['tabular-nums'],
  },
  pointsNoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusBadge: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  liveIndicatorContainer: {
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveRing: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowColor: secondary[500],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 2,
  },
  stackedBlock: {
    padding: spacingPixels[4],
    gap: spacingPixels[1],
  },
  venueAddress: {
    lineHeight: 18,
  },
  infoRowLabel: {
    marginRight: spacingPixels[3],
  },
  infoRowValue: {
    flex: 1,
    textAlign: 'right',
  },
  stackedRow: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[1],
  },
  stackedValue: {
    lineHeight: 20,
  },
  section: {
    marginBottom: spacingPixels[5],
  },
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
  stepperCard: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  stepperStep: {
    alignItems: 'center',
    gap: spacingPixels[1],
    width: 72,
  },
  stepperDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperConnector: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    marginTop: 15,
    marginHorizontal: -spacingPixels[3],
  },
  ctaCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    padding: spacingPixels[4],
    gap: spacingPixels[3],
  },
  ctaCardHeader: {
    flexDirection: 'row',
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
  ctaCardDescription: {
    lineHeight: 19,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    paddingVertical: spacingPixels[3.5],
  },
  statSegment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacingPixels[2],
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: spacingPixels[0.5],
  },
  participantEmpty: {
    alignItems: 'center',
    paddingVertical: spacingPixels[8],
    paddingHorizontal: spacingPixels[5],
    gap: spacingPixels[2],
  },
  participantEmptyDisc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[1],
  },
  participantEmptyText: {
    textAlign: 'center',
  },
  participantEmptyStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: spacingPixels[5],
    marginTop: spacingPixels[3],
    paddingTop: spacingPixels[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  participantEmptyStat: {
    alignItems: 'center',
    gap: 2,
  },
  participantEmptyStatDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  pendingSection: {
    marginBottom: spacingPixels[4],
  },
  segmentBar: {
    marginBottom: spacingPixels[4],
  },
  myMatchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderWidth: 1.5,
  },
  myMatchMain: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  myMatchStateText: {
    flex: 1,
  },
  roundChatBtn: {
    marginTop: spacingPixels[2],
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
  headerMenuButton: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
  },
  menuBackdrop: {
    flex: 1,
  },
  menuCard: {
    position: 'absolute',
    right: spacingPixels[3],
    minWidth: 210,
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacingPixels[1],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3.5],
  },
  bracketChipsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    paddingBottom: spacingPixels[3],
  },
  bracketChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  bmRoundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
    paddingHorizontal: spacingPixels[1],
  },
  bmProgressPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  bmPager: {
    minHeight: 1,
  },
  bracketPage: {
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[1],
    paddingHorizontal: spacingPixels[1],
  },
  bmPair: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: spacingPixels[5],
  },
  bmPairCards: {
    flex: 1,
    gap: spacingPixels[2],
  },
  bmConnector: {
    width: 48,
  },
  bmConnectorSpine: {
    position: 'absolute',
    left: 8,
    top: '25%',
    bottom: '25%',
    width: 2,
    borderRadius: 1,
  },
  bmConnectorArm: {
    position: 'absolute',
    left: 8,
    top: '50%',
    width: 16,
    height: 2,
    marginTop: -1,
  },
  bmConnectorBtn: {
    position: 'absolute',
    right: 0,
    top: '50%',
    width: 30,
    height: 30,
    marginTop: -15,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bmCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  bmCardPlayable: {
    borderWidth: 1.5,
  },
  bmStatusStrip: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacingPixels[3],
    paddingTop: spacingPixels[2],
  },
  bmStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  bmLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  bmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
  },
  bmRowCrown: {
    marginRight: -spacingPixels[1],
  },
  bmAvatarCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bmAvatarClusterDim: {
    opacity: 0.6,
  },
  bmAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bmAvatarStacked: {
    marginLeft: -8,
    borderWidth: 1.5,
  },
  bmAvatarImg: {
    width: '100%',
    height: '100%',
  },
  bmRowDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacingPixels[3],
  },
  bmNameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
  },
  bmNameText: {
    flexShrink: 1,
  },
  bmScore: {
    minWidth: 18,
    textAlign: 'right',
  },
  bmSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  bmSetCell: {
    minWidth: 14,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  bmFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bmFooterLabel: {
    flex: 1,
  },
  cancelledNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  reasonInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    fontSize: 15,
    minHeight: 72,
    marginBottom: spacingPixels[4],
    textAlignVertical: 'top',
  },
});

export default TournamentDetail;
