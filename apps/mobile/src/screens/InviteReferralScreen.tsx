/**
 * InviteReferralScreen
 * Handles referral deep link: stores code in AsyncStorage for post-signup attribution,
 * or attributes immediately if user is already authenticated.
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useTheme, useReferral } from '@rallia/shared-hooks';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { useAuth, useTranslation } from '../hooks';
import type { RootStackScreenProps } from '../navigation/types';

const PENDING_REFERRAL_KEY = 'pending_referral_code';

export const InviteReferralScreen: React.FC<RootStackScreenProps<'InviteReferral'>> = ({
  route,
  navigation,
}) => {
  const { referralCode } = route.params;
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { session } = useAuth();
  const isDark = theme === 'dark';
  const playerId = session?.user?.id;

  const { attributeReferral } = useReferral(playerId);

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.background,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      primary: isDark ? primary[500] : primary[600],
    }),
    [themeColors, isDark]
  );

  const handleReferral = useCallback(async () => {
    try {
      // Store the referral code for post-signup attribution
      await AsyncStorage.setItem(PENDING_REFERRAL_KEY, referralCode);

      // If already authenticated, attribute immediately
      if (playerId) {
        await attributeReferral({ referralCode, newPlayerId: playerId });
        await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
      }
    } catch (error) {
      console.error('Failed to handle referral:', error);
    }

    // Navigate to home regardless
    navigation.reset({
      index: 0,
      routes: [{ name: 'Main' }],
    });
  }, [referralCode, playerId, attributeReferral, navigation]);

  useEffect(() => {
    handleReferral();
  }, [handleReferral]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Ionicons name="gift-outline" size={64} color={colors.primary} />
        <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
          {t('referral.welcomeTitle')}
        </Text>
        <Text size="base" color={colors.textMuted} style={styles.description}>
          {t('referral.welcomeDescription')}
        </Text>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          style={styles.loader}
        />
      </View>
    </SafeAreaView>
  );
};

export const PENDING_REFERRAL_KEY_EXPORT = PENDING_REFERRAL_KEY;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[8],
  },
  title: {
    marginTop: spacingPixels[6],
    textAlign: 'center',
  },
  description: {
    marginTop: spacingPixels[3],
    textAlign: 'center',
    lineHeight: 22,
  },
  loader: {
    marginTop: spacingPixels[8],
  },
});

export default InviteReferralScreen;
