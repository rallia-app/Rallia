/**
 * AnnouncementNotice Component
 * Replaces the composer in announcement channels, which are read-only
 */

import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, fontSizePixels } from '@rallia/design-system';

import { useThemeStyles, useTranslation } from '#/hooks';

function AnnouncementNoticeComponent() {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { borderTopColor: colors.border }]}>
      <Ionicons name="megaphone-outline" size={16} color={colors.textMuted} />
      <Text style={[styles.text, { color: colors.textMuted }]}>
        {t('chat.announcement.readOnly')}
      </Text>
    </View>
  );
}

export const AnnouncementNotice = memo(AnnouncementNoticeComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
  },
});
