/**
 * SuccessStep Component
 *
 * Final success screen of onboarding - animated celebration with share invite.
 * Shows after completing all onboarding steps.
 * Automatically selects the initial sport, then prompts user to share referral link.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  View,
  Share,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import LottieView from 'lottie-react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { useReferral } from '@rallia/shared-hooks';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import * as Analytics from '../../../../../services/analytics';

const BASE_WHITE = '#ffffff';
import type { TranslationKey } from '@rallia/shared-translations';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  success: string;
}

export interface Sport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

interface SuccessStepProps {
  onComplete: () => void;
  onAdvanceToSuggestions: () => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
  selectedSports: Sport[];
  currentSport: Sport | null;
  onSelectInitialSport: (sport: Sport) => void | Promise<void>;
  playerId?: string | null;
}

export const SuccessStep: React.FC<SuccessStepProps> = ({
  onComplete,
  onAdvanceToSuggestions,
  colors,
  t,
  selectedSports,
  currentSport,
  onSelectInitialSport,
  playerId,
}) => {
  // Track if we've already auto-selected to prevent repeated calls
  const hasAutoSelected = useRef(false);

  // Referral link for sharing
  const { referralLink, codeLoading: referralLoading } = useReferral(playerId ?? undefined);

  // Auto-select initial sport based on current selection
  useEffect(() => {
    if (hasAutoSelected.current || selectedSports.length === 0) return;

    // Check if current sport is still in the selected sports
    const currentStillSelected = currentSport && selectedSports.some(s => s.id === currentSport.id);

    if (currentStillSelected) {
      onSelectInitialSport(currentSport);
    } else {
      onSelectInitialSport(selectedSports[0]);
    }

    hasAutoSelected.current = true;
  }, [selectedSports, currentSport, onSelectInitialSport]);

  // Animation values
  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const shareCardOpacity = useSharedValue(0);
  const shareCardTranslateY = useSharedValue(20);
  const skipOpacity = useSharedValue(0);

  // Trigger animations on mount
  useEffect(() => {
    // Icon animation - pop in with bounce
    iconScale.value = withDelay(200, withSpring(1, { damping: 40, stiffness: 300 }));
    iconOpacity.value = withDelay(200, withTiming(1, { duration: 300 }));

    // Text animation - fade in
    textOpacity.value = withDelay(500, withTiming(1, { duration: 400 }));

    // Share card animation - slide up and fade in
    shareCardOpacity.value = withDelay(900, withTiming(1, { duration: 400 }));
    shareCardTranslateY.value = withDelay(900, withSpring(0, { damping: 40, stiffness: 300 }));

    // Skip link animation - fade in last
    skipOpacity.value = withDelay(1200, withTiming(1, { duration: 400 }));
  }, [iconScale, iconOpacity, textOpacity, shareCardOpacity, shareCardTranslateY, skipOpacity]);

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    opacity: iconOpacity.value,
    transform: [{ scale: iconScale.value }],
  }));

  const textAnimatedStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  const shareCardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: shareCardOpacity.value,
    transform: [{ translateY: shareCardTranslateY.value }],
  }));

  const skipAnimatedStyle = useAnimatedStyle(() => ({
    opacity: skipOpacity.value,
  }));

  const handleShare = useCallback(async () => {
    if (!referralLink) return;
    try {
      lightHaptic();
      const sportName =
        currentSport?.display_name?.toLowerCase() ??
        selectedSports[0]?.display_name?.toLowerCase() ??
        'sports';
      const result = await Share.share({
        message: t('referral.shareMessage' as TranslationKey)
          .replace('{sport}', sportName)
          .replace('{link}', referralLink),
        title: t('referral.shareTitle' as TranslationKey),
      });
      if (result.action === Share.sharedAction) {
        Analytics.invitationLinkGenerated({
          invitation_type: 'onboarding_referral',
          channel: 'share_sheet',
        });
        successHaptic();
      }
    } catch {
      // User cancelled share — no-op
    }
  }, [referralLink, t, currentSport, selectedSports]);

  const handleSkip = useCallback(() => {
    Analytics.onboardingShareSkipped();
    onAdvanceToSuggestions();
  }, [onAdvanceToSuggestions]);

  return (
    <View style={styles.wrapper}>
      {/* Confetti Animation Overlay */}
      <View style={styles.confetti} pointerEvents="none">
        <LottieView
          source={require('../../../../../../assets/animations/confetti.json')}
          autoPlay
          loop={false}
          speed={0.8}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Success Icon */}
        <Animated.View
          style={[
            styles.iconContainer,
            { backgroundColor: colors.buttonActive },
            iconAnimatedStyle,
          ]}
        >
          <Ionicons name="checkmark-outline" size={48} color={BASE_WHITE} />
        </Animated.View>

        {/* Success Text */}
        <Animated.View style={textAnimatedStyle}>
          <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
            {t('onboarding.success.title')}
          </Text>
          <Text size="base" color={colors.textMuted} style={styles.subtitle}>
            {t('onboarding.success.subtitle')}
          </Text>
        </Animated.View>

        {/* Invite Card */}
        <Animated.View style={[styles.inviteCardWrapper, shareCardAnimatedStyle]}>
          <View
            style={[
              styles.inviteCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <Ionicons name="people-outline" size={28} color={colors.buttonActive} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.inviteTitle}>
              {t('onboarding.success.inviteTitle')}
            </Text>
            <Text size="sm" color={colors.textMuted} style={styles.inviteSubtitle}>
              {t('onboarding.success.inviteSubtitle')}
            </Text>

            {/* Primary CTA: Share button */}
            <TouchableOpacity
              style={[styles.shareButton, { backgroundColor: colors.buttonActive }]}
              onPress={handleShare}
              activeOpacity={0.8}
              disabled={referralLoading || !referralLink}
            >
              {referralLoading ? (
                <ActivityIndicator size="small" color={BASE_WHITE} />
              ) : (
                <>
                  <Ionicons name="share-outline" size={20} color={colors.buttonTextActive} />
                  <Text
                    size="base"
                    weight="semibold"
                    color={colors.buttonTextActive}
                    style={styles.shareButtonText}
                  >
                    {t('onboarding.success.shareButton')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Secondary: Maybe later */}
        <Animated.View style={skipAnimatedStyle}>
          <TouchableOpacity onPress={handleSkip} activeOpacity={0.6} style={styles.skipButton}>
            <Text size="sm" color={colors.textMuted} style={styles.maybeLater}>
              {t('onboarding.success.maybeLater')}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  confetti: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  inviteCardWrapper: {
    width: '100%',
  },
  inviteCard: {
    width: '100%',
    alignItems: 'center',
    padding: spacingPixels[5],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  inviteTitle: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  inviteSubtitle: {
    textAlign: 'center',
    marginTop: spacingPixels[1],
    marginBottom: spacingPixels[4],
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    width: '100%',
  },
  shareButtonText: {
    marginLeft: spacingPixels[2],
  },
  skipButton: {
    paddingVertical: spacingPixels[3],
  },
  maybeLater: {
    textAlign: 'center',
  },
});

export default SuccessStep;
