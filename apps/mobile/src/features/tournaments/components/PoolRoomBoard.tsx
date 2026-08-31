/**
 * Pool Room Board
 *
 * The pool's state, rendered at the top of its room (scheduling-funnel.md § 4):
 * one row per pairing with where it stands, and the phase deadline. Collapsed
 * to a one-line summary by default so the conversation keeps the space.
 * Readable by every member whatever their gate state; the board is how a
 * player learns who they face and by when.
 */

import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Badge, Button, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { getHumanName, getInitialName } from '@rallia/shared-utils';
import {
  useTournament,
  useTournamentMatches,
  useTournamentRegistrations,
  useTournamentRoundDeadlines,
  useTournamentPhaseAvailability,
  useProfilesByIds,
  usePingPairingOpponent,
} from '@rallia/shared-hooks';

import { useAuth, useThemeStyles, useTranslation } from '#/hooks';
import { rpcErrorMessage } from '#/utils/rpcErrorMessage';
import { useLocale } from '#/context';

interface PoolRoomBoardProps {
  tournamentId: string;
  poolNumber: number;
}

export function PoolRoomBoard({ tournamentId, poolNumber }: PoolRoomBoardProps) {
  const { colors } = useThemeStyles();
  const { session } = useAuth();
  const viewerId = session?.user?.id;
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();
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

  const deadlineAt = useMemo(
    () => deadlines.find(d => d.bracket_side === 'pool')?.deadline_at ?? null,
    [deadlines]
  );

  const settled = poolMatches.filter(m =>
    ['completed', 'retired', 'walkover', 'cancelled'].includes(m.status)
  ).length;

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
            <Text size="xs" color={colors.textMuted}>
              {t('tournamentDetail.poolRoom.deadline').replace(
                '{date}',
                new Date(deadlineAt).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
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
          {poolMatches.map(m => {
            const label = `${nameOf(m.player1_registration_id)} – ${nameOf(m.player2_registration_id)}`;
            let badge: React.ReactNode;
            // Only worth nudging when the silent side is not the viewer: their
            // own missing answer is the gate's job, not a nudge's.
            const waitingSides = funnelEnabled
              ? [m.player1_registration_id, m.player2_registration_id].filter(
                  reg => !sideAnswered(reg)
                )
              : [];
            // Only on a pairing the viewer actually plays: nudging a pool-mate
            // about someone else's game is not theirs to do, and the RPC
            // refuses it anyway.
            const iPlayThis =
              isMySide(m.player1_registration_id) || isMySide(m.player2_registration_id);
            const waitingOnOthers =
              iPlayThis && waitingSides.length > 0 && waitingSides.every(reg => !isMySide(reg));
            if (m.status === 'completed' || m.status === 'retired') {
              badge = (
                <Badge variant="success">{m.score ?? t('tournamentDetail.poolRoom.played')}</Badge>
              );
            } else if (m.status === 'walkover') {
              badge = <Badge variant="warning">{t('tournamentDetail.poolRoom.walkover')}</Badge>;
            } else if (m.status === 'cancelled') {
              badge = <Badge variant="default">{t('tournamentDetail.poolRoom.cancelled')}</Badge>;
            } else if (!funnelEnabled) {
              badge = <Badge variant="default">{t('tournamentDetail.poolRoom.toPlay')}</Badge>;
            } else {
              const waiting = [m.player1_registration_id, m.player2_registration_id]
                .filter(reg => !sideAnswered(reg))
                .map(reg => nameOf(reg));
              badge =
                waiting.length === 0 ? (
                  <Badge variant="primary">{t('tournamentDetail.poolRoom.ready')}</Badge>
                ) : (
                  <Badge variant="default">
                    {t('tournamentDetail.poolRoom.waitingFor').replace(
                      '{names}',
                      waiting.join(', ')
                    )}
                  </Badge>
                );
            }
            return (
              <View key={m.id} style={styles.row}>
                <Text size="xs" weight="semibold" color={colors.text} numberOfLines={1}>
                  {label}
                </Text>
                <View style={styles.rowBadge}>{badge}</View>
                {waitingOnOthers && (
                  <View style={styles.rowBadge}>
                    <Button
                      variant="ghost"
                      size="sm"
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
                  </View>
                )}
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
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
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
    gap: spacingPixels[1.5],
  },
  row: {
    gap: spacingPixels[1],
  },
  rowBadge: {
    alignSelf: 'flex-start',
  },
});
