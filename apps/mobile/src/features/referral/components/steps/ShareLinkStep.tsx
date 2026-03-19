/**
 * ShareLinkStep - Invite Players content
 *
 * Three tabs:
 * - Code: referral code display + copy + share + stats
 * - QR Code: scannable QR code
 * - Contacts: device contacts picker with SMS compose
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Share,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast, Button } from '@rallia/shared-components';
import QRCode from 'react-native-qrcode-svg';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import type { TranslationKey } from '../../../../hooks';
import { InviteContactsStep } from './InviteContactsStep';

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

type TabId = 'code' | 'qr' | 'contacts';

interface ShareLinkStepProps {
  code: string | undefined;
  codeLoading: boolean;
  referralLink: string | undefined;
  stats: { total_clicked: number; total_converted: number } | undefined;
  statsLoading: boolean;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey) => string;
}

// ============================================================================
// TAB BAR
// ============================================================================

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey) => string;
}

const TABS: Array<{ id: TabId; icon: string; labelKey: TranslationKey }> = [
  { id: 'code', icon: 'code-slash-outline', labelKey: 'referral.code' },
  { id: 'qr', icon: 'qr-code-outline', labelKey: 'referral.qrCode' },
  { id: 'contacts', icon: 'people-outline', labelKey: 'referral.stepNames.inviteContacts' },
];

const TabBar: React.FC<TabBarProps> = ({ activeTab, onTabChange, colors, isDark, t }) => (
  <View style={[styles.tabBar, { backgroundColor: colors.buttonInactive }]}>
    {TABS.map(tab => {
      const isActive = activeTab === tab.id;
      return (
        <TouchableOpacity
          key={tab.id}
          style={[
            styles.tab,
            isActive && [styles.activeTab, { backgroundColor: colors.cardBackground }],
          ]}
          onPress={() => {
            lightHaptic();
            onTabChange(tab.id);
          }}
          activeOpacity={0.8}
        >
          <Ionicons
            name={tab.icon as any}
            size={18}
            color={isActive ? colors.buttonActive : colors.textMuted}
          />
          <Text
            size="xs"
            weight={isActive ? 'semibold' : 'medium'}
            style={{
              color: isActive ? colors.buttonActive : colors.textMuted,
              marginLeft: 4,
            }}
          >
            {t(tab.labelKey)}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

// ============================================================================
// COMPONENT
// ============================================================================

export const ShareLinkStep: React.FC<ShareLinkStepProps> = ({
  code,
  codeLoading,
  referralLink,
  stats,
  statsLoading,
  activeTab,
  onTabChange,
  colors,
  isDark,
  t,
}) => {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

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

  // Contacts tab renders its own full-screen layout (with FlatList + footer)
  if (activeTab === 'contacts') {
    return (
      <View style={styles.flex}>
        <View style={styles.tabBarWrapper}>
          <Text size="sm" color={colors.textSecondary} style={styles.description}>
            {t('referral.contacts.description')}
          </Text>
          <TabBar
            activeTab={activeTab}
            onTabChange={onTabChange}
            colors={colors}
            isDark={isDark}
            t={t}
          />
        </View>
        <InviteContactsStep referralLink={referralLink} colors={colors} isDark={isDark} t={t} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          {/* Description */}
          <Text size="sm" color={colors.textSecondary} style={styles.description}>
            {t('referral.shareLinkDescription')}
          </Text>

          {/* Tab Bar */}
          <TabBar
            activeTab={activeTab}
            onTabChange={onTabChange}
            colors={colors}
            isDark={isDark}
            t={t}
          />

          {/* Tab Content */}
          {activeTab === 'qr' ? (
            <View style={[styles.qrContainer, { backgroundColor: colors.buttonInactive }]}>
              {referralLink && (
                <QRCode
                  value={referralLink}
                  size={180}
                  backgroundColor={colors.buttonInactive}
                  color={colors.text}
                />
              )}
              <Text size="xs" color={colors.textMuted} style={styles.qrHint}>
                {t('referral.scanToJoin')}
              </Text>
            </View>
          ) : (
            <View style={[styles.codeContainer, { backgroundColor: colors.buttonInactive }]}>
              <Text size="xs" color={colors.textMuted} style={styles.codeLabel}>
                {t('referral.yourCode')}
              </Text>
              <TouchableOpacity onPress={handleCopyCode} activeOpacity={0.7}>
                <Text weight="bold" size="xl" color={colors.buttonActive} style={styles.codeText}>
                  {code}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Link Display */}
          <View
            style={[
              styles.linkContainer,
              { backgroundColor: colors.buttonInactive, borderColor: colors.border },
            ]}
          >
            <Text numberOfLines={1} size="sm" color={colors.text} style={styles.linkText}>
              {referralLink}
            </Text>
            <TouchableOpacity
              onPress={handleCopyLink}
              style={[
                styles.copyButton,
                { backgroundColor: copied ? colors.buttonActive : colors.border },
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
          <Button
            variant="primary"
            size="md"
            fullWidth
            onPress={handleShare}
            leftIcon={<Ionicons name="share-outline" size={20} color="#FFFFFF" />}
            isDark={isDark}
            style={styles.shareButtonSpacing}
          >
            {t('referral.shareInvite')}
          </Button>

          {/* Referral Stats */}
          <View style={[styles.statsContainer, { backgroundColor: colors.buttonInactive }]}>
            <Text size="sm" weight="semibold" color={colors.text} style={styles.statsTitle}>
              {t('referral.yourStats')}
            </Text>
            {statsLoading ? (
              <ActivityIndicator size="small" color={colors.buttonActive} />
            ) : (
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text size="xl" weight="bold" color={colors.buttonActive}>
                    {stats?.total_clicked ?? 0}
                  </Text>
                  <Text size="xs" color={colors.textMuted}>
                    {t('referral.clicked')}
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
      </ScrollView>
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacingPixels[6],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[6],
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
  tabBar: {
    flexDirection: 'row',
    marginBottom: spacingPixels[4],
    borderRadius: 12,
    padding: 4,
  },
  tabBarWrapper: {
    paddingHorizontal: spacingPixels[6],
    paddingTop: spacingPixels[4],
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  qrContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
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
  shareButtonSpacing: {
    marginBottom: spacingPixels[6],
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
