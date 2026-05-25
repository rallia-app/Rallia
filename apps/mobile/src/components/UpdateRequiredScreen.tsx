/**
 * UpdateRequiredScreen — full-screen blocking gate shown when the installed
 * binary is below `app_min_version.min_supported_version` for the platform.
 *
 * Rendered above everything else by <UpdateGate> in App.tsx, so it doesn't
 * sit inside any navigation context — it's the only thing on the screen.
 * Tapping "Update Now" deep-links to the App Store / Play Store; the user
 * has nowhere else to go.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, primary } from '@rallia/design-system';
import { useThemeStyles, useTranslation } from '../hooks';

interface UpdateRequiredScreenProps {
  storeUrl: string | null;
  currentVersion: string | null;
  requiredVersion: string | null;
}

const FALLBACK_STORE_URL =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/app/id6760482014'
    : 'https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp';

export function UpdateRequiredScreen({
  storeUrl,
  currentVersion,
  requiredVersion,
}: UpdateRequiredScreenProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const handleUpdate = useCallback(() => {
    const url = storeUrl ?? FALLBACK_STORE_URL;
    Linking.openURL(url).catch(() => {});
  }, [storeUrl]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: primary[100] }]}>
          <Ionicons name="arrow-up-circle-outline" size={56} color={primary[600]} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>{t('update.required.title')}</Text>

        <Text variant="body" style={[styles.description, { color: colors.textSecondary }]}>
          {t('update.required.description')}
        </Text>

        {currentVersion && requiredVersion ? (
          <Text variant="caption" style={[styles.versionInfo, { color: colors.textSecondary }]}>
            {t('update.required.versionInfo', {
              current: currentVersion,
              required: requiredVersion,
            })}
          </Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Button variant="primary" size="lg" onPress={handleUpdate} fullWidth>
          {t('update.required.cta')}
        </Button>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacingPixels[6],
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[4],
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    paddingHorizontal: spacingPixels[4],
  },
  versionInfo: {
    textAlign: 'center',
    marginTop: spacingPixels[2],
  },
  footer: {
    paddingBottom: spacingPixels[6],
  },
});
