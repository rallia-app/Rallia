/**
 * SessionDetail Screen
 *
 * Per-session view: scheduled details, member confirm/decline CTA, presence
 * roster, and organizer publish/cancel affordances (V7 slice).
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V7
 *       specs/17-leagues-tournaments/leagues.md §Sessions
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SheetManager } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  secondary,
} from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic, getHumanName } from '@rallia/shared-utils';
import {
  useTheme,
  useAuth,
  useLeague,
  useMyLeagueMembership,
  useSession,
  useSessionPresence,
  useMySessionPresence,
  useConfirmSessionPresence,
  usePublishSession,
  useCancelSession,
  useSessionMatches,
  useGenerateSessionSheet,
  useSetSessionMatchLock,
  useSports,
  useOpenSessionPairingChat,
  useWithdrawSessionMember,
} from '@rallia/shared-hooks';
import { isLeagueOrganizer } from '@rallia/shared-services';
import type {
  SessionPresenceWithProfile,
  SessionMatch,
  PresenceStatus,
} from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import { SheetDateField } from '#/features/leagues/components/SheetDateField';
import { ConfirmationModal } from '#/components/ConfirmationModal';

import { useTranslation, useScrollBottomInset, type TranslationKey } from '../hooks';
import * as Analytics from '../services/analytics';
import type { RootStackParamList } from '../navigation';

type Route = RouteProp<RootStackParamList, 'SessionDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type SessionStatus = Enums<'session_status'>;

const SESSION_STATUS_KEY: Record<SessionStatus, string> = {
  draft: 'sessionDetail.status.draft',
  published: 'sessionDetail.status.published',
  in_progress: 'sessionDetail.status.inProgress',
  completed: 'sessionDetail.status.completed',
  cancelled: 'sessionDetail.status.cancelled',
};

const PRESENCE_GROUPS: ReadonlyArray<{ status: PresenceStatus; key: string }> = [
  { status: 'confirmed', key: 'sessionDetail.roster.confirmed' },
  { status: 'waitlisted', key: 'sessionDetail.roster.waitlisted' },
  { status: 'pending', key: 'sessionDetail.roster.pending' },
  { status: 'declined', key: 'sessionDetail.roster.declined' },
];

export const SessionDetail: React.FC = () => {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const bottomInset = useScrollBottomInset();
  const toast = useToast();
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;
  const route = useRoute<Route>();
  const navigation = useNavigation<NavigationProp>();
  const { sessionId, leagueId } = route.params;
  const isDark = theme === 'dark';
  const tc = isDark ? darkTheme : lightTheme;

  const colors = useMemo(
    () => ({
      background: tc.background,
      card: tc.card,
      text: tc.foreground,
      textMuted: tc.mutedForeground,
      border: tc.border,
      primary: isDark ? primary[500] : primary[600],
      positiveBg: isDark ? '#16a34a30' : '#dcfce7',
      positiveText: isDark ? '#86efac' : '#15803d',
      neutralBg: isDark ? neutral[700] : neutral[200],
      neutralText: isDark ? neutral[100] : neutral[700],
      mutedBg: isDark ? neutral[800] : neutral[100],
      mutedText: isDark ? neutral[400] : neutral[500],
      danger: isDark ? secondary[400] : secondary[500],
      dangerBg: isDark ? `${secondary[500]}30` : `${secondary[500]}1f`,
      highlightBg: isDark ? primary[950] : primary[50],
      highlightBorder: isDark ? `${primary[400]}40` : `${primary[500]}20`,
    }),
    [tc, isDark]
  );

  const { data: league } = useLeague(leagueId);
  const { data: sess, isLoading, isError, refetch } = useSession(sessionId);
  const { data: presence = [], refetch: refetchPresence } = useSessionPresence(sessionId);
  const { data: myPresence, refetch: refetchMine } = useMySessionPresence(sessionId, userId);
  const { data: myMembership } = useMyLeagueMembership(leagueId, userId);
  const { data: matches = [], refetch: refetchMatches } = useSessionMatches(sessionId);

  const isOrganizer = league ? isLeagueOrganizer(league, userId) : false;
  const isActiveMember = myMembership?.status === 'active';
  const seasonId = sess?.season_id ?? '';
  const hasSheet = matches.length > 0;

  const invalidate = useCallback(() => {
    void refetch();
    void refetchPresence();
    void refetchMine();
    void refetchMatches();
  }, [refetch, refetchPresence, refetchMine, refetchMatches]);

  const nameOf = useCallback(
    (id: string): string => {
      const profile = presence.find(p => p.user_id === id)?.profile;
      return profile
        ? getHumanName(profile, t('sessionDetail.unknownMember'))
        : t('sessionDetail.unknownMember');
    },
    [presence, t]
  );

  // Doubles rows carry two ids a side; joining with & covers both formats.
  const teamLabel = useCallback((ids: string[]): string => ids.map(nameOf).join(' & '), [nameOf]);

  const isDoubles = (sess?.formats_allowed?.[0] ?? 'singles') !== 'singles';

  // Preferred partner for doubles nights. undefined = untouched (falls back to
  // the preference already stored on my presence row), null = explicitly none.
  const [partnerChoice, setPartnerChoice] = useState<string | null | undefined>(undefined);
  const selectedPartner =
    partnerChoice === undefined ? (myPresence?.preferred_partner_id ?? null) : partnerChoice;

  const partnerCandidates = useMemo(
    () => presence.filter(p => p.user_id !== userId && p.status !== 'declined'),
    [presence, userId]
  );

  const byeNames = useMemo(() => {
    const paired = new Set<string>();
    matches.forEach((m: SessionMatch) => {
      m.team_a_user_ids.forEach(u => paired.add(u));
      m.team_b_user_ids.forEach(u => paired.add(u));
    });
    return presence
      .filter(p => p.status === 'confirmed' && !paired.has(p.user_id))
      .map(p =>
        p.profile
          ? getHumanName(p.profile, t('sessionDetail.unknownMember'))
          : t('sessionDetail.unknownMember')
      );
  }, [matches, presence, t]);

  const confirmedCount = useMemo(
    () => presence.filter(p => p.status === 'confirmed').length,
    [presence]
  );

  const { mutate: confirm, isPending: isConfirming } = useConfirmSessionPresence(sessionId, {
    onSuccess: row => {
      successHaptic();
      toast.success(
        row.status === 'confirmed'
          ? t('sessionDetail.toasts.confirmed')
          : row.status === 'waitlisted'
            ? t('sessionDetail.toasts.waitlisted')
            : t('sessionDetail.toasts.declined')
      );
      invalidate();
    },
    onError: e => {
      warningHaptic();
      toast.error(
        e.message === 'ENROLLMENT_REMOVED'
          ? t('leagueDetail.paid.errors.enrollmentRemoved')
          : e.message || t('sessionDetail.errors.generic')
      );
    },
  });

  const { mutate: publish, isPending: isPublishing } = usePublishSession(seasonId, {
    onSuccess: row => {
      successHaptic();
      setShowPublishModal(false);
      toast.success(t('sessionDetail.toasts.published'));
      Analytics.sessionPublishedAnalytics({
        leagueId,
        sessionId: row.id,
        memberCount: presence.length,
      });
      invalidate();
    },
    onError: e => {
      warningHaptic();
      toast.error(
        e.message?.includes('INVALID_DEADLINE')
          ? t('sessionDetail.publishModal.invalidDeadline')
          : e.message || t('sessionDetail.errors.generic')
      );
    },
  });

  const { mutate: withdrawMember, isPending: isWithdrawing } = useWithdrawSessionMember(sessionId, {
    onSuccess: () => {
      void successHaptic();
      toast.success(t('sessionDetail.roster.withdrawn'));
      invalidate();
    },
    onError: e => {
      void warningHaptic();
      toast.error(e.message || t('sessionDetail.errors.generic'));
    },
  });

  const { mutate: cancel, isPending: isCancelling } = useCancelSession(seasonId, {
    onSuccess: () => {
      successHaptic();
      setShowCancelModal(false);
      toast.success(t('sessionDetail.toasts.cancelled'));
      Analytics.sessionCancelledAnalytics({ sessionId, confirmedCount });
      invalidate();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('sessionDetail.errors.generic'));
    },
  });

  // "Pour une ligue, le concept de bye ne devrait pas s'appliquer" — the bye
  // stays (removing it would block generation whenever someone does not show,
  // and the rotation that scores it as attendance just shipped), but an odd
  // roster is now a decision rather than a surprise: the organizer is told who
  // sits out and can withdraw or add someone first.
  const oddRoster = confirmedCount % 2 === 1 && (sess?.rounds ?? 1) <= 1;

  const { mutate: genSheet, isPending: isGenerating } = useGenerateSessionSheet(sessionId, {
    onSuccess: () => {
      successHaptic();
      toast.success(t('sessionDetail.sheet.ready'));
      Analytics.sessionSheetGeneratedAnalytics({ sessionId, regenerated: hasSheet });
      invalidate();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('sessionDetail.errors.generic'));
    },
  });

  const { mutate: setLock, isPending: isLocking } = useSetSessionMatchLock(sessionId, {
    onSuccess: () => {
      successHaptic();
      invalidate();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('sessionDetail.errors.generic'));
    },
  });

  const { sports } = useSports();
  const isPickleballLeague = useMemo(
    () => sports.find(sp => sp.id === league?.sport_id)?.name === 'pickleball',
    [sports, league?.sport_id]
  );

  const isScored = useCallback(
    (m: SessionMatch) =>
      m.status === 'completed' || m.status === 'retired' || m.status === 'walkover',
    []
  );

  const isParticipantOf = useCallback(
    (m: SessionMatch) => !!userId && [...m.team_a_user_ids, ...m.team_b_user_ids].includes(userId),
    [userId]
  );

  // session_publish already defaults the deadline to scheduled_at - 24h
  // (clamped up for short-notice sessions). The organizer was simply never
  // asked, so the modal opens pre-filled with exactly that default: accepting it
  // is byte-identical to the old behaviour.
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishDeadline, setPublishDeadline] = useState<Date | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // SheetDateField carries its own colour contract; map the screen's palette on.
  const dateFieldColors = useMemo(
    () => ({
      border: colors.border,
      text: colors.text,
      textMuted: colors.textMuted,
      primary: colors.primary,
      cardBackground: colors.card,
    }),
    [colors]
  );

  const defaultDeadline = useCallback((): Date => {
    const start = sess ? new Date(sess.scheduled_at) : new Date();
    const dayBefore = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    return dayBefore.getTime() > Date.now() ? dayBefore : start;
  }, [sess]);

  const sessionScoreable = !!sess && (sess.status === 'published' || sess.status === 'in_progress');

  // Scoring the last match completes the session, which used to freeze every
  // score in it. No clock here on purpose: session_record_score owns the 24h
  // window (20260730170000) and answers CORRECTION_WINDOW_CLOSED with copy that
  // explains it, so the screen keeps the affordance reachable on a finished
  // session rather than re-deriving a deadline it cannot enforce.
  const sessionCorrectable = !!sess && sess.status === 'completed' && !!sess.completed_at;

  const canEditScore = isOrganizer && (sessionScoreable || sessionCorrectable);

  // The result that leaves no playable match behind closes the session, so it
  // gets a confirmation the way a tournament final does.
  const isSessionDecider = useCallback(
    (m: SessionMatch) =>
      !isScored(m) && matches.every(x => x.id === m.id || isScored(x) || x.status === 'cancelled'),
    [matches, isScored]
  );

  // The lock survives a regenerate: lt_run_session_sheet preserves locked rows
  // when it rebuilds the sheet. It used to render only next to an already-scored
  // match, which is the one state where it is pointless — an unscored pairing is
  // exactly what an organizer wants to pin before regenerating.
  const renderLockToggle = useCallback(
    (m: SessionMatch) => (
      <TouchableOpacity
        onPress={() => {
          lightHaptic();
          setLock({ sessionMatchId: m.id, locked: !m.locked, versionWas: m.version });
        }}
        disabled={isLocking}
        accessibilityLabel={
          m.locked ? t('sessionDetail.sheet.unlock') : t('sessionDetail.sheet.lock')
        }
        style={styles.lockButton}
        testID="cta-lock-match"
      >
        <Ionicons
          name={m.locked ? 'lock-closed' : 'lock-open-outline'}
          size={18}
          color={m.locked ? colors.primary : colors.textMuted}
        />
      </TouchableOpacity>
    ),
    [setLock, isLocking, t, colors.primary, colors.textMuted]
  );

  // Organizer/admin records an authoritative result directly (override path).
  const canOverride = useCallback(
    (m: SessionMatch) => sessionScoreable && isOrganizer && !isScored(m),
    [sessionScoreable, isOrganizer, isScored]
  );

  // A participant with an open pairing can organize the game with their
  // opponent in the pairing chat, before or after a game has been agreed on.
  const canOrganize = useCallback(
    (m: SessionMatch) =>
      sessionScoreable &&
      !isOrganizer &&
      isParticipantOf(m) &&
      !isScored(m) &&
      !m.is_drill &&
      !m.is_three_player,
    [sessionScoreable, isOrganizer, isParticipantOf, isScored]
  );

  // A participant settles their pairing by linking a played, verified casual
  // match — the canonical flow (feedback + rating + confirmation come with it).
  // A pairing organized in chat is already bound to its game, so there is
  // nothing left to link: the score arrives through that game's confirmation.
  const canLink = useCallback((m: SessionMatch) => canOrganize(m) && !m.match_id, [canOrganize]);

  const openLinkMatch = useCallback(
    (m: SessionMatch) => {
      if (!league) return;
      lightHaptic();
      void SheetManager.show('session-link-match', {
        payload: {
          sessionMatchId: m.id,
          sessionId,
          seasonId,
          sportId: league.sport_id,
          entryFormat: m.format,
          team1UserIds: m.team_a_user_ids,
          team2UserIds: m.team_b_user_ids,
          onSuccess: () => invalidate(),
        },
      });
    },
    [league, sessionId, seasonId, invalidate]
  );

  // Open (get-or-create) the per-pairing chat and drop the caller in, so they
  // can agree on a time with their opponent. The game they create there is
  // attached to this pairing before it's played, and that chat becomes the
  // match chat, so confirming the score settles the pairing on its own.
  const openPairingChat = useOpenSessionPairingChat();
  const handleOrganizeInChat = useCallback(
    (m: SessionMatch) => {
      lightHaptic();
      openPairingChat.mutate(m.id, {
        onSuccess: conversationId => {
          if (!conversationId) return;
          navigation.navigate('ChatConversation', {
            conversationId,
            title: league?.name,
          });
        },
        onError: () => toast.error(t('sessionDetail.pairingChat.error')),
      });
    },
    [openPairingChat, navigation, league?.name, toast, t]
  );

  const openScoreEntry = useCallback(
    (m: SessionMatch) => {
      lightHaptic();
      void SheetManager.show('session-record-score', {
        payload: {
          sessionMatchId: m.id,
          sessionId,
          seasonId,
          versionWas: m.version,
          teamAName: teamLabel(m.team_a_user_ids),
          teamBName: teamLabel(m.team_b_user_ids),
          isPickleball: isPickleballLeague,
          matchFormat: sess?.match_format,
          isEdit: isScored(m),
          isDecider: isSessionDecider(m),
          onSuccess: () => {
            toast.success(t('sessionDetail.score.saved'));
            Analytics.sessionScoreSubmittedAnalytics({ sessionId });
            invalidate();
          },
        },
      });
    },
    [
      sessionId,
      seasonId,
      nameOf,
      isPickleballLeague,
      sess?.match_format,
      isScored,
      isSessionDecider,
      toast,
      t,
      invalidate,
    ]
  );

  const handleConfirm = useCallback(
    (status: PresenceStatus) => {
      if (isConfirming || !sess) return;
      lightHaptic();
      confirm({
        status,
        partnerId: status === 'confirmed' && isDoubles ? (selectedPartner ?? undefined) : undefined,
      });
      if (status === 'confirmed') {
        Analytics.sessionConfirmedAnalytics({
          sessionId,
          partnerProvided: isDoubles && !!selectedPartner,
        });
      } else if (status === 'declined') {
        Analytics.sessionDeclinedAnalytics({ sessionId });
      }
    },
    [confirm, isConfirming, sess, sessionId, isDoubles, selectedPartner]
  );

  const formatDateTime = useCallback(
    (iso: string): string =>
      new Date(iso).toLocaleString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    [locale]
  );

  if (isLoading) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !sess) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('sessionDetail.loadError')}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text size="base" weight="semibold" color="#fff">
              {t('sessionDetail.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const deadlinePassed =
    !!sess.confirmation_deadline_at && new Date(sess.confirmation_deadline_at) < new Date();
  const canConfirm = isActiveMember && sess.status === 'published' && !deadlinePassed;
  const statusBadge = (status: SessionStatus) => {
    const positive = status === 'published' || status === 'in_progress';
    const muted = status === 'completed' || status === 'cancelled';
    return {
      bg: positive ? colors.positiveBg : muted ? colors.mutedBg : colors.neutralBg,
      fg: positive ? colors.positiveText : muted ? colors.mutedText : colors.neutralText,
    };
  };
  const badge = statusBadge(sess.status);

  // Bottom inset goes in the ScrollView's contentContainerStyle, not on the
  // wrapper, so content scrolls under the home indicator instead of stopping
  // above it.
  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
            <Text size="xs" weight="semibold" color={badge.fg}>
              {t(SESSION_STATUS_KEY[sess.status] as TranslationKey)}
            </Text>
          </View>
          <Text size="2xl" weight="bold" color={colors.text} style={styles.title}>
            {sess.name}
          </Text>
          {sess.status === 'cancelled' ? (
            <View style={[styles.cancelledNotice, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <View style={styles.cancelledNoticeBody}>
                <Text size="sm" weight="semibold" color={colors.danger}>
                  {t('sessionDetail.cancelledNotice.title')}
                </Text>
                {sess.cancelled_reason ? (
                  <Text size="xs" color={colors.danger}>
                    {t('sessionDetail.cancelledNotice.reason', { reason: sess.cancelled_reason })}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={16} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted}>
              {formatDateTime(sess.scheduled_at)} · {sess.duration_minutes} min
            </Text>
          </View>
          {sess.venue_name ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={16} color={colors.textMuted} />
              <Text size="sm" color={colors.textMuted} numberOfLines={1}>
                {sess.venue_name}
              </Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={16} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted}>
              {sess.capacity != null
                ? t('sessionDetail.confirmedOfCapacity', {
                    count: String(confirmedCount),
                    capacity: String(sess.capacity),
                  })
                : t('sessionDetail.confirmedCount', { count: String(confirmedCount) })}
            </Text>
          </View>
          {sess.confirmation_deadline_at ? (
            <View style={styles.metaRow}>
              <Ionicons name="hourglass-outline" size={16} color={colors.textMuted} />
              <Text size="sm" color={colors.textMuted}>
                {t('sessionDetail.confirmBy', {
                  date: formatDateTime(sess.confirmation_deadline_at),
                })}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Member confirm CTA */}
        {canConfirm && (
          <View
            style={[
              styles.ctaCard,
              { backgroundColor: colors.highlightBg, borderColor: colors.highlightBorder },
            ]}
          >
            <Text size="base" weight="bold" color={colors.text}>
              {myPresence?.status === 'confirmed'
                ? t('sessionDetail.cta.confirmedTitle')
                : myPresence?.status === 'waitlisted'
                  ? t('sessionDetail.cta.waitlistedTitle')
                  : myPresence?.status === 'declined'
                    ? t('sessionDetail.cta.declinedTitle')
                    : t('sessionDetail.cta.title')}
            </Text>
            {isDoubles && partnerCandidates.length > 0 && (
              <View style={styles.partnerBlock}>
                <Text size="sm" weight="semibold" color={colors.text}>
                  {t('sessionDetail.partner.label')}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.partnerChips}
                >
                  <TouchableOpacity
                    onPress={() => {
                      lightHaptic();
                      setPartnerChoice(null);
                    }}
                    style={[
                      styles.partnerChip,
                      {
                        borderColor: selectedPartner === null ? colors.primary : colors.border,
                        backgroundColor:
                          selectedPartner === null ? colors.highlightBg : colors.card,
                      },
                    ]}
                    testID="partner-chip-none"
                  >
                    <Text
                      size="sm"
                      weight={selectedPartner === null ? 'semibold' : 'regular'}
                      color={selectedPartner === null ? colors.primary : colors.text}
                    >
                      {t('sessionDetail.partner.none')}
                    </Text>
                  </TouchableOpacity>
                  {partnerCandidates.map(p => {
                    const selected = selectedPartner === p.user_id;
                    return (
                      <TouchableOpacity
                        key={p.user_id}
                        onPress={() => {
                          lightHaptic();
                          setPartnerChoice(selected ? null : p.user_id);
                        }}
                        style={[
                          styles.partnerChip,
                          {
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected ? colors.highlightBg : colors.card,
                          },
                        ]}
                        testID={`partner-chip-${p.user_id}`}
                      >
                        <Text
                          size="sm"
                          weight={selected ? 'semibold' : 'regular'}
                          color={selected ? colors.primary : colors.text}
                        >
                          {nameOf(p.user_id)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <Text size="xs" color={colors.textMuted}>
                  {t('sessionDetail.partner.hint')}
                </Text>
              </View>
            )}
            <View style={styles.ctaButtons}>
              <TouchableOpacity
                onPress={() => handleConfirm('confirmed')}
                disabled={isConfirming || myPresence?.status === 'confirmed'}
                style={[
                  styles.ctaButton,
                  { backgroundColor: colors.primary },
                  (isConfirming || myPresence?.status === 'confirmed') && styles.disabled,
                ]}
                testID="cta-confirm-presence"
              >
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text size="sm" weight="semibold" color="#fff">
                  {t('sessionDetail.cta.confirm')}
                </Text>
              </TouchableOpacity>
              {/* Withdrawing is a negative action and read as neutral in a plain
                  white outline, so it carries the danger tone the cancel controls
                  already use rather than looking like a second confirm. */}
              <TouchableOpacity
                onPress={() => handleConfirm('declined')}
                disabled={isConfirming || myPresence?.status === 'declined'}
                style={[
                  styles.ctaButton,
                  styles.ctaButtonOutline,
                  { borderColor: colors.danger },
                  (isConfirming || myPresence?.status === 'declined') && styles.disabled,
                ]}
                testID="cta-decline-presence"
              >
                <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
                <Text size="sm" weight="semibold" color={colors.danger}>
                  {t('sessionDetail.cta.decline')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Organizer actions */}
        {isOrganizer && sess.status === 'draft' && (
          <TouchableOpacity
            onPress={() => {
              lightHaptic();
              setPublishDeadline(defaultDeadline());
              setShowPublishModal(true);
            }}
            disabled={isPublishing}
            style={[
              styles.fullButton,
              { backgroundColor: colors.primary },
              isPublishing && styles.disabled,
            ]}
            testID="cta-publish-session"
          >
            <Ionicons name="megaphone-outline" size={18} color="#fff" />
            <Text size="base" weight="semibold" color="#fff">
              {isPublishing
                ? t('sessionDetail.actions.publishing')
                : t('sessionDetail.actions.publish')}
            </Text>
          </TouchableOpacity>
        )}
        {isOrganizer &&
          (sess.status === 'draft' ||
            sess.status === 'published' ||
            sess.status === 'in_progress') && (
            <TouchableOpacity
              onPress={() => {
                warningHaptic();
                setCancelReason('');
                setShowCancelModal(true);
              }}
              disabled={isCancelling}
              style={[
                styles.fullButtonOutline,
                { borderColor: colors.danger },
                isCancelling && styles.disabled,
              ]}
              testID="cta-cancel-session"
            >
              <Text size="base" weight="semibold" color={colors.danger}>
                {isCancelling
                  ? t('sessionDetail.actions.cancelling')
                  : t('sessionDetail.actions.cancel')}
              </Text>
            </TouchableOpacity>
          )}

        {/* Match sheet */}
        {(hasSheet || (isOrganizer && sess.status === 'published')) && (
          <View style={styles.section}>
            <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
              {t('sessionDetail.sheet.title').toUpperCase()}
            </Text>
            <View
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {!hasSheet ? (
                <Text size="sm" color={colors.textMuted}>
                  {t('sessionDetail.sheet.empty')}
                </Text>
              ) : (
                matches.map((m: SessionMatch, i) => (
                  <View
                    key={m.id}
                    style={[
                      styles.matchRow,
                      i < matches.length - 1 && {
                        borderBottomColor: colors.border,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={styles.matchInfo}>
                      {sess.rounds > 1 ? (
                        <Text size="xs" color={colors.textMuted}>
                          {t('sessionDetail.sheet.round', { n: String(m.round_number) })}
                        </Text>
                      ) : null}
                      <View style={styles.vsRow}>
                        <Text
                          size="base"
                          weight={m.winner_team === 'a' ? 'bold' : 'regular'}
                          color={
                            isScored(m) && m.winner_team !== 'a' ? colors.textMuted : colors.text
                          }
                          numberOfLines={1}
                          style={styles.vsName}
                        >
                          {teamLabel(m.team_a_user_ids)}
                        </Text>
                        <Text size="sm" color={colors.textMuted}>
                          {isScored(m)
                            ? m.score || t('sessionDetail.score.played')
                            : t('sessionDetail.sheet.vs')}
                        </Text>
                        <Text
                          size="base"
                          weight={m.winner_team === 'b' ? 'bold' : 'regular'}
                          color={
                            isScored(m) && m.winner_team !== 'b' ? colors.textMuted : colors.text
                          }
                          numberOfLines={1}
                          style={styles.vsName}
                        >
                          {teamLabel(m.team_b_user_ids)}
                        </Text>
                      </View>
                    </View>
                    {canOverride(m) ? (
                      <View style={styles.matchActions}>
                        <TouchableOpacity
                          onPress={() => openScoreEntry(m)}
                          style={styles.lockButton}
                          accessibilityLabel={t('sessionDetail.score.enter')}
                          testID="cta-enter-score"
                        >
                          <Ionicons name="create-outline" size={18} color={colors.primary} />
                        </TouchableOpacity>
                        {renderLockToggle(m)}
                      </View>
                    ) : canOrganize(m) ? (
                      <View style={styles.matchActions}>
                        {/* Before the game: agree on a time with the opponent. */}
                        <TouchableOpacity
                          onPress={() => handleOrganizeInChat(m)}
                          disabled={openPairingChat.isPending}
                          style={styles.lockButton}
                          accessibilityLabel={t('sessionDetail.pairingChat.organize')}
                          testID="cta-organize-pairing"
                        >
                          <Ionicons
                            name="chatbubble-ellipses-outline"
                            size={18}
                            color={colors.primary}
                          />
                        </TouchableOpacity>
                        {/* After it: link a game played outside the chat. */}
                        {canLink(m) ? (
                          <TouchableOpacity
                            onPress={() => openLinkMatch(m)}
                            style={styles.lockButton}
                            accessibilityLabel={t('sessionDetail.linkPicker.addResult')}
                            testID="cta-link-match"
                          >
                            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : isScored(m) && canEditScore ? (
                      // A recorded score stays editable by the organizer for the
                      // direct-override path; an attached match is edited through the
                      // match flow. The lock toggle protects it from a regenerate.
                      <View style={styles.matchActions}>
                        {!m.match_id ? (
                          <TouchableOpacity
                            onPress={() => openScoreEntry(m)}
                            style={styles.lockButton}
                            accessibilityLabel={t('sessionDetail.score.edit')}
                            testID="cta-edit-score"
                          >
                            <Ionicons name="create-outline" size={18} color={colors.primary} />
                          </TouchableOpacity>
                        ) : null}
                        {renderLockToggle(m)}
                      </View>
                    ) : isScored(m) ? (
                      <Ionicons name="checkmark-circle" size={18} color={colors.positiveText} />
                    ) : m.locked ? (
                      <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
                    ) : null}
                  </View>
                ))
              )}
              {byeNames.length > 0 && (
                <View style={styles.byeRow}>
                  <Ionicons name="pause-outline" size={14} color={colors.textMuted} />
                  <Text size="sm" color={colors.textMuted}>
                    {t('sessionDetail.sheet.bye', { names: byeNames.join(', ') })}
                  </Text>
                </View>
              )}
            </View>
            {isOrganizer && sess.status === 'published' && (
              <TouchableOpacity
                onPress={() => {
                  lightHaptic();
                  if (oddRoster) {
                    Alert.alert(
                      t('sessionDetail.sheet.oddRoster.title'),
                      t('sessionDetail.sheet.oddRoster.message', {
                        count: String(confirmedCount),
                      }),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('sessionDetail.sheet.oddRoster.cta'),
                          onPress: () =>
                            genSheet({ versionWas: sess.version, regenerate: hasSheet }),
                        },
                      ]
                    );
                    return;
                  }
                  genSheet({ versionWas: sess.version, regenerate: hasSheet });
                }}
                disabled={isGenerating || confirmedCount < 2}
                style={[
                  styles.fullButton,
                  styles.sheetButton,
                  { backgroundColor: colors.primary },
                  (isGenerating || confirmedCount < 2) && styles.disabled,
                ]}
                testID="cta-generate-sheet"
              >
                <Ionicons name="shuffle-outline" size={18} color="#fff" />
                <Text size="base" weight="semibold" color="#fff">
                  {isGenerating
                    ? t('sessionDetail.sheet.generating')
                    : hasSheet
                      ? t('sessionDetail.sheet.regenerate')
                      : t('sessionDetail.sheet.generate')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Roster */}
        {PRESENCE_GROUPS.map(group => {
          const rows = presence.filter(p => p.status === group.status);
          if (rows.length === 0) return null;
          return (
            <View key={group.status} style={styles.section}>
              <Text
                size="xs"
                weight="semibold"
                color={colors.textMuted}
                style={styles.sectionTitle}
              >
                {`${t(group.key as TranslationKey).toUpperCase()} · ${rows.length}`}
              </Text>
              <View
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                {rows.map((row: SessionPresenceWithProfile, i) => (
                  <View
                    key={row.id}
                    style={[
                      styles.rosterRow,
                      i < rows.length - 1 && {
                        borderBottomColor: colors.border,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <Text size="base" color={colors.text}>
                      {row.profile
                        ? getHumanName(row.profile, t('sessionDetail.unknownMember'))
                        : t('sessionDetail.unknownMember')}
                    </Text>
                    <View style={styles.rosterRowEnd}>
                      {row.status === 'waitlisted' && row.waitlist_position != null ? (
                        <Text size="xs" color={colors.textMuted}>
                          {`#${row.waitlist_position}`}
                        </Text>
                      ) : null}
                      {isOrganizer &&
                      sess.status === 'published' &&
                      (row.status === 'confirmed' || row.status === 'waitlisted') ? (
                        <TouchableOpacity
                          onPress={() => {
                            void warningHaptic();
                            withdrawMember({ userId: row.user_id, versionWas: row.version });
                          }}
                          disabled={isWithdrawing}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={t('sessionDetail.roster.withdraw')}
                          testID={`cta-withdraw-${row.user_id}`}
                        >
                          <Ionicons name="person-remove-outline" size={18} color={colors.danger} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <ConfirmationModal
        visible={showPublishModal && !!sess}
        title={t('sessionDetail.publishModal.title')}
        message={t('sessionDetail.publishModal.description')}
        confirmLabel={t('sessionDetail.publishModal.confirm')}
        confirmTestID="confirm-publish-session"
        isLoading={isPublishing}
        onClose={() => setShowPublishModal(false)}
        onConfirm={() => {
          if (!sess || !publishDeadline) return;
          publish({
            sessionId,
            versionWas: sess.version,
            deadline: publishDeadline.toISOString(),
          });
        }}
        extraContent={
          publishDeadline && sess ? (
            <View style={styles.deadlineRow}>
              <SheetDateField
                label={t('sessionDetail.publishModal.deadlineDate')}
                value={publishDeadline}
                displayValue={publishDeadline.toLocaleDateString(locale, {
                  month: 'short',
                  day: 'numeric',
                })}
                mode="date"
                minimumDate={new Date()}
                maximumDate={new Date(sess.scheduled_at)}
                onChange={setPublishDeadline}
                colors={dateFieldColors}
                isDark={isDark}
                style={styles.deadlineField}
                testID="publish-deadline-date"
              />
              <SheetDateField
                label={t('sessionDetail.publishModal.deadlineTime')}
                value={publishDeadline}
                displayValue={publishDeadline.toLocaleTimeString(locale, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                mode="time"
                onChange={setPublishDeadline}
                colors={dateFieldColors}
                isDark={isDark}
                style={styles.deadlineField}
                testID="publish-deadline-time"
              />
            </View>
          ) : null
        }
      />

      <ConfirmationModal
        visible={showCancelModal && !!sess}
        title={t('sessionDetail.cancelModal.title')}
        message={t('sessionDetail.cancelModal.description')}
        confirmLabel={t('sessionDetail.cancelModal.confirm')}
        cancelLabel={t('sessionDetail.cancelModal.keepIt')}
        confirmTestID="confirm-cancel-session"
        destructive
        isLoading={isCancelling}
        onClose={() => {
          setShowCancelModal(false);
          setCancelReason('');
        }}
        onConfirm={() => {
          if (!sess) return;
          cancel({ sessionId, versionWas: sess.version, reason: cancelReason.trim() || undefined });
        }}
        extraContent={
          <TextInput
            style={[
              styles.reasonInput,
              {
                backgroundColor: colors.mutedBg,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            placeholder={t('sessionDetail.cancelModal.reasonPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={cancelReason}
            onChangeText={setCancelReason}
            multiline
            maxLength={300}
            editable={!isCancelling}
            testID="session-cancel-reason"
          />
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  deadlineRow: { flexDirection: 'row', gap: spacingPixels[3] },
  cancelledNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[2],
  },
  cancelledNoticeBody: { flex: 1, gap: 2 },
  rosterRowEnd: { flexDirection: 'row', alignItems: 'center', gap: spacingPixels[3] },
  deadlineField: { flex: 1 },
  reasonInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
    minHeight: 72,
    textAlignVertical: 'top',
  },
  content: { padding: spacingPixels[4], gap: spacingPixels[4] },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacingPixels[6] },
  centeredText: { marginTop: spacingPixels[3], textAlign: 'center' },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  card: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    padding: spacingPixels[4],
    gap: spacingPixels[2],
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  title: { marginTop: spacingPixels[1], marginBottom: spacingPixels[1] },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacingPixels[2] },
  ctaCard: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    padding: spacingPixels[4],
    gap: spacingPixels[3],
  },
  ctaButtons: { flexDirection: 'row', gap: spacingPixels[3] },
  partnerBlock: { gap: spacingPixels[2] },
  partnerChips: { flexDirection: 'row', gap: spacingPixels[2] },
  partnerChip: {
    borderWidth: 1,
    borderRadius: radiusPixels.full,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
  },
  ctaButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  ctaButtonOutline: { borderWidth: 1, backgroundColor: 'transparent' },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[3],
    gap: spacingPixels[2],
  },
  matchInfo: { flex: 1, gap: spacingPixels[0.5] },
  vsRow: { flexDirection: 'row', alignItems: 'center', gap: spacingPixels[2] },
  vsName: { flexShrink: 1 },
  lockButton: { padding: spacingPixels[1] },
  matchActions: { flexDirection: 'row', alignItems: 'center', gap: spacingPixels[1] },
  byeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingTop: spacingPixels[2],
  },
  sheetButton: { marginTop: spacingPixels[3] },
  fullButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
  },
  fullButtonOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3.5],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  disabled: { opacity: 0.6 },
  section: { gap: spacingPixels[2] },
  sectionTitle: { letterSpacing: 0.5, marginLeft: spacingPixels[1] },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
});

export default SessionDetail;
