/**
 * InviteLinkModal
 * Modal showing the group invite link with options to copy, share, and generate QR code
 *
 * Visual design aligned with the referral InvitePlayersWizard / ShareLinkStep.
 */

import React, { useCallback, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Share, Alert, ActivityIndicator } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Text, useToast, Button } from '@rallia/shared-components';
import {
  useGroupInviteCode,
  useResetGroupInviteCode,
  useReferral,
  getGroupInviteLink,
  getCommunityInviteLink,
} from '@rallia/shared-hooks';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';
import * as Analytics from '#/services/analytics';

// =============================================================================
// TAB BAR
// =============================================================================

type InviteTabId = 'code' | 'qr';

const INVITE_TABS: Array<{ id: InviteTabId; icon: string; labelKey: TranslationKey }> = [
  { id: 'code', icon: 'code-slash-outline', labelKey: 'groups.code' },
  { id: 'qr', icon: 'qr-code-outline', labelKey: 'groups.qrCode' },
];

interface TabBarProps {
  activeTab: InviteTabId;
  onTabChange: (tab: InviteTabId) => void;
  colors: ReturnType<typeof useThemeStyles>['colors'];
  t: (key: TranslationKey) => string;
}

const TabBar: React.FC<TabBarProps> = ({ activeTab, onTabChange, colors, t }) => (
  <View style={[styles.tabBar, { backgroundColor: colors.buttonInactive }]}>
    {INVITE_TABS.map(tab => {
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

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function InviteLinkActionSheet({ payload }: SheetProps<'invite-link'>) {
  const groupId = payload?.groupId ?? '';
  const groupName = payload?.groupName ?? '';
  const currentUserId = payload?.currentUserId ?? '';
  const isModerator = payload?.isModerator ?? false;
  const type = payload?.type ?? 'group';

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<InviteTabId>('code');

  const handleClose = useCallback(() => {
    setCopied(false);
    setActiveTab('code');
    SheetManager.hide('invite-link');
  }, []);

  // Use proper terminology based on type
  const typeLabel = type === 'community' ? t('groups.community') : t('groups.group');
  const typeLabelCapitalized =
    type === 'community' ? t('groups.communityCapital') : t('groups.groupCapital');

  const { data: inviteCode, isLoading, refetch } = useGroupInviteCode(groupId);
  const resetInviteCodeMutation = useResetGroupInviteCode();
  const { code: referralCode } = useReferral(currentUserId || undefined);

  const getInviteLink = type === 'community' ? getCommunityInviteLink : getGroupInviteLink;
  const inviteLink = inviteCode
    ? getInviteLink(inviteCode, referralCode, {
        utm_source: 'app_share',
        utm_medium: 'referral',
        utm_campaign: type === 'community' ? 'community_invite_2026' : 'group_invite_2026',
        utm_content: 'invite_modal',
      })
    : '';

  const handleCopyLink = useCallback(async () => {
    if (!inviteLink) return;

    try {
      await Clipboard.setStringAsync(inviteLink);
      setCopied(true);
      toast.success(t('common.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('common.error'));
    }
  }, [inviteLink, toast, t]);

  const handleCopyCode = useCallback(async () => {
    if (!inviteCode) return;

    try {
      await Clipboard.setStringAsync(inviteCode);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('common.error'));
    }
  }, [inviteCode, toast, t]);

  const handleShare = useCallback(async () => {
    if (!inviteLink) return;

    try {
      await Share.share({
        message: t('groups.shareInviteMessage', {
          typeLabel,
          groupName,
          inviteCode: inviteCode || '',
          inviteLink,
        }),
        title: t('groups.shareInviteTitle', { groupName }),
      });
      Analytics.invitationLinkGenerated({
        invitation_type: type === 'community' ? 'community' : 'group',
        channel: 'share_sheet',
      });
    } catch (error) {
      // User cancelled or error
      if (error instanceof Error && error.message !== 'User did not share') {
        toast.error(t('common.error'));
      }
    }
  }, [inviteLink, inviteCode, groupName, typeLabel, type, toast, t]);

  const handleResetCode = useCallback(() => {
    Alert.alert(t('groups.resetInviteCode'), t('groups.resetInviteCodeWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.reset'),
        style: 'destructive',
        onPress: async () => {
          try {
            await resetInviteCodeMutation.mutateAsync({
              groupId,
              moderatorId: currentUserId,
            });
            refetch();
            toast.success(t('groups.inviteCodeReset'));
          } catch (error) {
            toast.error(error instanceof Error ? error.message : t('groups.failedToResetCode'));
          }
        },
      },
    ]);
  }, [groupId, currentUserId, resetInviteCodeMutation, refetch, toast, t]);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerSpacer} />
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('groups.inviteTo', { type: typeLabelCapitalized })}
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.buttonActive} />
              <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
                {t('groups.generatingInviteLink')}
              </Text>
            </View>
          ) : (
            <>
              {/* Description */}
              <Text size="sm" color={colors.textSecondary} style={styles.description}>
                {t('groups.shareInviteDescription', { typeLabel })}
              </Text>

              {/* Tab Bar */}
              <TabBar activeTab={activeTab} onTabChange={setActiveTab} colors={colors} t={t} />

              {activeTab === 'qr' ? (
                /* QR Code Display */
                <View style={[styles.qrContainer, { backgroundColor: colors.buttonInactive }]}>
                  {inviteLink && (
                    <View style={styles.qrCanvas}>
                      <QRCode
                        value={inviteLink}
                        size={220}
                        backgroundColor="#FFFFFF"
                        color="#000000"
                        ecl="M"
                      />
                    </View>
                  )}
                  <Text size="xs" color={colors.textMuted} style={styles.qrHint}>
                    {t('groups.scanToJoin', { typeLabel })}
                  </Text>
                </View>
              ) : (
                /* Invite Code Display */
                <View style={[styles.codeContainer, { backgroundColor: colors.buttonInactive }]}>
                  <Text size="xs" color={colors.textMuted} style={styles.codeLabel}>
                    {t('groups.inviteCode')}
                  </Text>
                  <TouchableOpacity onPress={handleCopyCode} activeOpacity={0.7}>
                    <Text
                      weight="bold"
                      size="xl"
                      color={colors.buttonActive}
                      style={styles.codeText}
                    >
                      {inviteCode}
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
                  {inviteLink}
                </Text>
                <TouchableOpacity
                  onPress={handleCopyLink}
                  style={[
                    styles.copyButton,
                    {
                      backgroundColor: copied ? colors.buttonActive : colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={18}
                    color={copied ? colors.buttonTextActive : colors.text}
                  />
                </TouchableOpacity>
              </View>

              {/* Action Buttons */}
              <View style={styles.actions}>
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  onPress={handleShare}
                  leftIcon={
                    <Ionicons name="share-outline" size={20} color={colors.buttonTextActive} />
                  }
                  isDark={isDark}
                >
                  {t('groups.shareInvite')}
                </Button>

                {isModerator && (
                  <TouchableOpacity
                    style={[styles.resetButton, { borderColor: colors.border }]}
                    onPress={handleResetCode}
                    disabled={resetInviteCodeMutation.isPending}
                  >
                    <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
                    <Text size="sm" style={{ color: colors.textSecondary, marginLeft: 6 }}>
                      {t('groups.resetCode')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Info */}
              <View style={styles.infoSection}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                <Text size="xs" style={{ color: colors.textMuted, marginLeft: 6, flex: 1 }}>
                  {t('groups.inviteLinkInfo')}
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const InviteLinkModal = InviteLinkActionSheet;

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
  },
  headerSpacer: {
    width: 24 + spacingPixels[1] * 2,
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[6],
    paddingBottom: spacingPixels[4],
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacingPixels[10],
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
  qrCanvas: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: radiusPixels.md,
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
  actions: {
    gap: spacingPixels[3],
    marginBottom: spacingPixels[6],
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[2.5],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  infoSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacingPixels[2],
  },
});
