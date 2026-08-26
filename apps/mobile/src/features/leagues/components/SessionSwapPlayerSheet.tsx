/**
 * Session Swap Player Sheet
 *
 * Organizer substitution on a published match sheet. Opened with the players
 * it may take out (one side, or the whole pairing from the row's icon): the
 * organizer picks who leaves when there is a choice, then taps who comes in
 * from every other confirmed player, paired or on a bye. Someone already
 * paired trades places; someone on a bye simply takes the slot.
 *
 * The server refuses once either pairing carries a result, which is the rule
 * the review asked for: the sheet stays adjustable until the scores are in.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getHumanName,
  getProfilePictureUrl,
} from '@rallia/shared-utils';
import { useSessionPresence, useSessionMatches, useSwapSessionPlayer } from '@rallia/shared-hooks';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { useThemeStyles, useTranslation } from '#/hooks';
import { rpcErrorMessage } from '#/utils/rpcErrorMessage';

const SHEET_ID = 'session-swap-player';

export function SessionSwapPlayerActionSheet({ payload }: SheetProps<'session-swap-player'>) {
  const sessionId = payload?.sessionId ?? '';
  const matchId = payload?.matchId ?? '';
  const round = payload?.round ?? 1;
  const userOutOptions = payload?.userOutOptions ?? [];
  const sessionVersion = payload?.sessionVersion ?? 0;

  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const { data: presence = [] } = useSessionPresence(sessionId);
  const { data: matches = [] } = useSessionMatches(sessionId);

  // Preselect the first, which is the only one on a singles side and the one
  // the icon used to assume. The picker below only appears when there is a
  // real choice to make.
  const [userOut, setUserOut] = useState(userOutOptions[0] ?? '');

  const nameOf = useCallback(
    (id: string): string =>
      getHumanName(presence.find(p => p.user_id === id)?.profile, t('leagueDetail.unknownMember')),
    [presence, t]
  );

  // Everyone confirmed but this pairing's own players. "Paired" is per round,
  // matching what the swap actually does: a trade only happens with someone
  // booked in this round, and anyone else is on a bye here whatever they play
  // elsewhere. The row's own players are excluded rather than offered: the
  // server refuses that trade (SAME_MATCH) because two players swapping sides
  // of the same pairing changes nothing.
  const candidates = useMemo(() => {
    const pairedThisRound = new Set<string>();
    for (const m of matches) {
      if (m.is_drill || m.round_number !== round) continue;
      for (const id of [...(m.team_a_user_ids ?? []), ...(m.team_b_user_ids ?? [])]) {
        pairedThisRound.add(id);
      }
    }
    const thisRow = matches.find(m => m.id === matchId);
    const onThisRow = new Set<string>([
      ...(thisRow?.team_a_user_ids ?? []),
      ...(thisRow?.team_b_user_ids ?? []),
      userOut,
    ]);
    return presence
      .filter(p => p.status === 'confirmed' && !onThisRow.has(p.user_id))
      .map(p => ({ ...p, isPaired: pairedThisRound.has(p.user_id) }));
  }, [presence, matches, matchId, userOut, round]);

  const { mutate: swap, isPending } = useSwapSessionPlayer(sessionId, {
    onSuccess: () => {
      void SheetManager.hide(SHEET_ID).then(() => {
        successHaptic();
        toast.success(t('sessionDetail.swap.done'));
      });
    },
    onError: e => {
      warningHaptic();
      toast.error(
        rpcErrorMessage(e, t, 'sessionDetail.errors.generic', {
          MATCH_ALREADY_PLAYED: 'sessionDetail.swap.errors.alreadyPlayed',
          MATCH_ALREADY_LINKED: 'sessionDetail.swap.errors.alreadyLinked',
          PLAYER_NOT_CONFIRMED: 'sessionDetail.swap.errors.notConfirmed',
          PLAYER_NOT_ON_SHEET: 'sessionDetail.swap.errors.notOnSheet',
          MATCH_NOT_FOUND: 'sessionDetail.swap.errors.notOnSheet',
          SAME_MATCH: 'sessionDetail.swap.errors.sameMatch',
          SWAP_WOULD_DUPLICATE_PLAYER: 'sessionDetail.swap.errors.wouldDuplicate',
          OPTIMISTIC_LOCK_CONFLICT: 'sessionDetail.swap.errors.stale',
        })
      );
    },
  });

  const handlePick = useCallback(
    (userIn: string) => {
      if (isPending) return;
      lightHaptic();
      swap({ matchId, userOut, userIn, versionWas: sessionVersion });
    },
    [isPending, swap, matchId, userOut, sessionVersion]
  );

  const handleClose = useCallback(() => {
    void SheetManager.hide(SHEET_ID);
  }, []);

  return (
    <BaseActionSheet
      title={t('sessionDetail.swap.title', { name: nameOf(userOut) })}
      onClose={handleClose}
      scrollable={false}
    >
      {userOutOptions.length > 1 ? (
        <View style={styles.leavingRow}>
          {userOutOptions.map(id => (
            <TouchableOpacity
              key={id}
              onPress={() => {
                void lightHaptic();
                setUserOut(id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: id === userOut }}
              testID={`swap-leaving-${id}`}
              style={[
                styles.leavingChip,
                { borderColor: id === userOut ? colors.primary : colors.border },
              ]}
            >
              <Text
                size="sm"
                weight="semibold"
                color={id === userOut ? colors.primary : colors.text}
              >
                {nameOf(id)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <Text size="sm" color={colors.textMuted} style={styles.hint}>
        {t('sessionDetail.swap.hint')}
      </Text>
      <FlatList
        data={candidates}
        keyExtractor={item => item.user_id}
        renderItem={({ item }) => {
          const avatar = getProfilePictureUrl(item.profile?.profile_picture_url);
          return (
            <TouchableOpacity
              onPress={() => handlePick(item.user_id)}
              disabled={isPending}
              testID={`swap-candidate-${item.user_id}`}
              style={[styles.row, { borderColor: colors.border }]}
            >
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: colors.inputBackground }]}>
                  <Ionicons name="person" size={16} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.rowText}>
                <Text size="sm" weight="semibold" color={colors.text}>
                  {getHumanName(item.profile, t('leagueDetail.unknownMember'))}
                </Text>
                <Text size="xs" color={colors.textMuted}>
                  {item.isPaired ? t('sessionDetail.swap.trades') : t('sessionDetail.swap.onBye')}
                </Text>
              </View>
              <Ionicons name="swap-horizontal" size={18} color={colors.primary} />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Text size="sm" color={colors.textMuted} style={styles.hint}>
            {t('sessionDetail.swap.empty')}
          </Text>
        }
      />
    </BaseActionSheet>
  );
}

const styles = StyleSheet.create({
  leavingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
  },
  leavingChip: {
    borderWidth: 1,
    borderRadius: radiusPixels.full,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
  },
  // One rhythm down the sheet: each block owns the space above it, so the first
  // one clears the header instead of sitting on its divider.
  hint: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: spacingPixels[1],
  },
});

export default SessionSwapPlayerActionSheet;
