import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, Button } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { CompletenessTier, CompletenessItem } from '@rallia/shared-hooks';
import ProfileCompletionRing from './ProfileCompletionRing';
import { getTierColors } from '../completionTierColors';

// =============================================================================
// CONSTANTS
// =============================================================================

const STORAGE_KEY_DISMISS_COUNT = '@rallia/profile-completion-banner-dismiss-count';
const STORAGE_KEY_COOLDOWN = '@rallia/profile-completion-banner-cooldown';
const MAX_DISMISSALS = 3;

/** Escalating cooldowns: 24h, 72h, then permanent */
const COOLDOWN_MS = [
  24 * 60 * 60 * 1000, // 24 hours
  72 * 60 * 60 * 1000, // 72 hours
];

// =============================================================================
// PROPS
// =============================================================================

interface ProfileCompletionBannerProps {
  percentage: number;
  tier: CompletenessTier;
  nextAction: CompletenessItem | null;
  isComplete: boolean;
  loading: boolean;
  onAction: (item: CompletenessItem) => void;
  colors: {
    card: string;
    text: string;
    textMuted: string;
    primary: string;
    border: string;
  };
  isDark: boolean;
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
}

// =============================================================================
// COMPONENT
// =============================================================================

const ProfileCompletionBanner: React.FC<ProfileCompletionBannerProps> = ({
  percentage,
  tier,
  nextAction,
  isComplete,
  loading,
  onAction,
  colors,
  isDark,
  t,
}) => {
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  // Check dismissal state on mount
  useEffect(() => {
    (async () => {
      try {
        const [countStr, cooldownStr] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_DISMISS_COUNT),
          AsyncStorage.getItem(STORAGE_KEY_COOLDOWN),
        ]);

        const dismissCount = countStr ? parseInt(countStr, 10) : 0;

        // Permanently dismissed
        if (dismissCount >= MAX_DISMISSALS) {
          setVisible(false);
          setReady(true);
          return;
        }

        // Check cooldown
        if (cooldownStr) {
          const cooldownUntil = parseInt(cooldownStr, 10);
          if (Date.now() < cooldownUntil) {
            setVisible(false);
            setReady(true);
            return;
          }
        }

        setVisible(true);
      } catch {
        setVisible(true);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Clear dismissal storage when profile becomes complete
  useEffect(() => {
    if (isComplete) {
      AsyncStorage.multiRemove([STORAGE_KEY_DISMISS_COUNT, STORAGE_KEY_COOLDOWN]).catch(() => {});
    }
  }, [isComplete]);

  const handleDismiss = useCallback(async () => {
    void lightHaptic();
    setVisible(false);
    try {
      const countStr = await AsyncStorage.getItem(STORAGE_KEY_DISMISS_COUNT);
      const dismissCount = countStr ? parseInt(countStr, 10) : 0;
      const newCount = dismissCount + 1;

      await AsyncStorage.setItem(STORAGE_KEY_DISMISS_COUNT, newCount.toString());

      if (newCount < MAX_DISMISSALS) {
        const cooldownMs = COOLDOWN_MS[Math.min(newCount - 1, COOLDOWN_MS.length - 1)];
        await AsyncStorage.setItem(STORAGE_KEY_COOLDOWN, (Date.now() + cooldownMs).toString());
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  if (!ready || loading || isComplete || !visible || !nextAction) return null;

  const tierColors = getTierColors(tier, isDark);
  const accentColor = tierColors.accent;
  const trackColor = tierColors.trackColor;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.content}>
        <ProfileCompletionRing
          percentage={percentage}
          size={40}
          strokeWidth={4}
          color={accentColor}
          trackColor={trackColor}
          labelColor={colors.text}
        />
        <View style={styles.textContainer}>
          <Text size="sm" weight="semibold" style={{ color: colors.text }} numberOfLines={1}>
            {t('profileCompletion.bannerTitle', { percentage })}
          </Text>
          <Text size="xs" style={{ color: colors.textMuted }} numberOfLines={1}>
            {t(nextAction.labelKey)}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          variant="primary"
          size="xs"
          onPress={() => {
            void lightHaptic();
            onAction(nextAction);
          }}
        >
          {t('profileCompletion.bannerCta')}
        </Button>
        <TouchableOpacity
          onPress={handleDismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacingPixels[2],
    gap: spacingPixels[2.5],
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
});

export default ProfileCompletionBanner;
