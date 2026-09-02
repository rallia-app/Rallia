/**
 * PlayerSlotRow
 *
 * The overlapping avatar row that says who is in a game and how many seats
 * are open: filled slots show the participant, the host wears a star, every
 * open seat is a dashed "+". Grown out of MatchCard so the chat's game cards
 * show the same faces the feed does.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { base, neutral, primary } from '@rallia/design-system';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import type { MatchWithDetails } from '@rallia/shared-types';

const SLOT_SIZE = 32;
const SLOT_OVERLAP = -8;

export interface PlayerSlot {
  filled: boolean;
  avatarUrl?: string | null;
  isHost: boolean;
  playerId?: string | null;
}

/**
 * Host first, then joined participants, then one empty slot per open seat.
 * The host falls back to `created_by_player` for matches that predate the
 * is_host flag.
 */
export function buildPlayerSlots(match: MatchWithDetails, total: number): PlayerSlot[] {
  const joined = match.participants?.filter(p => p.status === 'joined') ?? [];
  const host = joined.find(p => p.is_host);
  const others = joined.filter(p => !p.is_host);

  const hostProfile = host?.player?.profile ?? match.created_by_player?.profile;
  const slots: PlayerSlot[] = [
    {
      filled: true,
      avatarUrl: getProfilePictureUrl(hostProfile?.profile_picture_url),
      isHost: true,
      playerId:
        host?.player?.id ?? host?.player_id ?? match.created_by_player?.id ?? match.created_by,
    },
  ];

  for (let i = 0; i < total - 1; i++) {
    const participant = others[i];
    slots.push({
      filled: !!participant,
      avatarUrl: getProfilePictureUrl(participant?.player?.profile?.profile_picture_url),
      isHost: false,
      playerId: participant?.player?.id ?? participant?.player_id,
    });
  }

  return slots;
}

export interface PlayerSlotRowProps {
  slots: PlayerSlot[];
  isDark: boolean;
  /** 'muted' greys the row for games that are over. */
  tone?: 'default' | 'muted';
  /** Tap handler for a filled avatar, receives that player's id. */
  onPlayerPress?: (playerId: string) => void;
}

export const PlayerSlotRow: React.FC<PlayerSlotRowProps> = ({
  slots,
  isDark,
  tone = 'default',
  onPlayerPress,
}) => {
  const accent =
    tone === 'muted'
      ? isDark
        ? neutral[500]
        : neutral[400]
      : isDark
        ? primary[400]
        : primary[500];
  const avatarPlaceholder = isDark ? neutral[700] : neutral[200];
  const placeholderIcon = isDark ? neutral[400] : neutral[500];
  const slotEmpty = isDark ? neutral[800] : neutral[100];
  const slotEmptyBorder = isDark ? neutral[600] : neutral[300];
  const hostBadge = isDark ? primary[400] : primary[500];

  return (
    <View style={styles.row}>
      {slots.map((slot, index) => {
        const playerId = slot.filled ? slot.playerId : null;
        const onPress = playerId && onPlayerPress ? () => onPlayerPress(playerId) : undefined;
        const SlotContainer = onPress ? TouchableOpacity : View;
        return (
          <View key={index} style={styles.slotWrapper}>
            <SlotContainer
              {...(onPress
                ? {
                    onPress,
                    activeOpacity: 0.7,
                    accessibilityRole: 'button',
                    hitSlop: { top: 6, bottom: 6, left: 0, right: 0 },
                  }
                : {})}
              style={[
                styles.slot,
                index > 0 && styles.slotOverlap,
                slot.filled
                  ? {
                      backgroundColor: slot.avatarUrl ? accent : avatarPlaceholder,
                      borderWidth: 2,
                      borderColor: accent,
                      shadowColor: accent,
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.3,
                      shadowRadius: 4,
                      elevation: 3,
                    }
                  : {
                      backgroundColor: slotEmpty,
                      borderWidth: 2,
                      borderStyle: 'dashed',
                      borderColor: slotEmptyBorder,
                    },
              ]}
            >
              {slot.filled ? (
                slot.avatarUrl ? (
                  <Image source={{ uri: slot.avatarUrl }} style={styles.avatar} />
                ) : (
                  <Ionicons name="person-outline" size={14} color={placeholderIcon} />
                )
              ) : (
                <Ionicons name="add-outline" size={16} color={slotEmptyBorder} />
              )}
            </SlotContainer>
            {slot.isHost && (
              <View style={[styles.hostIndicator, { backgroundColor: hostBadge }]}>
                <Ionicons name="star" size={8} color={base.white} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slotWrapper: {
    position: 'relative',
    alignItems: 'center',
  },
  slot: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  slotOverlap: {
    marginLeft: SLOT_OVERLAP,
  },
  avatar: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
  },
  hostIndicator: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: base.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
});

export default PlayerSlotRow;
