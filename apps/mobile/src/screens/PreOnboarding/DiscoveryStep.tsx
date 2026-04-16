/**
 * DiscoveryStep - Fourth step of the pre-onboarding wizard
 *
 * Asks "How did you hear about us?" with tappable chips.
 * Tapping a chip auto-advances. Skippable.
 */

import React, { useCallback, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import { mediumHaptic } from '@rallia/shared-utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeStyles, useTranslation } from '../../hooks';
import { PENDING_REFERRAL_KEY } from '../../navigation/deepLinkStore';
import type { TranslationKey } from '../../hooks';

interface DiscoveryStepProps {
  onContinue: (channel: string | null) => void;
  isActive?: boolean;
}

const CHANNELS: Array<{ id: string; labelKey: TranslationKey; icon: string }> = [
  { id: 'friend', labelKey: 'preOnboarding.discovery.options.friend', icon: 'people-outline' },
  { id: 'social', labelKey: 'preOnboarding.discovery.options.social', icon: 'logo-instagram' },
  {
    id: 'app_store',
    labelKey: 'preOnboarding.discovery.options.appStore',
    icon: 'phone-portrait-outline',
  },
  { id: 'event', labelKey: 'preOnboarding.discovery.options.event', icon: 'trophy-outline' },
  { id: 'search', labelKey: 'preOnboarding.discovery.options.search', icon: 'search-outline' },
  {
    id: 'other',
    labelKey: 'preOnboarding.discovery.options.other',
    icon: 'ellipsis-horizontal-outline',
  },
];

export function DiscoveryStep({ onContinue, isActive = true }: DiscoveryStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  // Auto-skip if user arrived via referral link
  useEffect(() => {
    if (!isActive) return;
    AsyncStorage.getItem(PENDING_REFERRAL_KEY).then(value => {
      if (value) {
        onContinue(null);
      }
    });
  }, [isActive, onContinue]);

  const handleSelect = useCallback(
    (channelId: string) => {
      mediumHaptic();
      onContinue(channelId);
    },
    [onContinue]
  );

  const handleSkip = useCallback(() => {
    mediumHaptic();
    onContinue(null);
  }, [onContinue]);

  if (!isActive) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.inner}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.delay(50).springify()} style={styles.headerSection}>
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)' },
            ]}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={36}
              color={isDark ? primary[400] : primary[600]}
            />
          </View>

          <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
            {t('preOnboarding.discovery.title')}
          </Text>

          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {t('preOnboarding.discovery.subtitle')}
          </Text>
        </Animated.View>

        {/* Chips Grid */}
        <View style={styles.chipsGrid}>
          {CHANNELS.map((channel, index) => (
            <Animated.View
              key={channel.id}
              entering={FadeInDown.delay(150 + index * 60).springify()}
              style={styles.chipWrapper}
            >
              <TouchableOpacity
                style={[
                  styles.chip,
                  {
                    backgroundColor: isDark ? neutral[800] : neutral[50],
                    borderColor: isDark ? neutral[700] : neutral[200],
                  },
                ]}
                onPress={() => handleSelect(channel.id)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={channel.icon as any}
                  size={22}
                  color={isDark ? primary[400] : primary[600]}
                />
                <Text size="sm" weight="medium" color={colors.foreground} style={styles.chipLabel}>
                  {t(channel.labelKey)}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </View>

        {/* Skip */}
        <Animated.View entering={FadeInDown.delay(550).springify()} style={styles.skipContainer}>
          <TouchableOpacity onPress={handleSkip} activeOpacity={0.6}>
            <Text size="sm" color={colors.textMuted} style={styles.skipText}>
              {t('preOnboarding.discovery.skip')}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flexGrow: 1,
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[4],
  },
  headerSection: {
    paddingTop: spacingPixels[2],
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[3],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacingPixels[2],
    paddingTop: spacingPixels[2],
  },
  chipsGrid: {
    flexDirection: 'column',
    marginTop: spacingPixels[6],
    gap: spacingPixels[3],
  },
  chipWrapper: {
    width: '100%',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1.5,
    gap: spacingPixels[2],
  },
  chipLabel: {
    flex: 1,
  },
  skipContainer: {
    alignItems: 'center',
    marginTop: spacingPixels[6],
    paddingBottom: spacingPixels[4],
  },
  skipText: {
    textAlign: 'center',
    paddingVertical: spacingPixels[2],
  },
});

export default DiscoveryStep;
