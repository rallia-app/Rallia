import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Modal, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, Button } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  neutral,
  accent,
} from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useTheme } from '@rallia/shared-hooks';
import { useTranslation, type TranslationKey } from '../hooks';
import { isBetaExpired } from '../constants/beta';

const STORAGE_KEY = '@rallia/beta-notice-dismissed';

interface BetaNoticeModalProps {
  isSplashComplete: boolean;
}

const BetaNoticeModal: React.FC<BetaNoticeModalProps> = ({ isSplashComplete }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  const accentColor = isDark ? accent[400] : accent[500];

  useEffect(() => {
    if (!isSplashComplete) return;
    if (isBetaExpired()) {
      setReady(true);
      return;
    }

    (async () => {
      try {
        const dismissed = await AsyncStorage.getItem(STORAGE_KEY);
        setVisible(dismissed !== 'true');
      } catch {
        setVisible(true);
      } finally {
        setReady(true);
      }
    })();
  }, [isSplashComplete]);

  const handleDismiss = useCallback(() => {
    lightHaptic();
    setVisible(false);
    AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => {});
  }, []);

  if (!ready || !visible) return null;

  const colors = {
    background: isDark ? neutral[800] : themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    iconBackground: `${accentColor}20`,
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={handleDismiss}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.modal, { backgroundColor: colors.background }]}>
              <View style={[styles.iconContainer, { backgroundColor: colors.iconBackground }]}>
                <Ionicons name="flask" size={32} color={accentColor} />
              </View>

              <Text size="lg" weight="semibold" style={[styles.title, { color: colors.text }]}>
                {t('beta.noticeTitle' as TranslationKey)}
              </Text>

              <Text size="base" style={[styles.message, { color: colors.textMuted }]}>
                {t('beta.noticeMessage' as TranslationKey)}
              </Text>

              <View
                style={[styles.button, { backgroundColor: accentColor }]}
                onTouchEnd={handleDismiss}
              >
                <Text size="base" weight="semibold" color="#fff">
                  {t('beta.noticeDismiss' as TranslationKey)}
                </Text>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  message: {
    textAlign: 'center',
    marginBottom: spacingPixels[5],
    lineHeight: 22,
  },
  button: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
});

export default BetaNoticeModal;
