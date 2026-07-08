/**
 * ReplyBanner Component
 * Shows above the message input when replying to a message
 */

import React, { memo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, fontSizePixels, primary, neutral } from '@rallia/design-system';

import { useThemeStyles, useTranslation } from '#/hooks';

interface ReplyBannerProps {
  senderName: string;
  messageContent: string;
  onCancel: () => void;
}

function ReplyBannerComponent({ senderName, messageContent, onCancel }: ReplyBannerProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? colors.card : neutral[100],
          borderLeftColor: primary[500],
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Ionicons name="arrow-undo" size={14} color={primary[500]} />
          <Text style={[styles.label, { color: primary[500] }]}>
            {t('chat.input.replyingTo', { name: senderName })}
          </Text>
        </View>
        <Text style={[styles.preview, { color: colors.textMuted }]} numberOfLines={1}>
          {messageContent}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.closeButton}
        onPress={onCancel}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="close-outline" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

export const ReplyBanner = memo(ReplyBannerComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderLeftWidth: 3,
    marginHorizontal: spacingPixels[2],
    marginBottom: spacingPixels[2],
    borderRadius: 4,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: fontSizePixels.xs,
    fontWeight: '600',
    marginLeft: spacingPixels[1],
  },
  preview: {
    fontSize: fontSizePixels.sm,
  },
  closeButton: {
    marginLeft: spacingPixels[2],
    padding: spacingPixels[1],
  },
});
