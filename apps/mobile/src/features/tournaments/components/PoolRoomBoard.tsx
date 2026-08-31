/**
 * Pool Room Board
 *
 * The pool's state, rendered at the top of its room (scheduling-funnel.md § 4):
 * one row per pairing with where it stands, and the phase deadline. Collapsed
 * to a one-line summary by default so the conversation keeps the space.
 * Readable by every member whatever their gate state; the board is how a
 * player learns who they face and by when.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SheetManager } from 'react-native-actions-sheet';
import { Text, Badge, Button, useToast } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  primary,
  status as statusColors,
} from '@rallia/design-system';
import { getHumanName, getInitialName } from '@rallia/shared-utils';
import {
  useTournament,
  useOpenTournamentRoundChat,
  useTournamentMatches,
  useTournamentRegistrations,
  useTournamentRoundDeadlines,
  useTournamentPhaseAvailability,
  useProfilesByIds,
  usePingPairingOpponent,
} from '@rallia/shared-hooks';

import { useAuth, useThemeStyles, useTranslation } from '#/hooks';
import type { RootStackParamList } from '#/navigation/types';
import { rpcErrorMessage } from '#/utils/rpcErrorMessage';
import { useLocale } from '#/context';

interface PoolRoomBoardProps {
  tournamentId: string;
  poolNumber: number;
}

export function PoolRoomBoard({ tournamentId, poolNumber }: PoolRoomBoardProps) {
  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const viewerId = session?.user?.id;
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openRoundChat = useOpenTournamentRoundChat();
  const ping = usePingPairingOpponent();
  const [pinged, setPinged] = useState<Set<string>>(new Set());

  // The board is where an unanswered opponent is visible, so the nudge lives
  // here rather than in a pairing room that has not opened yet.
  const handlePing = (tournamentMatchId: string) => {
    if (ping.isPending) return;
    ping.mutate(
      { tournamentMatchId },
      {
        onSuccess: () => {
          setPinged(prev => new Set(prev).add(tournamentMatchId));
          toast.success(t('tournamentDetail.poolRoom.pingSent'));
        },
        onError: error =>
          toast.error(
            rpcErrorMessage(error, t, 'tournamentDetail.poolRoom.pingError', {
              PING_TOO_SOON: 'tournamentDetail.poolRoom.pingTooSoon',
              NOBODY_TO_PING: 'tournamentDetail.poolRoom.pingNobody',
            })
          ),
      }
    );
  };

  const { data: tournament } = useTournament(tournamentId);
  const { data: matches = [] } = useTournamentMatches(tournamentId);
  const { data: registrations = [] } = useTournamentRegistrations(tournamentId);
  const { data: deadlines = [] } = useTournamentRoundDeadlines(tournamentId);
  const funnelEnabled = !!tournament?.scheduling_funnel_enabled;
  const { data: gateAnswers = [] } = useTournamentPhaseAvailability(
    tournamentId,
    'pool',
    0,
    funnelEnabled
  );

  const userIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of registrations) {
      if (r.user_id) ids.push(r.user_id);
      if (r.partner_user_id) ids.push(r.partner_user_id);
    }
    return ids;
  }, [registrations]);
  const { data: profiles } = useProfilesByIds(userIds);

  const poolMatches = useMemo(
    () =>
      matches
        .filter(m => m.bracket_side === 'pool' && m.pool_number === poolNumber)
        .sort((a, b) => a.match_position - b.match_position),
    [matches, poolNumber]
  );

  const regById = useMemo(() => {
    const map = new Map<string, (typeof registrations)[number]>();
    for (const r of registrations) map.set(r.id, r);
    return map;
  }, [registrations]);

  const nameOf = useMemo(() => {
    return (regId: string | null): string => {
      const r = regId ? regById.get(regId) : undefined;
      if (!r) return '?';
      const p = profiles?.[r.user_id];
      const partner = r.partner_user_id ? profiles?.[r.partner_user_id] : undefined;
      return partner
        ? [getInitialName(p, ''), getInitialName(partner, '')].filter(Boolean).join(' & ')
        : getHumanName(p, '?');
    };
  }, [regById, profiles]);

  const answeredUsers = useMemo(() => new Set(gateAnswers.map(a => a.player_id)), [gateAnswers]);
  const sideAnswered = useMemo(() => {
    return (regId: string | null): boolean => {
      const r = regId ? regById.get(regId) : undefined;
      if (!r) return false;
      if (!answeredUsers.has(r.user_id)) return false;
      if (r.partner_user_id && !answeredUsers.has(r.partner_user_id)) return false;
      return true;
    };
  }, [regById, answeredUsers]);

  const isMySide = useMemo(() => {
    return (regId: string | null): boolean => {
      const r = regId ? regById.get(regId) : undefined;
      if (!r || !viewerId) return false;
      return r.user_id === viewerId || r.partner_user_id === viewerId;
    };
  }, [regById, viewerId]);

  // Chip tones per theme. The shared Badge's variant colors are palette-fixed
  // and unreadable on a dark card, so the board passes its own, using the same
  // recipes the tournament screens build their status chips from.
  const tones = useMemo(
    () => ({
      positive: {
        bg: isDark ? `${statusColors.success.DEFAULT}30` : `${statusColors.success.DEFAULT}1A`,
        text: isDark ? statusColors.success.light : statusColors.success.dark,
      },
      warning: {
        bg: isDark ? `${statusColors.warning.DEFAULT}30` : `${statusColors.warning.DEFAULT}1A`,
        text: isDark ? statusColors.warning.light : statusColors.warning.dark,
      },
      active: {
        bg: isDark ? `${primary[500]}30` : `${primary[600]}20`,
        text: isDark ? primary[300] : primary[700],
      },
      muted: {
        bg: colors.inputBackground,
        text: colors.textMuted,
      },
    }),
    [isDark, colors.inputBackground, colors.textMuted]
  );

  const deadlineAt = useMemo(
    () => deadlines.find(d => d.bracket_side === 'pool')?.deadline_at ?? null,
    [deadlines]
  );

  const settled = poolMatches.filter(m =>
    ['completed', 'retired', 'walkover', 'cancelled'].includes(m.status)
  ).length;

  // My unsettled pairings are why I opened the room: the board starts open
  // when I have one, and those rows sort first and sit on a tinted ground.
  const isPendingStatus = (st: string) =>
    !['completed', 'retired', 'walkover', 'cancelled'].includes(st);
  const orderedMatches = useMemo(() => {
    const mine = (m: (typeof poolMatches)[number]) =>
      isMySide(m.player1_registration_id) || isMySide(m.player2_registration_id);
    return [...poolMatches].sort((a, b) => Number(mine(b)) - Number(mine(a)));
  }, [poolMatches, isMySide]);

  const iHavePending = useMemo(
    () =>
      poolMatches.some(
        m =>
          isPendingStatus(m.status) &&
          (isMySide(m.player1_registration_id) || isMySide(m.player2_registration_id))
      ),
    [poolMatches, isMySide]
  );
  const autoExpanded = useRef(false);
  useEffect(() => {
    if (!autoExpanded.current && iHavePending) {
      autoExpanded.current = true;
      setExpanded(true);
    }
  }, [iHavePending]);

  const hoursLeft = deadlineAt
    ? Math.max(0, Math.round((new Date(deadlineAt).getTime() - Date.now()) / 3600000))
    : null;
  const deadlineUrgent = hoursLeft !== null && hoursLeft <= 48;

  const openGate = () => {
    void SheetManager.show('tournament-availability-gate', {
      payload: {
        tournamentId,
        bracketSide: 'pool',
        roundNumber: 0,
        phaseLabel: t('tournamentDetail.availabilityGate.poolPhase'),
        deadlineAt,
        minHours: tournament?.min_availability_hours ?? null,
      },
    });
  };

  // Only once both sides have answered: before that the pairing room does not
  // exist, and opening it early would undo the strict lock.
  const openPairingRoom = (tournamentMatchId: string) => {
    if (openRoundChat.isPending) return;
    openRoundChat.mutate(tournamentMatchId, {
      onSuccess: conversationId =>
        navigation.push('ChatConversation', { conversationId, title: tournament?.name }),
    });
  };

  if (poolMatches.length === 0) return null;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      <TouchableOpacity
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.7}
        style={styles.headerRow}
        accessibilityRole="button"
        testID="pool-room-board-toggle"
      >
        <View style={styles.headerText}>
          <Text size="sm" weight="semibold" color={colors.text}>
            {t('tournamentDetail.poolRoom.title').replace('{n}', String(poolNumber))}
            {' · '}
            {t('tournamentDetail.poolRoom.settledCount')
              .replace('{settled}', String(settled))
              .replace('{total}', String(poolMatches.length))}
          </Text>
          {deadlineAt && (
            <Text
              size="xs"
              weight={deadlineUrgent ? 'semibold' : 'regular'}
              color={deadlineUrgent ? colors.error : colors.textMuted}
            >
              {deadlineUrgent
                ? t('tournamentDetail.deadlines.hoursLeft').replace('{hours}', String(hoursLeft))
                : t('tournamentDetail.poolRoom.deadline').replace(
                    '{date}',
                    new Date(deadlineAt).toLocaleDateString(locale, {
                      day: 'numeric',
                      month: 'long',
                    })
                  )}
            </Text>
          )}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.rows}>
          {orderedMatches.map((m, i) => {
            const label = `${nameOf(m.player1_registration_id)} \u2013 ${nameOf(m.player2_registration_id)}`;
            const waiting = funnelEnabled
              ? [m.player1_registration_id, m.player2_registration_id].filter(
                  reg => !sideAnswered(reg)
                )
              : [];
            const iPlayThis =
              isMySide(m.player1_registration_id) || isMySide(m.player2_registration_id);
            const iAmSilent = iPlayThis && waiting.some(reg => isMySide(reg));
            const canPing = iPlayThis && waiting.length > 0 && waiting.every(reg => !isMySide(reg));
            const isPending = isPendingStatus(m.status);
            const isReady = isPending && funnelEnabled && waiting.length === 0;
            const othersWaiting = waiting.filter(reg => !isMySide(reg));

            let chip: { label: string; tone: keyof typeof tones } | null = null;
            if (m.status === 'completed' || m.status === 'retired') {
              // Green is a reward, not a "this row is settled" stamp: it only
              // fires when the viewer won. A loss stays neutral rather than
              // going red, because losing is the normal half of playing and
              // the board should not stamp it.
              const iWon =
                iPlayThis && m.winner_registration_id != null && isMySide(m.winner_registration_id);
              chip = {
                label: m.score ?? t('tournamentDetail.poolRoom.played'),
                tone: iWon ? 'positive' : 'muted',
              };
            } else if (m.status === 'walkover') {
              // Amber reads as "nobody played this", which is true for both
              // sides, so it does not depend on who it favoured.
              chip = { label: t('tournamentDetail.poolRoom.walkover'), tone: 'warning' };
            } else if (m.status === 'cancelled') {
              chip = { label: t('tournamentDetail.poolRoom.cancelled'), tone: 'muted' };
            } else if (!funnelEnabled) {
              chip = { label: t('tournamentDetail.poolRoom.toPlay'), tone: 'muted' };
            } else if (isReady) {
              chip = { label: t('tournamentDetail.poolRoom.ready'), tone: 'active' };
            }

            // The right slot, centered on the row: one clear next step, never
            // two. My missing dispos outrank everything; then the nudge; then
            // the state chip.
            let action: React.ReactNode = null;
            if (iAmSilent) {
              action = (
                <Button size="sm" variant="secondary" onPress={openGate} testID="pool-board-gate">
                  {t('tournamentDetail.poolRoom.giveMine')}
                </Button>
              );
            } else if (canPing) {
              action = (
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => handlePing(m.id)}
                  disabled={ping.isPending || pinged.has(m.id)}
                  testID="pool-board-ping"
                >
                  {t(
                    pinged.has(m.id)
                      ? 'tournamentDetail.poolRoom.pingSentShort'
                      : 'tournamentDetail.poolRoom.ping'
                  )}
                </Button>
              );
            } else if (chip) {
              action = (
                <Badge
                  size="sm"
                  backgroundColor={tones[chip.tone].bg}
                  textColor={tones[chip.tone].text}
                >
                  {chip.label}
                </Badge>
              );
            }

            const rowInner = (
              <>
                <View style={styles.rowText}>
                  <Text size="sm" weight="semibold" color={colors.text} numberOfLines={1}>
                    {label}
                  </Text>
                  {isPending && funnelEnabled && waiting.length > 0 && (
                    <View style={styles.waitingRow}>
                      <Ionicons name="hourglass-outline" size={12} color={colors.textMuted} />
                      <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                        {iAmSilent
                          ? t('tournamentDetail.poolRoom.waitingForYou')
                          : t('tournamentDetail.poolRoom.waitingFor').replace(
                              '{names}',
                              othersWaiting.map(reg => nameOf(reg)).join(', ')
                            )}
                      </Text>
                    </View>
                  )}
                  {isReady && iPlayThis && (
                    <View style={styles.waitingRow}>
                      <Ionicons name="chatbubbles-outline" size={12} color={colors.primary} />
                      <Text size="xs" color={colors.primary} numberOfLines={1}>
                        {t('tournamentDetail.poolRoom.openRoom')}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.rowAction}>{action}</View>
              </>
            );

            const rowStyle = [
              styles.row,
              i > 0 && [styles.rowDivider, { borderTopColor: colors.border }],
            ];

            // A ready pairing of mine opens its room: the state IS the next
            // step, so the row acts on it.
            return isReady && iPlayThis ? (
              <TouchableOpacity
                key={m.id}
                style={rowStyle}
                onPress={() => openPairingRoom(m.id)}
                disabled={openRoundChat.isPending}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID="pool-board-open-room"
              >
                {rowInner}
              </TouchableOpacity>
            ) : (
              <View key={m.id} style={rowStyle}>
                {rowInner}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export default PoolRoomBoard;

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    marginHorizontal: spacingPixels[3],
    marginTop: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  headerText: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  rows: {
    marginTop: spacingPixels[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    gap: spacingPixels[1],
  },
  rowAction: {
    justifyContent: 'center',
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
});
