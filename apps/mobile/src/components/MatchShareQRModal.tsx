/**
 * MatchShareQRModal - Compact modal showing a QR code and copyable deep link
 * for a match, enabling in-person invites and paste-anywhere sharing.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Text, useToast } from '@rallia/shared-components';
import { lightTheme, darkTheme, spacingPixels, radiusPixels, neutral } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useTheme } from '@rallia/shared-hooks';

import { useTranslation, useThemeStyles } from '#/hooks';
import { generateMatchDeepLink } from '#/utils/shareUtils';
import * as Analytics from '#/services/analytics';

export interface MatchShareQRModalProps {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  referralCode?: string;
}

export const MatchShareQRModal: React.FC<MatchShareQRModalProps> = ({
  visible,
  onClose,
  matchId,
  referralCode,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { colors: themeStyles } = useThemeStyles();
  const toast = useToast();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  const [copied, setCopied] = useState(false);
  const copyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deepLink = useMemo(
    () =>
      matchId
        ? generateMatchDeepLink(matchId, referralCode, {
            utm_source: 'app_share',
            utm_medium: 'referral',
            utm_campaign: 'match_share_2026',
            utm_content: 'qr_modal',
          })
        : '',
    [matchId, referralCode]
  );

  useEffect(() => {
    return () => {
      if (copyResetTimeout.current) clearTimeout(copyResetTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setCopied(false);
      if (copyResetTimeout.current) {
        clearTimeout(copyResetTimeout.current);
        copyResetTimeout.current = null;
      }
    }
  }, [visible]);

  const colors = {
    background: isDark ? neutral[800] : themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    border: isDark ? neutral[700] : themeColors.border,
    surface: themeStyles.buttonInactive,
    accent: themeStyles.buttonActive,
    accentText: themeStyles.buttonTextActive,
    qrForeground: isDark ? themeColors.foreground : neutral[900],
  };

  const handleClose = useCallback(() => {
    lightHaptic();
    onClose();
  }, [onClose]);

  const handleCopyLink = useCallback(async () => {
    if (!deepLink) return;
    lightHaptic();
    try {
      await Clipboard.setStringAsync(deepLink);
      setCopied(true);
      toast.success(t('common.copied'));
      Analytics.invitationLinkGenerated({
        invitation_type: 'match',
        channel: 'copy_link',
      });
      if (copyResetTimeout.current) clearTimeout(copyResetTimeout.current);
      copyResetTimeout.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('common.error'));
    }
  }, [deepLink, toast, t]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.modal, { backgroundColor: colors.background }]}>
              <TouchableOpacity
                onPress={handleClose}
                style={styles.closeButton}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Ionicons name="close-outline" size={24} color={colors.textMuted} />
              </TouchableOpacity>

              <Text size="lg" weight="semibold" style={[styles.title, { color: colors.text }]}>
                {t('matchDetail.qrModalTitle')}
              </Text>

              <Text size="sm" style={[styles.description, { color: colors.textMuted }]}>
                {t('matchDetail.qrModalDescription')}
              </Text>

              <View style={[styles.qrContainer, { backgroundColor: colors.surface }]}>
                {deepLink ? (
                  <QRCode
                    value={deepLink}
                    size={180}
                    backgroundColor={colors.surface}
                    color={colors.qrForeground}
                  />
                ) : null}
              </View>

              <View
                style={[
                  styles.linkContainer,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text numberOfLines={1} size="sm" style={[styles.linkText, { color: colors.text }]}>
                  {deepLink}
                </Text>
                <TouchableOpacity
                  onPress={handleCopyLink}
                  style={[
                    styles.copyButton,
                    { backgroundColor: copied ? colors.accent : colors.border },
                  ]}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={18}
                    color={copied ? colors.accentText : colors.text}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
  },
  modal: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radiusPixels.xl,
    paddingTop: spacingPixels[6],
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[5],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  closeButton: {
    position: 'absolute',
    top: spacingPixels[3],
    right: spacingPixels[3],
    padding: spacingPixels[1],
    zIndex: 1,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  description: {
    textAlign: 'center',
    marginBottom: spacingPixels[5],
    lineHeight: 20,
    paddingHorizontal: spacingPixels[2],
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[5],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  linkText: {
    flex: 1,
  },
  copyButton: {
    padding: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
});

export default MatchShareQRModal;
