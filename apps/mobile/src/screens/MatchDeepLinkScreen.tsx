/**
 * MatchDeepLinkScreen
 * Handles /match/:matchId deep links from Universal Links / App Links.
 * Stores the match ID in DeepLinkContext, then navigates to Home where
 * the match detail sheet will open automatically.
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { lightTheme, darkTheme, spacingPixels, primary } from '@rallia/design-system';
import { useDeepLink } from '../context';
import type { RootStackScreenProps } from '../navigation/types';

export const MatchDeepLinkScreen: React.FC<RootStackScreenProps<'MatchDeepLink'>> = ({
  route,
  navigation,
}) => {
  const { matchId } = route.params;
  const { theme } = useTheme();
  const { setPendingMatchId } = useDeepLink();
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

  const handleDeepLink = useCallback(() => {
    setPendingMatchId(matchId);
    navigation.reset({
      index: 0,
      routes: [{ name: 'Main' }],
    });
  }, [matchId, navigation, setPendingMatchId]);

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
