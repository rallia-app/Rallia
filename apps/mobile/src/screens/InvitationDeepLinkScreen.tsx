/**
 * InvitationDeepLinkScreen
 *
 * Unified deep link handler for all invitation types.
 * Route: /invite/:referralCode?type=match&id=uuid
 *
 * 1. Parses referral code + invitation type + target ID from URL
 * 2. Stores structured PendingReferral in AsyncStorage for post-signup attribution
 * 3. Navigates to the appropriate target:
 *    - referral: Home
 *    - match: Home (with pendingMatchId in DeepLinkContext)
 *    - group: GroupDetail (via invite code join)
 *    - community: CommunityDetail (via invite code join)
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { lightTheme, darkTheme, spacingPixels, primary } from '@rallia/design-system';
import type { InvitationType } from '@rallia/shared-services';
import { useDeepLink } from '../context';
import { useTranslation } from '../hooks';
import type { RootStackScreenProps } from '../navigation/types';

// ============================================================================
// CONSTANTS
// ============================================================================

export const PENDING_REFERRAL_KEY = 'pending_referral_code';

export interface PendingReferral {
  code: string;
  type: InvitationType;
  targetId?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract query params from the initial URL that opened this screen.
 * React Navigation doesn't pass query params for routes like `invite/:referralCode`,
 * so we parse them from the raw URL.
 */
async function extractQueryParams(): Promise<{ type?: string; id?: string }> {
  try {
    const url = await Linking.getInitialURL();
    if (!url) return {};

    // Try to parse as a full URL
    let search: string;
    if (url.startsWith('rallia://')) {
      const fakeUrl = new URL(url.replace('rallia://', 'https://rallia.app/'));
      search = fakeUrl.search;
    } else {
      const parsed = new URL(url);
      search = parsed.search;
    }

    const params = new URLSearchParams(search);
    return {
      type: params.get('type') ?? undefined,
      id: params.get('id') ?? undefined,
    };
  } catch {
    return {};
  }
}

function parseInvitationType(type?: string): InvitationType {
  if (type && ['match', 'group', 'community', 'referral'].includes(type)) {
    return type as InvitationType;
  }
  return 'referral';
}

// ============================================================================
// COMPONENT
// ============================================================================

export const InvitationDeepLinkScreen: React.FC<RootStackScreenProps<'InvitationDeepLink'>> = ({
  route,
  navigation,
}) => {
  const { referralCode } = route.params;
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { setPendingMatchId } = useDeepLink();
  const isDark = theme === 'dark';

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

  const handleDeepLink = useCallback(async () => {
    try {
      const query = await extractQueryParams();
      const invitationType = parseInvitationType(query.type);
      const targetId = query.id;

      // Store structured referral data for post-signup attribution
      const pendingReferral: PendingReferral = {
        code: referralCode,
        type: invitationType,
        targetId,
      };
      await AsyncStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(pendingReferral));

      // Navigate based on invitation type
      if (invitationType === 'match' && targetId) {
        setPendingMatchId(targetId);
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      } else if (invitationType === 'group' && targetId) {
        // Navigate to group detail — the invite code is the targetId
        navigation.reset({
          index: 0,
          routes: [{ name: 'Main' }],
        });
        // TODO: Navigate to group join flow once GroupJoin screen exists
      } else if (invitationType === 'community' && targetId) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Main' }],
        });
        // TODO: Navigate to community join flow once CommunityJoin screen exists
      } else {
        // Default: pure referral — go to home
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      }
    } catch (error) {
      console.error('Failed to handle invitation deep link:', error);
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
  }, [referralCode, navigation, setPendingMatchId]);

  useEffect(() => {
    handleDeepLink();
  }, [handleDeepLink]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.content}>
        <Ionicons name="gift-outline" size={64} color={colors.primary} />
        <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
          {t('referral.welcomeTitle')}
        </Text>
        <Text size="base" color={colors.textMuted} style={styles.description}>
          {t('referral.welcomeDescription')}
        </Text>
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      </View>
    </SafeAreaView>
  );
};

// ============================================================================
// STYLES
// ============================================================================

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

export default InvitationDeepLinkScreen;
