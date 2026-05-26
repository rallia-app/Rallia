/**
 * ShareLinkStep - Invite Players content
 *
 * Three tabs:
 * - Code: referral code display + copy + share + stats
 * - QR Code: scannable QR code
 * - Contacts: device contacts picker with SMS compose
 *
 * When a contest is active, a compact banner is shown above the tabs on every
 * tab. Tapping the banner expands an inline leaderboard.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Share,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
} from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast, Button } from '@rallia/shared-components';
import QRCode from 'react-native-qrcode-svg';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import type { ReferralContest, ReferralLeaderboardEntry, ContestRank } from '@rallia/shared-hooks';

import type { TranslationKey } from '#/hooks';
import { useSport } from '#/context';
import { ContestLeaderboard } from '#/features/referral/components/ContestLeaderboard';
import * as Analytics from '#/services/analytics';

import { InviteContactsStep } from './InviteContactsStep';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  contest: ReferralContest | null;
  leaderboard: ReferralLeaderboardEntry[];
  myRank: ContestRank | null;
  playerId: string | undefined;
}

// ============================================================================
// COUNTDOWN HELPERS
// ============================================================================

function useCountdown(endAt: string | undefined) {
  const getRemaining = useCallback(() => {
    if (!endAt) return { days: 0, hours: 0, expired: true };
    const diff = new Date(endAt).getTime() - Date.now();
    if (diff <= 0) return { days: 0, hours: 0, expired: true };
    return {
      days: Math.floor(diff / 86_400_000),
      hours: Math.floor((diff % 86_400_000) / 3_600_000),
      expired: false,
    };
  }, [endAt]);

  const [remaining, setRemaining] = useState(getRemaining);

  React.useEffect(() => {
    const id = setInterval(() => setRemaining(getRemaining()), 60_000);
    return () => clearInterval(id);
  }, [getRemaining]);

  return remaining;
}

// ============================================================================
// CONTEST BANNER (compact, always-visible, expandable)
// ============================================================================

interface ContestBannerProps {
  contest: ReferralContest;
  leaderboard: ReferralLeaderboardEntry[];
  myRank: ContestRank | null;
  referralLink: string | undefined;
  playerId: string | undefined;
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey) => string;
  expanded: boolean;
  onToggle: () => void;
}

const ContestBanner: React.FC<ContestBannerProps> = ({
  contest,
  leaderboard,
  myRank,
  referralLink,
  playerId,
  colors,
  isDark,
  t,
  expanded,
  onToggle,
}) => {
  const { days, hours, expired } = useCountdown(contest.endAt);

  // Pulsing trophy
  const trophyScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(trophyScale, { toValue: 1.3, duration: 600, useNativeDriver: true }),
        Animated.timing(trophyScale, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.delay(2400),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const toggle = () => {
    lightHaptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  const hasRank = myRank && myRank.rank > 0;

  return (
    <View style={[styles.bannerWrapper, { borderColor: `${colors.buttonActive}40` }]}>
      {/* Compact strip — always visible */}
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.8}
        style={[styles.bannerStrip, { backgroundColor: `${colors.buttonActive}14` }]}
      >
        <Animated.View style={{ transform: [{ scale: trophyScale }] }}>
          <Ionicons name="trophy-outline" size={16} color={colors.buttonActive} />
        </Animated.View>

        <View style={styles.bannerInfo}>
          <Text size="xs" weight="semibold" color={colors.buttonActive} numberOfLines={1}>
            {contest.title}
          </Text>
          <Text size="xs" color={colors.textSecondary} numberOfLines={1}>
            {contest.prizeDescription}
          </Text>
        </View>

        <View style={styles.bannerRight}>
          {/* User's rank badge */}
          {hasRank && (
            <View style={[styles.rankBadge, { backgroundColor: `${colors.buttonActive}20` }]}>
              <Text size="xs" weight="bold" color={colors.buttonActive}>
                #{myRank.rank}
              </Text>
            </View>
          )}
          {/* Countdown */}
          {!expired && (
            <Text size="xs" weight="semibold" color={colors.textMuted} style={{ marginLeft: 6 }}>
              {days > 0 ? `${days}d` : `${hours}h`}
            </Text>
          )}
          <Ionicons
            name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={14}
            color={colors.textMuted}
            style={{ marginLeft: 4 }}
          />
        </View>
      </TouchableOpacity>

      {/* Expanded leaderboard */}
      {expanded && (
        <View style={[styles.bannerLeaderboard, { borderTopColor: `${colors.buttonActive}30` }]}>
          <ContestLeaderboard
            contest={contest}
            leaderboard={leaderboard}
            myRank={myRank}
            referralLink={referralLink}
            playerId={playerId}
            colors={colors}
            isDark={isDark}
            t={t}
            compact
          />
        </View>
      )}
    </View>
  );
};

// ============================================================================
// TAB BAR
// ============================================================================

