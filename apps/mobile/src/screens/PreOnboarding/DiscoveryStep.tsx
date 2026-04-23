/**
 * DiscoveryStep - Fourth step of the pre-onboarding wizard
 *
 * Asks "How did you hear about us?" with tappable chips.
 * Tapping a chip auto-advances — except "Friend", which reveals an inline
 * referral code input so the user can manually attach their invitation
 * before continuing. Skippable.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import {
  mediumHaptic,
  sanitizeReferralCode,
  isReferralCodeComplete,
  REFERRAL_CODE_LENGTH,
} from '@rallia/shared-utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeStyles, useTranslation } from '../../hooks';
import { PENDING_REFERRAL_KEY } from '../../navigation/deepLinkStore';
import * as Analytics from '../../services/analytics';
import type { TranslationKey } from '../../hooks';

interface DiscoveryStepProps {
  onContinue: (channel: string | null) => void;
  isActive?: boolean;
}

type Mode = 'chips' | 'friendCode';

const CHANNELS: Array<{ id: string; labelKey: TranslationKey; icon: string }> = [
  { id: 'friend', labelKey: 'preOnboarding.discovery.options.friend', icon: 'people-outline' },
  { id: 'social', labelKey: 'preOnboarding.discovery.options.social', icon: 'logo-instagram' },
  {
    id: 'app_store',
    labelKey: 'preOnboarding.discovery.options.appStore',
    icon: 'phone-portrait-outline',
  },
  { id: 'event', labelKey: 'preOnboarding.discovery.options.event', icon: 'document-text-outline' },
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

  const [mode, setMode] = useState<Mode>('chips');
  const [code, setCode] = useState('');

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
      if (channelId === 'friend') {
        setMode('friendCode');
        return;
      }
      onContinue(channelId);
    },
    [onContinue]
  );

  const handleSkip = useCallback(() => {
    mediumHaptic();
    onContinue(null);
  }, [onContinue]);

  const handleBackToChips = useCallback(() => {
    mediumHaptic();
    setCode('');
    setMode('chips');
  }, []);

  const handleApplyCode = useCallback(async () => {
    if (!isReferralCodeComplete(code)) return;
    mediumHaptic();
    try {
      await AsyncStorage.setItem(
        PENDING_REFERRAL_KEY,
        JSON.stringify({ code, type: 'referral', enteredManually: true })
      );
      Analytics.referralAttributed({
        invitation_type: 'referral',
        referral_code: code,
      });
    } catch {
      // Silently fail — attribution will be attempted later
    }
    onContinue('friend');
  }, [code, onContinue]);

  const handleNoCode = useCallback(() => {
    mediumHaptic();
    onContinue('friend');
  }, [onContinue]);

  if (!isActive) return null;

  const codeReady = isReferralCodeComplete(code);

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
              name={mode === 'friendCode' ? 'people-outline' : 'chatbubble-ellipses-outline'}
              size={36}
              color={isDark ? primary[400] : primary[600]}
            />
          </View>

          <Text size="xl" weight="bold" color={colors.foreground} style={styles.title}>
            {mode === 'friendCode'
              ? t('preOnboarding.discovery.friendCodePrompt')
              : t('preOnboarding.discovery.title')}
          </Text>

          <Text size="sm" color={colors.textMuted} style={styles.subtitle}>
            {mode === 'friendCode'
              ? t('preOnboarding.discovery.friendCodeSubtitle')
              : t('preOnboarding.discovery.subtitle')}
          </Text>
        </Animated.View>

        {mode === 'chips' ? (
          <>
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
                    <Text
                      size="sm"
                      weight="medium"
                      color={colors.foreground}
                      style={styles.chipLabel}
                    >
                      {t(channel.labelKey)}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              ))}
            </View>

            {/* Skip */}
            <Animated.View
              entering={FadeInDown.delay(550).springify()}
              style={styles.skipContainer}
            >
              <TouchableOpacity onPress={handleSkip} activeOpacity={0.6}>
                <Text size="sm" color={colors.textMuted} style={styles.skipText}>
                  {t('preOnboarding.discovery.skip')}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </>
        ) : (
          <Animated.View
            entering={FadeInDown.delay(100).springify()}
            style={styles.friendCodeSection}
          >
            <TextInput
              placeholder={t('referral.enterCode')}
              placeholderTextColor={colors.textMuted}
              value={code}
              onChangeText={text => setCode(sanitizeReferralCode(text))}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={REFERRAL_CODE_LENGTH}
              returnKeyType="done"
              onSubmitEditing={handleApplyCode}
              style={[
                styles.codeInput,
                {
                  backgroundColor: isDark ? neutral[800] : neutral[50],
                  borderColor: isDark ? neutral[700] : neutral[200],
                  color: colors.foreground,
                },
              ]}
            />

            <TouchableOpacity
              onPress={handleApplyCode}
              disabled={!codeReady}
              activeOpacity={0.8}
              style={[
                styles.applyButton,
                {
                  backgroundColor: codeReady
                    ? isDark
                      ? primary[500]
                      : primary[600]
                    : isDark
                      ? neutral[700]
                      : neutral[200],
                },
              ]}
            >
              <Text size="base" weight="semibold" color={codeReady ? '#FFFFFF' : colors.textMuted}>
                {t('preOnboarding.discovery.applyCode')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleNoCode}
              activeOpacity={0.6}
              style={styles.noCodeButton}
            >
              <Text size="sm" color={colors.textMuted} style={styles.noCodeText}>
                {t('preOnboarding.discovery.noCode')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleBackToChips}
              activeOpacity={0.6}
              style={styles.backLink}
            >
              <Ionicons
                name="chevron-back-outline"
                size={16}
                color={isDark ? primary[400] : primary[600]}
              />
              <Text size="sm" color={isDark ? primary[400] : primary[600]}>
                {t('common.back')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}
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
  friendCodeSection: {
    marginTop: spacingPixels[6],
    gap: spacingPixels[3],
  },
  codeInput: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1.5,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    fontSize: 18,
    letterSpacing: 2,
    textAlign: 'center',
    fontWeight: '600',
  },
  applyButton: {
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noCodeButton: {
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
  },
  noCodeText: {
    textAlign: 'center',
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[2],
    marginTop: spacingPixels[2],
  },
});

export default DiscoveryStep;
