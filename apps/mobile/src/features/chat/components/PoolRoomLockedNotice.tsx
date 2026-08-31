/**
 * PoolRoomLockedNotice Component
 * Replaces the composer in a pool room while the viewer has not answered the
 * phase availability gate: reading stays open, posting waits for the ack
 * (scheduling-funnel.md § 4). The CTA opens the gate sheet, and the secondary
 * link opens the rules, because this is where a player first meets the wall
 * and the fair question is what happens if they walk away from it.
 */

import React, { memo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, fontSizePixels } from '@rallia/design-system';

import { useThemeStyles, useTranslation } from '#/hooks';

interface PoolRoomLockedNoticeProps {
  onGivePress: () => void;
}

function PoolRoomLockedNoticeComponent({ onGivePress }: PoolRoomLockedNoticeProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { borderTopColor: colors.border }]}>
      <View style={styles.noticeRow}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
        <Text style={[styles.text, { color: colors.textMuted }]}>
          {t('chat.poolRoom.lockedNotice')}
        </Text>
      </View>
      <Button onPress={onGivePress} fullWidth testID="pool-room-give-availability">
        {t('chat.poolRoom.lockedCta')}
      </Button>
      <TouchableOpacity
        onPress={() => void SheetManager.show('tournament-rules')}
        testID="pool-room-rules-link"
      >
        <Text style={[styles.link, { color: colors.primary }]}>
          {t('tournamentDetail.availabilityGate.rulesLink')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export const PoolRoomLockedNotice = memo(PoolRoomLockedNoticeComponent);

const styles = StyleSheet.create({
  container: {
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  text: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    flexShrink: 1,
  },
  link: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    fontWeight: '600',
  },
});
