/**
 * CommunityJoinDeepLinkScreen
 *
 * Handles /community/join/:inviteCode deep links from Universal Links / App Links.
 * This is for community invite links that don't carry a referral code
 * (e.g., shared via QR code or public post).
 *
 * 1. Stores a PendingReferral (with empty code) in AsyncStorage for post-signup handling
 * 2. Sets pending community invite code in DeepLinkContext for immediate consumption
 * 3. Navigates to PreOnboarding or Main based on onboarding state
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { lightTheme, darkTheme, spacingPixels, primary } from '@rallia/design-system';
import { useDeepLink } from '../context';
import { useOverlay } from '../context/OverlayContext';
import { useTranslation } from '../hooks';
import { PENDING_REFERRAL_KEY } from './InvitationDeepLinkScreen';
import type { PendingReferral } from './InvitationDeepLinkScreen';
import type { RootStackScreenProps } from '../navigation/types';

export const CommunityJoinDeepLinkScreen: React.FC<
  RootStackScreenProps<'CommunityJoinDeepLink'>
> = ({ route, navigation }) => {
  const { inviteCode } = route.params;
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { setPendingCommunityInviteCode } = useDeepLink();
  const { isSportSelectionComplete } = useOverlay();
  const isDark = theme === 'dark';

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.background,
      text: themeColors.foreground,
      primary: isDark ? primary[500] : primary[600],
    }),
    [themeColors, isDark]
  );

  const handleDeepLink = useCallback(async () => {
    const destination = isSportSelectionComplete ? 'Main' : 'PreOnboarding';

    try {
      // Store structured referral data for post-signup handling (no referral code)
      const pendingReferral: PendingReferral = {
        code: '',
        type: 'community',
        targetId: inviteCode,
      };
      await AsyncStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(pendingReferral));

      // Set in DeepLinkContext for immediate consumption by Home (if already onboarded)
      setPendingCommunityInviteCode(inviteCode);

      navigation.reset({ index: 0, routes: [{ name: destination }] });
    } catch (error) {
      console.error('Failed to handle community join deep link:', error);
      navigation.reset({ index: 0, routes: [{ name: destination }] });
    }
  }, [inviteCode, navigation, setPendingCommunityInviteCode, isSportSelectionComplete]);

  useEffect(() => {
    handleDeepLink();
  }, [handleDeepLink]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.content}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[6],
  },
});
