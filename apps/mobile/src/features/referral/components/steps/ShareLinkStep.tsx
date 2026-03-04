/**
 * ShareLinkStep - Step 1 of Invite Players Wizard
 *
 * Displays the player's personal referral link with options to:
 * - Copy referral link
 * - Toggle between code view and QR code view
 * - Share via device share sheet
 * - View referral stats (invited / signed up counts)
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Share,
  ActivityIndicator,
  Image,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import type { TranslationKey } from '../../../../hooks';

// ============================================================================
// TYPES
// ============================================================================

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
  progressActive: string;
  progressInactive: string;
}

interface ShareLinkStepProps {
  code: string | undefined;
  codeLoading: boolean;
  referralLink: string | undefined;
  stats: { total_invited: number; total_converted: number } | undefined;
  statsLoading: boolean;
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey) => string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const ShareLinkStep: React.FC<ShareLinkStepProps> = ({
  code,
  codeLoading,
  referralLink,
  stats,
  statsLoading,
  colors,
  isDark,
  t,
}) => {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);

  const qrCodeUrl = referralLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(referralLink)}&bgcolor=${isDark ? '1C1C1E' : 'F2F2F7'}`
    : '';

  const handleCopyLink = useCallback(async () => {
    if (!referralLink) return;
    try {
      await Clipboard.setStringAsync(referralLink);
      setCopied(true);
      toast.success(t('common.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('common.error'));
    }
  }, [referralLink, toast, t]);

  const handleCopyCode = useCallback(async () => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('common.error'));
    }
  }, [code, toast, t]);

  const handleShare = useCallback(async () => {
    if (!referralLink) return;
    try {
      await Share.share({
        message: t('referral.shareMessage').replace('{link}', referralLink),
        title: t('referral.shareTitle'),
      });
    } catch (error) {
      if (error instanceof Error && error.message !== 'User did not share') {
        toast.error(t('common.error'));
      }
    }
  }, [referralLink, t, toast]);

  if (codeLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.buttonActive} />
        <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
          {t('referral.generatingCode')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Description */}
      <Text size="sm" color={colors.textSecondary} style={styles.description}>
        {t('referral.shareLinkDescription')}
      </Text>

      {/* Toggle between Code and QR */}
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            { borderColor: colors.border },
            !showQRCode && { backgroundColor: colors.buttonActive },
            { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
          ]}
          onPress={() => setShowQRCode(false)}
        >
          <Text
            size="sm"
            weight="medium"
            color={!showQRCode ? '#FFFFFF' : colors.textSecondary}
          >
            {t('referral.code')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            { borderColor: colors.border },
            showQRCode && { backgroundColor: colors.buttonActive },
            { borderTopRightRadius: 8, borderBottomRightRadius: 8 },
          ]}
          onPress={() => setShowQRCode(true)}
        >
          <Text
            size="sm"
            weight="medium"
            color={showQRCode ? '#FFFFFF' : colors.textSecondary}
          >
            {t('referral.qrCode')}
          </Text>
        </TouchableOpacity>
      </View>

      {showQRCode ? (
        <View
          style={[styles.qrContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}
        >
          <Image source={{ uri: qrCodeUrl }} style={styles.qrImage} resizeMode="contain" />
          <Text size="xs" color={colors.textMuted} style={styles.qrHint}>
            {t('referral.scanToJoin')}
          </Text>
        </View>
      ) : (
        <View
          style={[styles.codeContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}
        >
          <Text size="xs" color={colors.textMuted} style={styles.codeLabel}>
            {t('referral.yourCode')}
          </Text>
          <TouchableOpacity onPress={handleCopyCode} activeOpacity={0.7}>
            <Text
              weight="bold"
              size="xl"
              color={colors.buttonActive}
              style={styles.codeText}
            >
              {code}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Link Display */}
      <View
        style={[
          styles.linkContainer,
          { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7', borderColor: colors.border },
        ]}
      >
        <Text numberOfLines={1} size="sm" color={colors.text} style={styles.linkText}>
          {referralLink}
        </Text>
        <TouchableOpacity
          onPress={handleCopyLink}
          style={[
            styles.copyButton,
            { backgroundColor: copied ? colors.buttonActive : isDark ? '#3A3A3C' : '#E5E5EA' },
          ]}
        >
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={18}
            color={copied ? '#FFFFFF' : colors.text}
          />
        </TouchableOpacity>
      </View>

      {/* Share Button */}
      <TouchableOpacity
        style={[styles.shareButton, { backgroundColor: colors.buttonActive }]}
        onPress={handleShare}
      >
        <Ionicons name="share-outline" size={20} color="#FFFFFF" />
        <Text weight="semibold" color="#FFFFFF" style={styles.shareButtonText}>
          {t('referral.shareInvite')}
        </Text>
      </TouchableOpacity>

      {/* Referral Stats */}
      <View style={[styles.statsContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
        <Text size="sm" weight="semibold" color={colors.text} style={styles.statsTitle}>
          {t('referral.yourStats')}
        </Text>
        {statsLoading ? (
          <ActivityIndicator size="small" color={colors.buttonActive} />
        ) : (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text size="xl" weight="bold" color={colors.buttonActive}>
                {stats?.total_invited ?? 0}
              </Text>
              <Text size="xs" color={colors.textMuted}>
                {t('referral.invited')}
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text size="xl" weight="bold" color={colors.buttonActive}>
                {stats?.total_converted ?? 0}
              </Text>
              <Text size="xs" color={colors.textMuted}>
                {t('referral.signedUp')}
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacingPixels[6],
    paddingTop: spacingPixels[4],
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacingPixels[3],
  },
  description: {
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  toggleContainer: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginBottom: spacingPixels[4],
  },
  toggleButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  qrContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
  },
  qrImage: {
    width: 180,
    height: 180,
    borderRadius: 8,
  },
  qrHint: {
    marginTop: spacingPixels[2],
  },
  codeContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
  },
  codeLabel: {
    marginBottom: 4,
  },
  codeText: {
    letterSpacing: 4,
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  linkText: {
    flex: 1,
  },
  copyButton: {
    padding: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[6],
  },
  shareButtonText: {
    marginLeft: 8,
  },
  statsContainer: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
  },
  statsTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[3],
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: spacingPixels[6],
  },
  statDivider: {
    width: 1,
    height: 40,
  },
});
