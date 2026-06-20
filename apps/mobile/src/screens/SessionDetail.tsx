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
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
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
  useRecordSessionScore,
} from '@rallia/shared-hooks';
import { isLeagueOrganizer } from '@rallia/shared-services';
import type {
  SessionPresenceWithProfile,
  SessionMatch,
  PresenceStatus,
} from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import { useTranslation, type TranslationKey } from '../hooks';
import * as Analytics from '../services/analytics';
import type { RootStackParamList } from '../navigation';

type Route = RouteProp<RootStackParamList, 'SessionDetail'>;
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
  const toast = useToast();
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;
  const route = useRoute<Route>();
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
      toast.error(e.message || t('sessionDetail.errors.generic'));
    },
  });

  const { mutate: publish, isPending: isPublishing } = usePublishSession(seasonId, {
    onSuccess: row => {
      successHaptic();
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
      toast.error(e.message || t('sessionDetail.errors.generic'));
    },
  });

  const { mutate: cancel, isPending: isCancelling } = useCancelSession(seasonId, {
    onSuccess: () => {
      successHaptic();
      toast.success(t('sessionDetail.toasts.cancelled'));
      Analytics.sessionCancelledAnalytics({ sessionId, confirmedCount });
      invalidate();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('sessionDetail.errors.generic'));
    },
  });

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

  const [scoringMatch, setScoringMatch] = useState<SessionMatch | null>(null);
  const [scoreWinner, setScoreWinner] = useState<'a' | 'b'>('a');
  const [scoreText, setScoreText] = useState('');

  const { mutate: recordScore, isPending: isRecording } = useRecordSessionScore(
    sessionId,
    seasonId,
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('sessionDetail.score.saved'));
        Analytics.sessionScoreSubmittedAnalytics({ sessionId });
        setScoringMatch(null);
        setScoreText('');
        invalidate();
      },
      onError: e => {
        warningHaptic();
        toast.error(e.message || t('sessionDetail.errors.generic'));
      },
    }
  );

  const isScored = useCallback(
    (m: SessionMatch) =>
      m.status === 'completed' || m.status === 'retired' || m.status === 'walkover',
    []
  );

  const canScoreMatch = useCallback(
    (m: SessionMatch) => {
      if (!sess) return false;
      if (sess.status !== 'published' && sess.status !== 'in_progress') return false;
      if (isScored(m)) return false;
      const isParticipant =
        !!userId && [...m.team_a_user_ids, ...m.team_b_user_ids].includes(userId);
      return isOrganizer || isParticipant;
    },
    [sess, isScored, isOrganizer, userId]
  );

  const openScoreEntry = useCallback((m: SessionMatch) => {
    lightHaptic();
    setScoringMatch(m);
    setScoreWinner('a');
    setScoreText('');
  }, []);

  const submitScore = useCallback(() => {
    if (!scoringMatch || isRecording) return;
    recordScore({
      sessionMatchId: scoringMatch.id,
      winnerTeam: scoreWinner,
      score: scoreText.trim() || undefined,
      status: 'completed',
      versionWas: scoringMatch.version,
    });
  }, [scoringMatch, scoreWinner, scoreText, recordScore, isRecording]);

  const handleConfirm = useCallback(
    (status: PresenceStatus) => {
      if (isConfirming || !sess) return;
      lightHaptic();
      confirm({ status });
      if (status === 'confirmed') {
        Analytics.sessionConfirmedAnalytics({ sessionId, partnerProvided: false });
      } else if (status === 'declined') {
        Analytics.sessionDeclinedAnalytics({ sessionId });
      }
    },
    [confirm, isConfirming, sess, sessionId]
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
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !sess) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
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

  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
              <TouchableOpacity
                onPress={() => handleConfirm('declined')}
                disabled={isConfirming || myPresence?.status === 'declined'}
                style={[
                  styles.ctaButton,
                  styles.ctaButtonOutline,
                  { borderColor: colors.border },
                  (isConfirming || myPresence?.status === 'declined') && styles.disabled,
                ]}
                testID="cta-decline-presence"
              >
                <Text size="sm" weight="semibold" color={colors.text}>
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
              publish({ sessionId, versionWas: sess.version });
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
                cancel({ sessionId, versionWas: sess.version });
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
                          {nameOf(m.team_a_user_ids[0])}
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
                          {nameOf(m.team_b_user_ids[0])}
                        </Text>
                      </View>
                    </View>
                    {canScoreMatch(m) ? (
                      <TouchableOpacity
                        onPress={() => openScoreEntry(m)}
                        style={styles.lockButton}
                        accessibilityLabel={t('sessionDetail.score.enter')}
                        testID="cta-enter-score"
                      >
                        <Ionicons name="create-outline" size={18} color={colors.primary} />
                      </TouchableOpacity>
                    ) : isScored(m) ? (
                      <Ionicons name="checkmark-circle" size={18} color={colors.positiveText} />
                    ) : isOrganizer && sess.status === 'published' ? (
                      <TouchableOpacity
                        onPress={() => {
                          lightHaptic();
                          setLock({
                            sessionMatchId: m.id,
                            locked: !m.locked,
                            versionWas: m.version,
                          });
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
                    {row.status === 'waitlisted' && row.waitlist_position != null ? (
                      <Text size="xs" color={colors.textMuted}>
                        {`#${row.waitlist_position}`}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Modal
        visible={scoringMatch !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setScoringMatch(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
            <Text size="lg" weight="bold" color={colors.text}>
              {t('sessionDetail.score.title')}
            </Text>
            {scoringMatch ? (
              <>
                <Text size="sm" color={colors.textMuted}>
                  {t('sessionDetail.score.winnerPrompt')}
                </Text>
                <View style={styles.winnerRow}>
                  {(['a', 'b'] as const).map(side => {
                    const ids =
                      side === 'a' ? scoringMatch.team_a_user_ids : scoringMatch.team_b_user_ids;
                    const selected = scoreWinner === side;
                    return (
                      <TouchableOpacity
                        key={side}
                        onPress={() => {
                          lightHaptic();
                          setScoreWinner(side);
                        }}
                        style={[
                          styles.winnerOption,
                          {
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected ? colors.highlightBg : 'transparent',
                          },
                        ]}
                        testID={`score-winner-${side}`}
                      >
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={selected ? colors.primary : colors.textMuted}
                        />
                        <Text
                          size="base"
                          weight={selected ? 'semibold' : 'regular'}
                          color={colors.text}
                          numberOfLines={1}
                          style={styles.winnerName}
                        >
                          {nameOf(ids[0])}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  value={scoreText}
                  onChangeText={setScoreText}
                  placeholder={t('sessionDetail.score.scorePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  testID="score-input"
                  style={[
                    styles.scoreInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    onPress={() => setScoringMatch(null)}
                    style={[
                      styles.modalBtn,
                      styles.ctaButtonOutline,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Text size="base" weight="semibold" color={colors.text}>
                      {t('sessionDetail.score.cancel')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={submitScore}
                    disabled={isRecording}
                    style={[
                      styles.modalBtn,
                      { backgroundColor: colors.primary },
                      isRecording && styles.disabled,
                    ]}
                    testID="cta-submit-score"
                  >
                    <Text size="base" weight="semibold" color="#fff">
                      {isRecording
                        ? t('sessionDetail.score.saving')
                        : t('sessionDetail.score.save')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacingPixels[4], paddingBottom: spacingPixels[8], gap: spacingPixels[4] },
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
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    borderTopLeftRadius: radiusPixels.xl,
    borderTopRightRadius: radiusPixels.xl,
    padding: spacingPixels[5],
    paddingBottom: spacingPixels[8],
    gap: spacingPixels[3],
  },
  winnerRow: { flexDirection: 'row', gap: spacingPixels[3] },
  winnerOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    borderWidth: 1.5,
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
  },
  winnerName: { flexShrink: 1 },
  scoreInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    fontSize: 16,
  },
  modalButtons: { flexDirection: 'row', gap: spacingPixels[3], marginTop: spacingPixels[1] },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3.5],
    borderRadius: radiusPixels.lg,
  },
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