const TABS: Array<{ id: TabId; icon: string; labelKey: TranslationKey }> = [
  { id: 'code', icon: 'code-slash-outline', labelKey: 'referral.code' },
  { id: 'qr', icon: 'qr-code-outline', labelKey: 'referral.qrCode' },
  { id: 'contacts', icon: 'people-outline', labelKey: 'referral.stepNames.inviteContacts' },
];

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey) => string;
}

const TabBar: React.FC<TabBarProps> = ({ activeTab, onTabChange, colors, t }) => (
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
            style={{ color: isActive ? colors.buttonActive : colors.textMuted, marginLeft: 4 }}
          >
            {t(tab.labelKey)}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

// ============================================================================
// SHARED HEADER (banner + tab bar, rendered above every tab)
// ============================================================================

interface TabHeaderProps {
  contest: ReferralContest | null;
  leaderboard: ReferralLeaderboardEntry[];
  myRank: ContestRank | null;
  referralLink: string | undefined;
  playerId: string | undefined;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey) => string;
  description?: string;
  bannerExpanded: boolean;
  onBannerToggle: () => void;
}

const TabHeader: React.FC<TabHeaderProps> = ({
  contest,
  leaderboard,
  myRank,
  referralLink,
  playerId,
  activeTab,
  onTabChange,
  colors,
  isDark,
  t,
  description,
  bannerExpanded,
  onBannerToggle,
}) => (
  <View style={styles.tabHeaderWrapper}>
    {contest && (
      <ContestBanner
        contest={contest}
        leaderboard={leaderboard}
        myRank={myRank}
        referralLink={referralLink}
        playerId={playerId}
        colors={colors}
        isDark={isDark}
        t={t}
        expanded={bannerExpanded}
        onToggle={onBannerToggle}
      />
    )}
    {description && (
      <Text size="sm" color={colors.textSecondary} style={styles.description}>
        {description}
      </Text>
    )}
    <TabBar activeTab={activeTab} onTabChange={onTabChange} colors={colors} isDark={isDark} t={t} />
  </View>
);

// ============================================================================
// MAIN COMPONENT
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
  contest,
  leaderboard,
  myRank,
  playerId,
}) => {
  const toast = useToast();
  const { selectedSport } = useSport();
  const [copied, setCopied] = useState(false);
  const [bannerExpanded, setBannerExpanded] = useState(false);

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
      const result = await Share.share({
        message: t('referral.shareMessage')
          .replace('{sport}', selectedSport?.display_name?.toLowerCase() ?? 'sports')
          .replace('{link}', referralLink),
        title: t('referral.shareTitle'),
      });
      if (result.action === Share.sharedAction) {
        Analytics.invitationLinkGenerated({ invitation_type: 'referral', channel: 'share_sheet' });
      }
    } catch (error) {
      if (error instanceof Error && error.message !== 'User did not share') {
        toast.error(t('common.error'));
      }
    }
  }, [referralLink, t, toast, selectedSport]);

  const sharedHeaderProps = {
    contest,
    leaderboard,
    myRank,
    referralLink,
    playerId,
    activeTab,
    onTabChange,
    colors,
    isDark,
    t,
    bannerExpanded,
    onBannerToggle: () => setBannerExpanded(v => !v),
  };

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

  // Both panels stay mounted at all times — toggling display:none preserves
  // InviteContactsStep's contacts-loaded state across tab switches.
  return (
    <View style={styles.flex}>
      {/* Contacts panel — always mounted */}
      <View style={[styles.flex, activeTab !== 'contacts' && styles.hidden]}>
        <InviteContactsStep
          referralLink={referralLink}
          colors={colors}
          isDark={isDark}
          t={t}
          listHeader={
            <TabHeader {...sharedHeaderProps} description={t('referral.contacts.description')} />
          }
        />
      </View>

      {/* Code / QR panel — always mounted */}
      <SheetScrollView
        style={[styles.flex, activeTab === 'contacts' && styles.hidden]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TabHeader {...sharedHeaderProps} description={t('referral.shareLinkDescription')} />
        <View style={[styles.container, { paddingBottom: spacingPixels[6] }]}>
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
      </SheetScrollView>
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: 'none' },
  scrollContent: { flexGrow: 1 },
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
  loadingText: { marginTop: spacingPixels[3] },
  tabHeaderWrapper: {
    paddingHorizontal: spacingPixels[6],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  description: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  // Contest banner
  bannerWrapper: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: spacingPixels[4],
  },
  bannerStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    gap: spacingPixels[2],
  },
  bannerInfo: { flex: 1 },
  bannerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rankBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  bannerLeaderboard: {
    borderTopWidth: 1,
    maxHeight: 360,
  },
  // Tab bar
  tabBar: {
    flexDirection: 'row',
    marginBottom: spacingPixels[4],
    borderRadius: 12,
    padding: 4,
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
  // Tab content
  qrContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
  },
  qrHint: { marginTop: spacingPixels[2] },
  codeContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[4],
  },
  codeLabel: { marginBottom: 4 },
  codeText: { letterSpacing: 4 },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  linkText: { flex: 1 },
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
