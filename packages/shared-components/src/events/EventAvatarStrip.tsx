/**
 * Stacked participant faces with a quiet count beside the stack. The count
 * string is the caller's: registrations read "4/16", league members read
 * "4/16" or a bare "4" when the roster is uncapped.
 */

import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels } from '@rallia/design-system';
import { getProfilePictureUrl } from '@rallia/shared-utils';

import { Text } from '../foundation/Text';

import type { EventListColors } from './eventListColors';

const AVATARS_SHOWN = 4;
const AVATAR_SIZE = 24;

export interface EventAvatarStripProps {
  avatars: Array<{ id: string; avatarUrl: string | null }>;
  /** Rendered beside the people glyph, e.g. "4/16". */
  countLabel: string;
  /** Greys the count out once no seat is left. */
  isFull?: boolean;
  colors: EventListColors;
}

export const EventAvatarStrip: React.FC<EventAvatarStripProps> = ({
  avatars,
  countLabel,
  isFull = false,
  colors,
}) => {
  const shown = avatars.slice(0, AVATARS_SHOWN);
  const countColor = isFull ? colors.mutedText : colors.chipPrimaryText;

  return (
    <View style={styles.strip}>
      {shown.length > 0 && (
        <View style={styles.avatarsRow}>
          {shown.map((a, i) => {
            const uri = getProfilePictureUrl(a.avatarUrl);
            return (
              <View
                key={a.id}
                style={[
                  styles.avatarSlot,
                  i > 0 && styles.avatarSlotOverlap,
                  {
                    backgroundColor: uri ? colors.cardBackground : colors.avatarPlaceholder,
                    borderColor: colors.cardBackground,
                  },
                ]}
              >
                {uri ? (
                  <Image source={{ uri }} style={styles.avatarImg} />
                ) : (
                  <Ionicons name="person-outline" size={14} color={colors.avatarPlaceholderIcon} />
                )}
              </View>
            );
          })}
        </View>
      )}
      <View style={styles.fillCount}>
        <Ionicons name="people-outline" size={13} color={countColor} />
        <Text size="xs" weight="semibold" color={countColor}>
          {countLabel}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    flexShrink: 1,
  },
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarSlot: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  avatarSlotOverlap: {
    marginLeft: -6,
  },
  avatarImg: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  fillCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
});
