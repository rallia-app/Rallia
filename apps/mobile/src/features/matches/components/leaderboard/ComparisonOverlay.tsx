/**
 * ComparisonOverlay
 *
 * Bottom-sheet shown when the user taps a leaderboard row or matchup card.
 * Renders: identity (avatar + name), W-L vs the caller, "Challenge to a
 * match" CTA, and the recent shared matches.
 *
 * Designed to be rendered controlled (parent holds visibility). Uses the
 * react-native-actions-sheet library that's already used elsewhere in the
 * app.
 */

import React, { useMemo } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral, primary, radiusPixels, spacingPixels, status } from '@rallia/design-system';
import { getHumanName } from '@rallia/shared-utils';
import type { NetworkPulse } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';
import RatingBadge from '../../../../components/RatingBadge';

const SHEET_ID = 'leaderboard-comparison';

export interface ComparisonOverlayPayload {
  pulse: NetworkPulse;
  callerId: string | undefined;
  peerId: string;
  onChallenge?: (peerId: string) => void;
  onPlayerPress?: (playerId: string) => void;
}

export function ComparisonOverlay({ payload }: SheetProps<typeof SHEET_ID>) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const overlay = payload as unknown as ComparisonOverlayPayload | undefined;

  const peer = useMemo(() => {
    if (!overlay) return null;
    return [
      ...overlay.pulse.leaderboard,
      ...overlay.pulse.settling_in.map(s => ({
        ...s,
        // align with leaderboard shape for naming helper.
        wins: 0,
        losses: 0,
      })),
    ].find(e => e.player_id === overlay.peerId);
  }, [overlay]);

  const h2h = useMemo(() => {
    if (!overlay || !overlay.pulse.discover.h2h_matrix) return null;
    const cell = overlay.pulse.discover.h2h_matrix.find(
      c =>
        (c.row_player_id === overlay.callerId && c.col_player_id === overlay.peerId) ||
        (c.col_player_id === overlay.callerId && c.row_player_id === overlay.peerId)
    );
    if (!cell) return null;
    if (cell.row_player_id === overlay.callerId) {
      return { my_wins: cell.wins, opp_wins: cell.losses };
    }
    return { my_wins: cell.losses, opp_wins: cell.wins };
  }, [overlay]);

  const close = () => {
    void SheetManager.hide(SHEET_ID);
  };

  if (!overlay || !peer) {
    return (
      <ActionSheet id={SHEET_ID}>
        <View style={[styles.sheet, { backgroundColor: colors.cardBackground }]}>
          <Text style={{ color: colors.textMuted }}>—</Text>
        </View>
      </ActionSheet>
    );
  }

  return (
    <ActionSheet id={SHEET_ID}>
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {/* Identity */}
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: isDark ? neutral[800] : neutral[200] }]}>
            {peer.profile_picture_url ? (
              <Image source={{ uri: peer.profile_picture_url }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person-outline" size={28} color={colors.textMuted} />
            )}
          </View>
          <View style={{ marginLeft: spacingPixels[3], flex: 1 }}>
            <Text size="lg" weight="bold" style={{ color: colors.text }}>
              {getHumanName(peer, t('groups.recentGames.player'))}
            </Text>
            {peer.skill_rating && (
              <View style={{ marginTop: 4 }}>
                <RatingBadge
                  ratingValue={peer.skill_rating.value}
                  certificationStatus={peer.skill_rating.certification_status}
                  isDark={isDark}
                  size="sm"
                />
              </View>
            )}
          </View>
          <TouchableOpacity onPress={close} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* H2H summary */}
        {h2h && (
          <View style={[styles.h2hRow, { backgroundColor: isDark ? neutral[900] : neutral[50] }]}>
            <View style={styles.h2hSide}>
              <Text size="xs" weight="semibold" style={{ color: colors.textMuted }}>
                YOU
              </Text>
              <Text size="2xl" weight="bold" style={{ color: status.success.DEFAULT }}>
                {h2h.my_wins}
              </Text>
            </View>
            <Text size="lg" weight="semibold" style={{ color: colors.textMuted }}>
              –
            </Text>
            <View style={styles.h2hSide}>
              <Text size="xs" weight="semibold" style={{ color: colors.textMuted }}>
                {peer.first_name?.toUpperCase()}
              </Text>
              <Text size="2xl" weight="bold" style={{ color: colors.text }}>
                {h2h.opp_wins}
              </Text>
            </View>
          </View>
        )}

        {/* Challenge CTA */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            close();
            overlay.onChallenge?.(overlay.peerId);
          }}
          style={[styles.cta, { backgroundColor: primary[500] }]}
        >
          <Ionicons name="add-circle-outline" size={18} color="#ffffff" />
          <Text size="base" weight="semibold" style={{ color: '#ffffff', marginLeft: 8 }}>
            {t('groups.leaderboard.discover.challenge')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            close();
            overlay.onPlayerPress?.(overlay.peerId);
          }}
          style={styles.profileLink}
        >
          <Text size="sm" style={{ color: colors.primary }}>
            {t('community.detail.viewAll')}
          </Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

export function showComparisonOverlay(payload: ComparisonOverlayPayload) {
  void SheetManager.show(SHEET_ID, { payload: payload });
}

const styles = StyleSheet.create({
  sheet: {
    paddingVertical: spacingPixels[5],
    paddingHorizontal: spacingPixels[5],
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  h2hRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: spacingPixels[5],
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[6],
    borderRadius: radiusPixels.xl,
  },
  h2hSide: {
    alignItems: 'center',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[5],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.xl,
  },
  profileLink: {
    alignItems: 'center',
    marginTop: spacingPixels[4],
  },
});

export default ComparisonOverlay;
