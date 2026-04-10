/**
 * InviteLinkModal
 * Modal showing the group invite link with options to copy, share, and generate QR code
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Share,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import {
  useGroupInviteCode,
  useResetGroupInviteCode,
  useReferral,
  getGroupInviteLink,
} from '@rallia/shared-hooks';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import * as Analytics from '../../../services/analytics';

export function InviteLinkActionSheet({ payload }: SheetProps<'invite-link'>) {
  const groupId = payload?.groupId ?? '';
  const groupName = payload?.groupName ?? '';
  const currentUserId = payload?.currentUserId ?? '';
  const isModerator = payload?.isModerator ?? false;
  const type = payload?.type ?? 'group';

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);

  const handleClose = useCallback(() => {
    setCopied(false);
    setShowQRCode(false);
    SheetManager.hide('invite-link');
  }, []);

  // Use proper terminology based on type
  const typeLabel = type === 'community' ? t('groups.community') : t('groups.group');
  const typeLabelCapitalized =
    type === 'community' ? t('groups.communityCapital') : t('groups.groupCapital');

  const { data: inviteCode, isLoading, refetch } = useGroupInviteCode(groupId);
  const resetInviteCodeMutation = useResetGroupInviteCode();
  const { code: referralCode } = useReferral(currentUserId || undefined);

  const inviteLink = inviteCode ? getGroupInviteLink(inviteCode, referralCode) : '';

  // Generate QR code URL using a public API (Google Charts API for QR codes)
  const qrCodeUrl = inviteLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(inviteLink)}&bgcolor=${isDark ? '1C1C1E' : 'F2F2F7'}`
    : '';

  const handleCopyLink = useCallback(async () => {
    if (!inviteLink) return;

    try {
      await Clipboard.setStringAsync(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      Alert.alert(t('common.error'), t('groups.failedToCopyLink'));
    }
  }, [inviteLink, t]);

  const handleCopyCode = useCallback(async () => {
    if (!inviteCode) return;

    try {
      await Clipboard.setStringAsync(inviteCode);
      Alert.alert(t('common.copied'), t('groups.inviteCodeCopied'));
    } catch (error) {
      Alert.alert(t('common.error'), t('groups.failedToCopyCode'));
    }
  }, [inviteCode, t]);

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
        Alert.alert(t('common.error'), t('groups.failedToShare'));
      }
    }
  }, [inviteLink, inviteCode, groupName, typeLabel, type, t]);

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
            Alert.alert(t('common.success'), t('groups.inviteCodeReset'));
          } catch (error) {
            Alert.alert(
              t('common.error'),
              error instanceof Error ? error.message : t('groups.failedToResetCode')
            );
          }
        },
      },
    ]);
  }, [groupId, currentUserId, resetInviteCodeMutation, refetch, t]);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
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
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ color: colors.textSecondary, marginTop: 12 }}>
                {t('groups.generatingInviteLink')}
              </Text>
            </View>
          ) : (
            <>
              {/* Description */}
              <Text style={{ color: colors.textSecondary, textAlign: 'center', marginBottom: 24 }}>
                {t('groups.shareInviteDescription', { typeLabel })}
              </Text>

              {/* Toggle between Code and QR */}
              <View style={styles.toggleContainer}>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    !showQRCode && { backgroundColor: colors.primary },
                    { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
                  ]}
                  onPress={() => setShowQRCode(false)}
                >
                  <Text
                    size="sm"
                    weight="medium"
                    style={{ color: !showQRCode ? '#FFFFFF' : colors.textSecondary }}
                  >
                    {t('groups.code')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    showQRCode && { backgroundColor: colors.primary },
                    { borderTopRightRadius: 8, borderBottomRightRadius: 8 },
                  ]}
                  onPress={() => setShowQRCode(true)}
                >
                  <Text
                    size="sm"
                    weight="medium"
                    style={{ color: showQRCode ? '#FFFFFF' : colors.textSecondary }}
                  >
                    {t('groups.qrCode')}
                  </Text>
                </TouchableOpacity>
              </View>

              {showQRCode ? (
                /* QR Code Display */
                <View
                  style={[styles.qrContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}
                >
                  <Image source={{ uri: qrCodeUrl }} style={styles.qrImage} resizeMode="contain" />
                  <Text size="xs" style={{ color: colors.textMuted, marginTop: 8 }}>
                    {t('groups.scanToJoin', { typeLabel })}
                  </Text>
                </View>
              ) : (
                /* Invite Code Display */
                <View
                  style={[
                    styles.codeContainer,
                    { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' },
                  ]}
                >
                  <Text size="xs" style={{ color: colors.textMuted, marginBottom: 4 }}>
                    {t('groups.inviteCode')}
                  </Text>
                  <TouchableOpacity onPress={handleCopyCode} activeOpacity={0.7}>
                    <Text
                      weight="bold"
                      size="xl"
                      style={{ color: colors.primary, letterSpacing: 4 }}
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
                  { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7', borderColor: colors.border },
                ]}
              >
                <Text numberOfLines={1} style={{ color: colors.text, flex: 1 }}>
                  {inviteLink}
                </Text>
                <TouchableOpacity
                  onPress={handleCopyLink}
                  style={[
                    styles.copyButton,
                    { backgroundColor: copied ? colors.primary : isDark ? '#3A3A3C' : '#E5E5EA' },
                  ]}
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={18}
                    color={copied ? '#FFFFFF' : colors.text}
                  />
                </TouchableOpacity>
              </View>

              {/* Action Buttons */}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: colors.primary }]}
                  onPress={handleShare}
                >
                  <Ionicons name="share-outline" size={20} color="#FFFFFF" />
                  <Text weight="semibold" style={{ color: '#FFFFFF', marginLeft: 8 }}>
                    {t('groups.shareInvite')}
                  </Text>
                </TouchableOpacity>

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
    paddingVertical: 40,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginBottom: 16,
  },
  toggleButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  qrContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  qrImage: {
    width: 180,
    height: 180,
    borderRadius: 8,
  },
  codeContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 24,
  },
  copyButton: {
    padding: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
  actions: {
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 12,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  infoSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 8,
  },
});
