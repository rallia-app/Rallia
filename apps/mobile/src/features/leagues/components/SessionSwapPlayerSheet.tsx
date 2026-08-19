/**
 * Session Swap Player Sheet
 *
 * Organizer substitution on a published match sheet. Opened with the player
 * leaving a pairing; lists every other confirmed player, paired or on a bye,
 * and swaps on tap. Someone already paired trades places; someone on a bye
 * simply takes the slot.
 *
 * The server refuses once either pairing carries a result, which is the rule
 * the review asked for: the sheet stays adjustable until the scores are in.
 */

import React, { useCallback, useMemo } from 'react';
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
  const userOut = payload?.userOut ?? '';
  const userOutName = payload?.userOutName ?? '';
  const sessionVersion = payload?.sessionVersion ?? 0;

  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const { data: presence = [] } = useSessionPresence(sessionId);
  const { data: matches = [] } = useSessionMatches(sessionId);

  // Everyone confirmed but the player leaving. "Paired" is per round, matching
  // what the swap actually does: a trade only happens with someone booked in
  // this round, and anyone else is on a bye here whatever they play elsewhere.
  const candidates = useMemo(() => {
    const pairedThisRound = new Set<string>();
    for (const m of matches) {
      if (m.is_drill || m.round_number !== round) continue;
      for (const id of [...(m.team_a_user_ids ?? []), ...(m.team_b_user_ids ?? [])]) {
        pairedThisRound.add(id);
      }
    }
    return presence
      .filter(p => p.status === 'confirmed' && p.user_id !== userOut)
      .map(p => ({ ...p, isPaired: pairedThisRound.has(p.user_id) }));
  }, [presence, matches, userOut, round]);

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
      title={t('sessionDetail.swap.title', { name: userOutName })}
      onClose={handleClose}
      scrollable={false}
    >
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
  hint: {
    paddingHorizontal: spacingPixels[4],
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
