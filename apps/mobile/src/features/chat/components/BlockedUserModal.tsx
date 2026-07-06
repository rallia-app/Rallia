/**
 * BlockedUserModal
 *
 * Displayed when the current user has blocked the other user in a chat.
 * Provides options to unblock or report the user.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, status, primary, neutral } from '@rallia/design-system';

import { useThemeStyles, useTranslation } from '#/hooks';

interface BlockedUserModalProps {
  visible: boolean;
  userName: string;
  onUnblock: () => void;
  onReport: () => void;
  onBack: () => void;
  isUnblocking?: boolean;
}

export const BlockedUserModal: React.FC<BlockedUserModalProps> = ({
  visible,
  userName,
  onUnblock,
  onReport,
  onBack,
  isUnblocking = false,
}) => {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <View style={[styles.overlay, { backgroundColor: isDark ? colors.card : neutral[100] }]}>
      {/* Back button at top left */}
      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
        <Text style={[styles.backText, { color: colors.text }]}>{t('common.back')}</Text>
      </TouchableOpacity>

      <View style={styles.centeredContent}>
        <View style={styles.iconContainer}>
          <View style={[styles.iconCircle, { backgroundColor: status.error.light }]}>
            <Ionicons name="ban" size={32} color={status.error.DEFAULT} />
          </View>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          {t('chat.blocked.title', { name: userName })}
        </Text>

        <Text style={[styles.description, { color: colors.textMuted }]}>
          {t('chat.blocked.description')}
        </Text>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.unblockButton, { backgroundColor: primary[500] }]}
            onPress={onUnblock}
            disabled={isUnblocking}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="white" />
            <Text style={[styles.buttonText, { color: 'white' }]}>
              {isUnblocking ? t('chat.blocked.unblocking') : t('chat.blocked.unblock')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.reportButton, { borderColor: status.error.DEFAULT }]}
            onPress={onReport}
            activeOpacity={0.8}
          >
            <Ionicons name="flag-outline" size={20} color={status.error.DEFAULT} />
            <Text style={[styles.buttonText, { color: status.error.DEFAULT }]}>
              {t('chat.blocked.report')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  backButton: {
    position: 'absolute',
    top: spacingPixels[4],
    left: spacingPixels[4],
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[2],
    gap: spacingPixels[1],
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  centeredContent: {
    alignItems: 'center',
    padding: spacingPixels[6],
    maxWidth: 320,
  },
  iconContainer: {
    marginBottom: spacingPixels[6],
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: spacingPixels[3],
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacingPixels[8],
    paddingHorizontal: spacingPixels[4],
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: spacingPixels[4],
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3] + 2,
    paddingHorizontal: spacingPixels[6],
    borderRadius: 12,
    gap: spacingPixels[2],
    minWidth: 120,
  },
  unblockButton: {
    // Background color applied dynamically
  },
  reportButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default BlockedUserModal;
